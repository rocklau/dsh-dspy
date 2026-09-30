/** In-process artifact smoke only; no profile or application is launched. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as plugin from '../lib/index.js'

const root = resolve('.smoke-state', randomUUID())
mkdirSync(resolve('.smoke-state'), { recursive: true, mode: 0o700 })
mkdirSync(root, { mode: 0o700 })
const ctx = new Context()
try {
  for (const service of [LlmRuntime, Sessions, Projections]) await ctx.plugin(service)
  await ctx.plugin(SystemPrompt, { personaPrefix: 'Original prefix', personaSuffix: 'Keep suffix' })
  for (const service of [Tools, Commands, Typert]) await ctx.plugin(service)
  await ctx.plugin(Credentials, { path: resolve(root, 'credentials.yml'), watch: false })
  await ctx.plugin(Agents)
  await ctx.plugin(AgentLoop, { agents: [] })
  const [{ insert: [entry] }] = parseYaml(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  assert.equal(entry.name, 'dsh-dspy')
  assert.equal(entry.config, undefined)
  await ctx.plugin(plugin, entry.config)
  assert.deepEqual(ctx.dspyApi.getConfig(), plugin.Config.parse(undefined))
  assert.equal(ctx.dspyApi.getStatus().config.mode, 'dspy')
  ctx.dspyApi.setConfig({ mode: 'heuristic' })
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'smoke', model: 'smoke' })
  const signal = new AbortController().signal
  const optimized = await ctx.dspyApi.evolve({ targetSection: 'personaPrefix', autoApply: true }, 'Built instruction.', [], agent.id, signal)
  assert.equal(optimized.applied, true)
  assert.equal(optimized.metricAfter, null)
  const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
  assert.match(prompt, /Built instruction/)
  assert.match(prompt, /Keep suffix/)
  for (const name of ['dspy_status', 'dspy_rlm']) {
    const result = await ctx.tools.execute({
      name, callId: ToolCallId(randomUUID()), arguments: name === 'dspy_rlm' ? { question: 'Question?' } : {},
      agent, signal,
    })
    assert.equal(result.isError, false)
  }
  assert.equal(ctx.typert.local.list().filter(item => item.namespace === 'dspyApi').length, 4)
  console.log('Built no-config bundle mount, scoped application, descriptors, canonical tools, and Python bridge: OK')
} finally {
  await ctx.fiber.dispose()
  rmSync(root, { recursive: true, force: true })
}
