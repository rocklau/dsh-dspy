/** One shell-owned outcome notice outlives the panel that issued the operation. */
import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

export function createOutcomeStore() {
  let state: { seq: number; error: string | null } | null = null
  let sequence = 0
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    report: (error: string | null) => { state = { seq: ++sequence, error }; publish() },
    dismiss: () => { state = null; publish() },
  }
}
export type OutcomeStore = ReturnType<typeof createOutcomeStore>
export function OutcomeToast({ store, copy: t }: { store: OutcomeStore; copy: TranslateNS<'dspy'> }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return state ? <Toast
    key={state.seq} tone={state.error === null ? 'success' : undefined}
    text={state.error === null ? t('completed') : `${t('failure')}: ${state.error}`}
    onDone={store.dismiss}
  /> : null
}
