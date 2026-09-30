/** Explicit instruction optimization and session-scoped persona fragment replacement. */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { z } from 'zod'
import {
  ConfigSchema, OptimizedPromptSchema, TrainExampleSchema,
  type DspyConfig, type DspyStatus, type EvolveOptions, type OptimizedPrompt, type TargetSection, type TrainExample,
} from './types.ts'
import { bridgeEnv, PythonBridge } from './pythonBridge.ts'

const sectionNames = { personaPrefix: PERSONA_PREFIX_SECTION, personaSuffix: PERSONA_SUFFIX_SECTION }

export class DspyEngine {
  private history: OptimizedPrompt[] = []
  private bridges = new Set<PythonBridge>()
  private operations = new Set<Promise<unknown>>()
  private replacements = new Map<Agent, Map<TargetSection, { instruction: string; dispose: () => void }>>()
  private closed = false
  private readonly stopListening: () => void

  constructor(private readonly ctx: Context, public config: DspyConfig) {
    if (config.dataDir && existsSync(this.historyPath())) {
      this.history = z.array(OptimizedPromptSchema).parse(JSON.parse(readFileSync(this.historyPath(), 'utf8')))
    }
    this.stopListening = ctx.on('agent/disposed', ({ agent }) => {
      const targets = this.replacements.get(agent)
      if (targets) for (const replacement of targets.values()) replacement.dispose()
      this.replacements.delete(agent)
    })
  }

  /** Copy configuration; invalid or obsolete fields reject instead of partially mutating state. */
  setConfig(patch: Partial<DspyConfig>): DspyConfig {
    this.config = ConfigSchema.parse({ ...this.config, ...patch })
    return { ...this.config }
  }

  getStatus(): DspyStatus {
    return structuredClone({
      config: this.config,
      trainsetSize: this.history[0]?.trainsetSize ?? 0,
      lastRun: this.history[0] ?? null, history: this.history,
    })
  }

  private async instructionOf(agent: Agent, target: TargetSection, signal: AbortSignal): Promise<string> {
    const assembly = await agent.ctx.systemPrompt.assemble({ scope: agent, signal })
    const section = assembly.sections.find(item => item.name === sectionNames[target])
    if (!section) throw new Error(`The current agent has no ${target} section; a complete prompt cannot be replaced as a persona fragment`)
    return renderPrompt({ ...assembly, sections: [section] })
  }

