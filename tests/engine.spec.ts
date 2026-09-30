import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { DspyEngine } from '../src/engine.ts'
import { ConfigSchema } from '../src/types.ts'
import * as plugin from '../src/index.ts'
import { DSPY_API_CONTRIBUTION } from '../src/typert-contribution.ts'
import { EvolveRequestSchema } from '../src/commands/dspyCommands.ts'

class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const contexts: Context[] = []
const roots: string[] = []
const engines: DspyEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function harness() {
  const root = resolve('.test-state', randomUUID())
  mkdirSync(resolve('.test-state'), { recursive: true, mode: 0o700 })
  mkdirSync(root, { mode: 0o700 })
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt, { personaPrefix: 'Original prefix', personaSuffix: 'Keep suffix' })
  await ctx.plugin(Tools)
  await ctx.plugin(Commands)
  await ctx.plugin(Typert)
  await ctx.plugin(Credentials, { path: resolve(root, 'credentials.yml'), watch: false })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['test'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'test', model: 'test' })
  const other = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'test', model: 'test' })
  const config = ConfigSchema.parse({ mode: 'heuristic' })
  const engine = new DspyEngine(ctx, config)
  engines.push(engine)
  return { ctx, agent, other, engine, adapter, root, config }
}
const signal = () => new AbortController().signal

