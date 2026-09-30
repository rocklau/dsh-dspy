import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { resolve } from 'node:path'
import { PythonBridge, bridgeEnv } from '../src/pythonBridge.ts'
import { ConfigSchema } from '../src/types.ts'

const signal = () => new AbortController().signal
const config = ConfigSchema.parse({ mode: 'heuristic' })

describe('Python bridge', () => {
  it('runs the actual bundled heuristic and scaffold without fabricated metrics or tools', async () => {
    const bridge = new PythonBridge(PythonBridge.locate('auto'), bridgeEnv(), 30_000, 2_000)
    try {
      const result = await bridge.compile('Answer using supplied context. 🐍', [], config, {}, signal())
      expect(result).toMatchObject({ mode: 'heuristic', metricBefore: null, metricAfter: null, applied: false })
      expect(result.instruction).toContain('🐍')
      const plan = await bridge.rlmPlan('quotes " and emoji 🐍', 'line\nbreak', [], signal())
      expect(plan.executed).toBe(false)
      expect(plan.plan).not.toContain('search')
    } finally { await bridge.dispose() }
  })

  it('exposes only the resolved credential, not ambient keys, to Python', () => {
    const env = bridgeEnv('resolved-value', 'https://api.deepseek.com', 'openai/deepseek-chat')
    expect(env.DEEPSEEK_API_KEY).toBe('resolved-value')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(bridgeEnv().DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('rejects interpreter startup failures promptly', async () => {
    const bridge = new PythonBridge(resolve('tests/nonexistent-python'), bridgeEnv(), 30_000, 20)
    try { await expect(bridge.call('health', {}, signal())).rejects.toThrow(/could not start/) }
    finally { await bridge.dispose() }
  })

  for (const failure of ['dispose', 'abort', 'invalid', 'exit'] as const) {
    it(`awaits process exit on ${failure}`, async () => {
      const bridge = new PythonBridge(
        PythonBridge.locate('auto'), bridgeEnv(),
        30_000, 20, resolve('tests/fixtures/hung'),
      )
      try {
        const health = z.object({ pid: z.number() }).parse(await bridge.call('health', {}, signal()))
        process.kill(health.pid, 0)
        const controller = new AbortController()
        const pending = bridge.call(failure === 'invalid' || failure === 'exit' ? failure : 'block', {}, controller.signal)
        const rejected = expect(pending).rejects.toThrow()
        if (failure === 'dispose') await bridge.dispose()
        if (failure === 'abort') controller.abort()
        await rejected
        await bridge.dispose()
        expect(() => process.kill(health.pid, 0)).toThrow()
      } finally { await bridge.dispose() }
    })
  }

  it('times out only after the owned child has completed its readiness handshake', async () => {
    const bridge = new PythonBridge(PythonBridge.locate('auto'), bridgeEnv(), 30_000, 20, resolve('tests/fixtures/hung'))
    try {
      const health = z.object({ pid: z.number() }).parse(await bridge.call('health', {}, signal()))
      vi.useFakeTimers()
      const pending = bridge.call('block', {}, signal())
      const rejected = expect(pending).rejects.toThrow(/timeout/)
      await vi.advanceTimersByTimeAsync(30_100)
      await rejected
      expect(() => process.kill(health.pid, 0)).toThrow()
    } finally {
      vi.useRealTimers()
      await bridge.dispose()
    }
  })
})
