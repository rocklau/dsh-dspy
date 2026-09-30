/** Mount strict remote descriptors before registering the session-scoped DSPy tab. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DSPY_API_CONTRIBUTION } from '../typert-contribution.ts'
import { createDspyApi } from './api.ts'
import { OptimizerPanel, type OptimizerPanelInjected } from './OptimizerPanel.tsx'
import { en, zh, NS } from './locales.ts'
import { createOutcomeStore, OutcomeToast } from './OutcomeToast.tsx'

export const inject = ['slots', 'locale', 'remote']

/**
 * Client effects own the dictionaries, mounted Remote namespace, and conversation tab.
 * @param ctx - Client scope supplying slots, locale, and Remote.
 * @returns Settles after namespace-dependent controls are registered; setup failures reject startup.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dspy dictionaries')
  const copy = ctx.locale.bind(NS)
  const outcomes = createOutcomeStore()
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-dspy.outcome', locale: NS,
    inject: () => ({ store: outcomes, copy }),
  }, OutcomeToast))
  const mounted = ctx.remote.$mount(DSPY_API_CONTRIBUTION)
  let active = true
  ctx.effect(() => () => { active = false }, 'dspy client activation')
  await mounted
  if (!active || ctx.fiber.uid === null) return
  await ctx.inject(['slots', 'remote', 'remote.dspyApi'], scoped => {
    const api = createDspyApi(scoped.remote.dspyApi)
    return scoped.slots.inject('conversation.view', () => scoped.slots.register({
      name: 'conversation.view', id: 'dsh-dspy', order: 20, locale: NS,
      label: () => copy('title'),
      inject: (sessionId: SessionId): OptimizerPanelInjected => ({ api, sessionId, copy, notify: outcomes.report }),
    }, OptimizerPanel))
  })
}
