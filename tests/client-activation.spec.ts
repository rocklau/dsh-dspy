import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { z } from 'zod'
import Typert from '@deepseek-ai/dsh-typert-registry'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { installConnection, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import * as client from '../src/client/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OptimizerPanelInjected } from '../src/client/OptimizerPanel.tsx'
import { DSPY_API_CONTRIBUTION } from '../src/typert-contribution.ts'
import { ConfigSchema } from '../src/types.ts'

const contexts: Context[] = []
function SlotOwner(_props: PropsRenderSlots<'conversation.view' | 'shell.overlay'>) { return null }
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Fixture-only dependency holding a namespace fiber before construction. */
    dspyClientActivationGate: boolean
  }
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function fixture(prepare?: (ctx: Context) => Promise<void>) {
  const ctx = new Context()
  contexts.push(ctx)
  await prepare?.(ctx)
  const config = ConfigSchema.parse({})
  const mock = RemoteMock.create().unary('dspyApi/getStatus', ok({
    config, trainsetSize: 0, lastRun: null, history: [],
  }))
  await ctx.plugin(Typert)
  installConnection(ctx, { transport: { rpc: mock.rpc } })
  await ctx.plugin(Gateway)
  new SlotRegistry(ctx)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const declareSlots = () => ctx.slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  }, SlotOwner)
  const removeSlots = declareSlots()
  return { ctx, mock, declareSlots, removeSlots }
}

describe('current Gateway Client activation', () => {
  it('mounts the tab and invokes status before actual Loader readiness settles', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const entryStarted = new Promise<void>(resolve => { entered = resolve })
    let loader!: Loader
    let heldEntry!: Promise<string>
    try {
      const { ctx } = await fixture(async root => {
        root.effect(() => () => release(), 'loader readiness gate')
        await root.plugin(Loader)
        loader = root.loader
        loader.builtins.dspyReadinessGate = {
          apply: async () => { entered(); await gate },
        }
        heldEntry = loader.create({ name: 'cordis:dspyReadinessGate' })
        await entryStarted
      })
      const connection = ctx.get('connection') as ConnectionHandle
      expect(loader.getTasks().length).toBeGreaterThan(0)
      expect(connection.state.getSnapshot()).toBeUndefined()
      loader.builtins.dspyClient = client
      const id = await loader.create({ name: 'cordis:dspyClient' })
      await loader.resolve(id).fiber?.await()
      expect(ctx.slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['dsh-dspy'])
      const tab = ctx.slots.entries('conversation.view')[0]
      const inject = z.custom<(sessionId: SessionId) => OptimizerPanelInjected>(value => typeof value === 'function').parse(tab.inject)
      expect(await inject(SessionId('loader-fixture')).api.getStatus()).toMatchObject({ lastRun: null })
      expect(loader.getTasks().length).toBeGreaterThan(0)
      expect(connection.state.getSnapshot()).toBeUndefined()
    } finally {
      release()
      if (heldEntry !== undefined) await heldEntry
      if (loader !== undefined) await loader.await()
    }
  })

  it('mounts the real strict DSPy contribution and invokes the Connection carrier', async () => {
    const { ctx } = await fixture()
    const unmount = await ctx.remote.$mount(DSPY_API_CONTRIBUTION)
    try {
      expect(await ctx.remote.dspyApi.getStatus()).toMatchObject({ ok: true, value: { lastRun: null } })
    } finally {
      await unmount()
    }
  })

  it('registers the conversation tab through real Cordis and SlotRegistry lifetimes', async () => {
    const { ctx } = await fixture()
    const fork = ctx.plugin(client)
    await fork
    const tab = ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'dsh-dspy')
    expect(tab).toBeDefined()
    expect(resolveSlotLabel(tab?.options.label)).toBe('DSPy')
    expect(ctx.slots.entries('shell.overlay').some(entry => entry.options.id === 'dsh-dspy.outcome')).toBe(true)
    await fork.dispose()
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.slots.entries('shell.overlay')).toEqual([])
    expect(ctx.typert.remotes.list()).toEqual([])
  })

  it('registers again when the slot owner redeclares its conversation view', async () => {
    const { ctx, declareSlots, removeSlots } = await fixture()
    removeSlots()
    const fork = ctx.plugin(client)
    await fork
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    const removeFirst = declareSlots()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
    removeFirst()
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    declareSlots()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
    await fork.dispose()
    expect(ctx.slots.entries('conversation.view')).toEqual([])
  })

  it('rejects failed namespace mounting instead of reporting successful Client activation', async () => {
    const { ctx } = await fixture()
    const unmount = await ctx.remote.$mount(DSPY_API_CONTRIBUTION)
    try {
      await expect(Promise.resolve(ctx.plugin(client))).rejects.toThrow(/already mounted/)
      expect(ctx.slots.entries('conversation.view')).toEqual([])
      expect(ctx.slots.entries('shell.overlay')).toEqual([])
      expect(await ctx.remote.dspyApi.getStatus()).toMatchObject({ ok: true })
    } finally {
      await unmount()
    }
  })

  it('does not register controls after disposal during namespace construction', async () => {
    const { ctx } = await fixture()
    let created!: () => void
    const namespaceCreated = new Promise<void>(resolve => { created = resolve })
    ctx.on('internal/plugin', fiber => {
      if (fiber.runtime?.name !== 'remote.dspyApi') return
      fiber.inject.dspyClientActivationGate = null
      created()
    })
    const fork = ctx.plugin(client)
    const startup = Promise.resolve(fork)
    await namespaceCreated
    const disposal = fork.dispose()
    ctx.provide('dspyClientActivationGate', true)
    await Promise.all([startup, disposal])
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.slots.entries('shell.overlay')).toEqual([])
    expect(ctx.typert.remotes.list()).toEqual([])
    expect(ctx.get('remote.dspyApi')).toBeUndefined()
  })

  it('loads the built ModuleLoader factory and mounts its controls through the real Client services', async () => {
    const { ctx } = await fixture()
    const definitions: Array<{ id: string; factory: (require: (name: string) => unknown) => unknown }> = []
    runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
      URL,
      window: { __ModuleLoader__: { load: (definition: typeof definitions[number]) => { definitions.push(definition) } } },
    })
    expect(definitions).toHaveLength(1)
    expect(definitions[0].id).toBe('dsh-dspy')
    const modules = new Map<string, unknown>([
      ['react', React],
      ['react/jsx-runtime', JsxRuntime],
      ['@deepseek-ai/dsh-client-ui-primitives', Primitives],
    ])
    const built = z.object({
      inject: z.array(z.string()),
      apply: z.custom<typeof client.apply>(value => typeof value === 'function'),
    }).parse(definitions[0].factory(name => {
      const value = modules.get(name)
      if (value === undefined) throw new Error(`Unexpected Client module dependency: ${name}`)
      return value
    }))
    expect(built.inject).toEqual(client.inject)
    const fork = ctx.plugin(built)
    await fork
    expect(ctx.slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['dsh-dspy'])
    const tab = ctx.slots.entries('conversation.view')[0]
    const inject = z.custom<(sessionId: SessionId) => OptimizerPanelInjected>(value => typeof value === 'function').parse(tab.inject)
    expect(await inject(SessionId('client-fixture')).api.getStatus()).toMatchObject({ lastRun: null })
    await fork.dispose()
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    expect(ctx.typert.remotes.list()).toEqual([])
  })
})
