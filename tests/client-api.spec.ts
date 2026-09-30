import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createDspyApi, type RemoteDspyApi } from '../src/client/api.ts'
import { ConfigSchema } from '../src/types.ts'
import { DSPY_API_CONTRIBUTION } from '../src/typert-contribution.ts'

describe('current mounted Remote protocol', () => {
  it('uses the supplied runtime without requesting automatic peer installation', () => {
    const manifest = z.object({
      peerDependencies: z.record(z.string(), z.string()),
      peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.literal(true) })),
    }).parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')))
    expect(Object.keys(manifest.peerDependenciesMeta).sort()).toEqual(Object.keys(manifest.peerDependencies).sort())
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBe('^4.0.4')
    for (const [name, version] of Object.entries(manifest.peerDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version).toBe('0.2.0-rc.2')
    }
  })

  it('unwraps actual RemoteResult values rather than invented result field wrappers', async () => {
    const config = ConfigSchema.parse({})
    const remote: RemoteDspyApi = {
      getConfig: async () => ({ ok: true, value: config }),
      getStatus: async () => ({ ok: true, value: { config, trainsetSize: 0, lastRun: null, history: [] } }),
      setConfig: async patch => ({ ok: true, value: ConfigSchema.parse({ ...config, ...patch }) }),
      evolve: async () => ({ ok: false, error: new RemoteError('gateway/internal', 'Selected target is unavailable', {}) }),
    }
    const api = createDspyApi(remote)
    expect(await api.getConfig()).toEqual(config)
    expect(await api.getStatus()).toMatchObject({ lastRun: null, trainsetSize: 0 })
    expect((await api.setConfig({ mode: 'heuristic' })).mode).toBe('heuristic')
    await expect(api.evolve({}, 'Test', [], SessionId('session'))).rejects.toThrow(/Selected target/)
  })

  it('validates actual ordered invocation fields and cancellation independently of application arguments', () => {
    const evolve = DSPY_API_CONTRIBUTION.descriptors.find(descriptor => descriptor.method === 'evolve')!
    expect(evolve.parameters.map(parameter => parameter.wire)).toEqual(['options', 'instruction', 'trainset', 'sessionId'])
    expect(evolve.cancellation).toEqual({ parameter: 'signal' })
    const session = evolve.parameters[3].codec
    if (session.mode !== 'strict') throw new Error('Expected strict SessionId codec')
    expect(session.create().parse('session')).toBe(SessionId('session'))
    expect(() => session.create().parse('')).toThrow()
    expect(() => session.create().parse(123)).toThrow()
    const options = evolve.parameters[0].codec
    if (options.mode !== 'strict') throw new Error('Expected strict options codec')
    expect(options.create().parse({ mode: 'heuristic', targetSection: 'personaSuffix' })).toEqual({ mode: 'heuristic', targetSection: 'personaSuffix' })
    expect(() => options.create().parse({ targetSection: 'wholePrompt' })).toThrow()
    const examples = evolve.parameters[2].codec
    if (examples.mode !== 'strict') throw new Error('Expected strict trainset codec')
    expect(() => examples.create().parse([{ input: { question: 'Question' } }])).toThrow()
    expect(() => examples.create().parse([{ input: {}, expected: 'Answer' }])).toThrow()
    expect(() => examples.create().parse([{ input: { answer: 'Reserved' }, expected: 'Answer' }])).toThrow()
    const patch = DSPY_API_CONTRIBUTION.descriptors.find(descriptor => descriptor.method === 'setConfig')!.parameters[0].codec
    if (patch.mode !== 'strict') throw new Error('Expected strict patch codec')
    expect(patch.create().parse({ strategy: 'miprov2' })).toEqual({ strategy: 'miprov2' })
    expect(patch.create().parse({})).toEqual({})
  })
})