  /** Replace only the explicitly selected existing fragment in one Agent's future assemblies. */
  private async apply(optimized: OptimizedPrompt, agent: Agent, target: TargetSection, signal: AbortSignal): Promise<() => void> {
    await this.instructionOf(agent, target, signal)
    signal.throwIfAborted()
    if (this.closed) throw new Error('DSPy plugin is disposed')
    let targets = this.replacements.get(agent)
    if (!targets) { targets = new Map(); this.replacements.set(agent, targets) }
    const targetMap = targets
    const previous = targets.get(target)
    const previousInstruction = previous?.instruction
    if (previous) previous.instruction = optimized.instruction
    else {
      const replacement = { instruction: optimized.instruction, dispose: () => {} }
      replacement.dispose = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const resolved = await next()
        const name = sectionNames[target]
        if (!resolved.sections.some(section => section.name === name)) {
          throw new Error(`DSPy target ${target} is unavailable in this agent's prompt`)
        }
        return {
          ...resolved,
          sections: resolved.sections.map(section => section.name === name
            ? { name, text: replacement.instruction, interpolate: false }
            : section),
        }
      })
      targets.set(target, replacement)
    }
    optimized.applied = true
    optimized.appliedSession = agent.id
    optimized.appliedTarget = target
    return () => {
      if (previous && previousInstruction !== undefined) previous.instruction = previousInstruction
      else {
        targetMap.get(target)?.dispose()
        targetMap.delete(target)
        if (targetMap.size === 0) this.replacements.delete(agent)
      }
    }
  }

  /** Compile explicit examples, then optionally replace an explicitly selected current-agent fragment. */
  evolve(
    options: EvolveOptions, instruction: string | undefined, trainset: TrainExample[],
    agent: Agent | undefined, signal: AbortSignal,
  ): Promise<OptimizedPrompt> {
    return this.track(this.evolveImpl(options, instruction, trainset, agent, signal))
  }

  private async evolveImpl(
    options: EvolveOptions, instruction: string | undefined, trainset: TrainExample[],
    agent: Agent | undefined, signal: AbortSignal,
  ): Promise<OptimizedPrompt> {
    if (this.closed) throw new Error('DSPy plugin is disposed')
    const config = { ...this.config }
    const apply = (options.autoApply ?? config.autoApply) && !options.dryRun
    if (apply && (!agent || !options.targetSection)) {
      throw new Error('Application requires a current agent and explicit targetSection: personaPrefix or personaSuffix')
    }
    const target = options.targetSection
    const source = instruction ?? (agent && target ? await this.instructionOf(agent, target, signal) : '')
    if (!source.trim()) throw new Error('Provide an instruction or select a non-empty persona fragment in the current agent')
    const examples = z.array(TrainExampleSchema).parse(trainset)
    const mode = options.mode ?? config.mode
    if (mode === 'dspy' && examples.length === 0) throw new Error('DSPy optimization requires explicit labeled training examples')
    const bridge = await this.createBridge(mode === 'dspy', config, signal)
    try {
      const result = await bridge.compile(source, examples, config, options, signal)
      signal.throwIfAborted()
      if (this.closed) throw new Error('DSPy plugin is disposed')
      const rollback = apply && agent && target ? await this.apply(result, agent, target, signal) : undefined
      let recorded = false
      try {
        this.record(result)
        recorded = true
        return structuredClone(result)
      } finally {
        if (!recorded) rollback?.()
      }
    } finally {
      await bridge.dispose()
      this.bridges.delete(bridge)
    }
  }

  private async createBridge(withCredential: boolean, config: DspyConfig, signal: AbortSignal): Promise<PythonBridge> {
    const credential = withCredential ? await this.ctx.credentials.resolve(credentialRef(config.apiKeyRef)) : undefined
    signal.throwIfAborted()
    if (withCredential && !credential) throw new Error(`Configure credential reference ${config.apiKeyRef} before running DSPy`)
    if (this.closed) throw new Error('DSPy plugin is disposed')
    const bridge = new PythonBridge(
      PythonBridge.locate(config.python), bridgeEnv(credential?.value, config.baseUrl, config.model),
      config.requestTimeoutMs, config.shutdownTimeoutMs,
    )
    this.bridges.add(bridge)
    return bridge
  }

  /** Return a deterministic scaffold only; no generated code or model request is executed. */
  rlmPlan(question: string, context: string, tools: string[], signal: AbortSignal) {
    return this.track(this.rlmPlanImpl(question, context, tools, signal))
  }

  private async rlmPlanImpl(question: string, context: string, tools: string[], signal: AbortSignal) {
    const bridge = await this.createBridge(false, { ...this.config }, signal)
    try { return await bridge.rlmPlan(question, context, tools, signal) }
    finally { await bridge.dispose(); this.bridges.delete(bridge) }
  }

  private historyPath(): string { return join(this.config.dataDir, 'dspy', 'history.json') }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation))
    return operation
  }

  private record(entry: OptimizedPrompt): void {
    const history = [entry, ...this.history].slice(0, this.config.historyLimit)
    if (this.config.dataDir) {
      const path = this.historyPath()
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const staging = `${path}.${randomUUID()}.json`
      try {
        writeFileSync(staging, JSON.stringify(history), { mode: 0o600, flag: 'wx' })
        renameSync(staging, path)
      } finally {
        if (existsSync(staging)) unlinkSync(staging)
      }
    }
    this.history = history
  }

  /** Withdraw scoped replacements and await all active Python children. */
  async dispose(): Promise<void> {
    this.closed = true
    this.stopListening()
    for (const targets of this.replacements.values()) for (const replacement of targets.values()) replacement.dispose()
    this.replacements.clear()
    await Promise.all([...this.bridges].map(bridge => bridge.dispose()))
    await Promise.allSettled([...this.operations])
    this.bridges.clear()
  }
}