describe('Current Harness integration', () => {
  it('mounts without deployment config using documented defaults and rejects invalid config', async () => {
    const { ctx } = await harness()
    await ctx.plugin(plugin)
    expect(ctx.dspyApi.getStatus().config).toEqual(ConfigSchema.parse({}))
    expect(ctx.dspyApi.getStatus().history).toEqual([])
    expect(() => plugin.Config.parse(null)).toThrow()
    expect(() => plugin.Config.parse({ requireApproval: false })).toThrow()
  })

  it('mounts the actual bundle insertion row with its omitted config through Cordis', async () => {
    const { ctx } = await harness()
    const patch = z.array(z.object({
      insert: z.array(z.object({
        id: z.literal('dsh-dspy'),
        name: z.literal('dsh-dspy'),
        config: z.undefined().optional(),
      })),
    })).parse(parseYaml(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')))
    const entry = patch[0].insert[0]
    expect(entry.config).toBeUndefined()
    await ctx.plugin(plugin, entry.config)
    expect(ctx.dspyApi.getStatus().config).toEqual(ConfigSchema.parse({}))
    expect(ctx.typert.local.list().filter(descriptor => descriptor.namespace === 'dspyApi')).toHaveLength(4)
    expect(ctx.tools.get('dspy_status')).toBeDefined()
  })

  it('replaces only an explicit selected current-agent fragment and logs the exact request prompt', async () => {
    const { ctx, agent, other, engine, adapter } = await harness()
    const result = await engine.evolve({ autoApply: true, targetSection: 'personaPrefix' }, undefined, [], agent, signal())
    expect(result).toMatchObject({ applied: true, appliedTarget: 'personaPrefix', appliedSession: agent.id, trainsetSize: 0 })
    const current = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(current).toMatchSnapshot()
    expect(current).toContain(result.instruction)
    expect(current).toContain('Keep suffix')
    const untouched = renderPrompt(await ctx.systemPrompt.assemble({ scope: other }))
    expect(untouched).toContain('Original prefix')
    expect(untouched).not.toContain('Ground claims')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const replay = Session.create(agent.id, agent.session.snapshotEvents())
    expect(adapter.requests[0].messages).toEqual(replay.deriveMessages())
    expect(agent.session.snapshotEvents().some(event => event.type === 'system/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text.includes(result.instruction)))).toBe(true)
    await engine.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))).toBe(untouched)
  })

  it('updates a scoped replacement without accumulating duplicate prompt sections', async () => {
    const { ctx, agent, engine } = await harness()
    await engine.evolve({ autoApply: true, targetSection: 'personaSuffix' }, 'First', [], agent, signal())
    const result = await engine.evolve({ autoApply: true, targetSection: 'personaSuffix' }, 'Second', [], agent, signal())
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(prompt).toContain(result.instruction)
    expect(prompt).not.toContain('First')
    expect(prompt).toContain('Original prefix')
  })

  it('refuses implicit application, invented session mining, and replacing a complete prompt', async () => {
    const { agent, engine } = await harness()
    await expect(engine.evolve({ autoApply: true }, 'Instruction', [], agent, signal())).rejects.toThrow(/explicit targetSection/)
    await expect(engine.evolve({ mode: 'dspy' }, 'Instruction', [], agent, signal())).rejects.toThrow(/labeled training/)
    await expect(engine.evolve({}, undefined, [], agent, signal())).rejects.toThrow(/Provide an instruction/)
    agent.ctx.systemPrompt.section({ name: 'complete', order: 0, text: 'Complete prompt', complete: true })
    await expect(engine.evolve({ autoApply: true, targetSection: 'personaPrefix' }, 'Instruction', [], agent, signal())).rejects.toThrow(/complete prompt/)
    expect(engine.getStatus().history).toEqual([])
  })

  it('dry-run overrides auto-apply and rejects obsolete or invalid configuration', async () => {
    const { engine, agent, ctx } = await harness()
    engine.setConfig({ autoApply: true })
    const result = await engine.evolve({ dryRun: true }, 'Explicit instruction', [], agent, signal())
    expect(result.applied).toBe(false)
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))).not.toContain('Explicit instruction')
    expect(() => ConfigSchema.parse({ requireApproval: false })).toThrow()
    expect(() => ConfigSchema.parse({ metric: 'feedback' })).toThrow()
    expect(() => engine.setConfig({ maxRounds: 0 })).toThrow()
    expect(engine.config.maxRounds).toBe(3)
    expect(EvolveRequestSchema.parse({ options: { mode: 'heuristic' }, instruction: 'Test' }).trainset).toEqual([])
  })

  it('resolves configured credential references on every DSPy operation and fails loudly if absent', async () => {
    const { engine, ctx } = await harness()
    const resolveCredential = vi.spyOn(ctx.credentials, 'resolve')
    engine.setConfig({ mode: 'dspy', apiKeyRef: `MISSING_DSPY_${randomUUID().replaceAll('-', '_')}` })
    const examples = [{ input: { task: 'Question' }, expected: 'Answer' }]
    for (let i = 0; i < 2; i++) await expect(engine.evolve({}, 'Instruction', examples, undefined, signal())).rejects.toThrow(/Configure credential reference/)
    expect(resolveCredential).toHaveBeenCalledTimes(2)
    expect(resolveCredential.mock.calls.every(call => call.length === 1 && call[0] === engine.config.apiKeyRef)).toBe(true)
    resolveCredential.mockRestore()
  })

  it('mounts the real plugin, canonical tools, service, and strict invocation descriptors', async () => {
    const { ctx } = await harness()
    const fork = ctx.plugin(plugin, ConfigSchema.parse({ mode: 'heuristic' }))
    await fork
    expect(ctx.dspyApi.getStatus().config.mode).toBe('heuristic')
    expect(ctx.typert.local.get('dspyApi/evolve')).toMatchObject({ cancellation: { parameter: 'signal' } })
    expect(ctx.typert.local.list().filter(descriptor => descriptor.namespace === 'dspyApi')).toHaveLength(4)
    expect(DSPY_API_CONTRIBUTION.descriptors.every(descriptor => descriptor.result.mode === 'strict')).toBe(true)
    const tool = ctx.tools.get('dspy_status')
    expect(tool).toBeDefined()
    await fork.dispose()
    expect(ctx.tools.get('dspy_status')).toBeUndefined()
    expect(ctx.typert.local.get('dspyApi/evolve')).toBeUndefined()
  })

  it('executes canonical tool values through the real registry and reports application failures as errors', async () => {
    const { ctx, agent } = await harness()
    await ctx.plugin(plugin, ConfigSchema.parse({ mode: 'heuristic' }))
    const execution = (name: string, args: object) => ctx.tools.execute({
      name, arguments: args, callId: ToolCallId(randomUUID()), agent, signal: signal(),
    })
    const status = await execution('dspy_status', {})
    expect(status).toMatchObject({ value: { config: { mode: 'heuristic' } }, isError: false })
    const evolved = await execution('dspy_evolve', { instruction: 'Answer clearly.', dryRun: true })
    expect(evolved).toMatchObject({ isError: false, value: { mode: 'heuristic', applied: false, metricAfter: null } })
    expect(evolved.content[0]).toMatchObject({ type: 'text' })
    expect(evolved.content).not.toEqual([{ type: 'text', text: JSON.stringify({ content: [] }) }])
    const failure = await execution('dspy_evolve', { instruction: 'Answer clearly.', autoApply: true })
    expect(failure.isError).toBe(true)
    expect(failure.content[0]).toMatchObject({ type: 'text' })
    const plan = await execution('dspy_rlm', { question: 'Question?', tools: [] })
    expect(plan).toMatchObject({ isError: false, value: { executed: false } })
  })

  it('rejects corrupt persisted history rather than silently reporting an empty successful state', async () => {
    const { root, ctx, config } = await harness()
    mkdirSync(resolve(root, 'dspy'))
    writeFileSync(resolve(root, 'dspy/history.json'), '[{"instruction":"legacy"}]')
    expect(() => new DspyEngine(ctx, { ...config, dataDir: root })).toThrow()
  })

  it('persists measured-state fields and restores the previous prompt if saving fails', async () => {
    const { engine, root, agent, ctx, config } = await harness()
    engine.setConfig({ dataDir: root })
    const result = await engine.evolve({ autoApply: true, targetSection: 'personaPrefix' }, 'Persisted', [], agent, signal())
    const restored = new DspyEngine(ctx, { ...config, dataDir: root })
    engines.push(restored)
    expect(restored.getStatus().lastRun).toEqual(result)
    const blocked = resolve(root, 'not-a-directory')
    writeFileSync(blocked, 'file')
    engine.setConfig({ dataDir: blocked })
    await expect(engine.evolve({ autoApply: true, targetSection: 'personaPrefix' }, 'Rejected replacement', [], agent, signal())).rejects.toThrow()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(prompt).toContain(result.instruction)
    expect(prompt).not.toContain('Rejected replacement')
  })
})
