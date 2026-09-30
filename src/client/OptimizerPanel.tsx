/** Session-scoped optimization form and measured or explicitly unmeasured run history. */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { EvolveOptionsSchema, TrainExampleSchema, type DspyConfig, type DspyStatus, type EvolveOptions, type TrainExample } from '../types.ts'
import type { DspyApiFace } from './api.ts'
import type {} from './locales.ts'

export interface OptimizerPanelInjected {
  api: DspyApiFace
  sessionId: SessionId
  copy: TranslateNS<'dspy'>
  notify: (error: string | null) => void
}
const wrap: CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
  color: 'var(--dsw-alias-label-primary)', fontSize: 13, overflow: 'auto',
}
const card: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l4)', borderRadius: 'var(--dsw-radius-md)',
  padding: 12, background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column', gap: 8,
}
const field: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l4)',
  borderRadius: 'var(--dsw-radius-sm)', padding: 8, font: 'inherit',
}

export function OptimizerPanel({ api, sessionId, copy: t, notify }: OptimizerPanelInjected): JSX.Element {
  const [status, setStatus] = useState<DspyStatus | null>(null)
  const [config, setConfig] = useState<DspyConfig | null>(null)
  const [instruction, setInstruction] = useState('')
  const [examples, setExamples] = useState('[]')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    const next = await api.getStatus()
    if (mounted.current) {
      setStatus(next)
      setConfig(next.config)
    }
  }, [api])
  const report = (error: unknown) => {
    if (mounted.current) setError(error instanceof Error ? error.message : String(error))
  }
  useEffect(() => {
    mounted.current = true
    api.getStatus().then(next => {
      if (mounted.current) { setStatus(next); setConfig(next.config) }
    }, error => { if (mounted.current) report(error) })
    return () => { mounted.current = false; active.current?.abort() }
  }, [api])
  const update = async (patch: Partial<DspyConfig>) => {
    setBusy(true)
    setError(null)
    try { const next = await api.setConfig(patch); if (mounted.current) setConfig(next); notify(null) }
    catch (error) { notify(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const evolve = async (apply: boolean) => {
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    let options: EvolveOptions
    let trainset: TrainExample[]
    try {
      options = EvolveOptionsSchema.parse({
        autoApply: apply, dryRun: !apply, targetSection: target || undefined,
      })
      trainset = z.array(TrainExampleSchema).parse(JSON.parse(examples))
    } catch (error) { report(error); active.current = null; setBusy(false); return }
    try {
      await api.evolve(options, instruction || undefined, trainset, sessionId, controller.signal)
      notify(null)
      if (mounted.current) await refresh().catch(report)
    } catch (error) {
      if (!controller.signal.aborted) notify(error instanceof Error ? error.message : String(error))
    }
    finally { active.current = null; if (mounted.current) setBusy(false) }
  }
  if (!status && !error) return <div role="status" aria-label={t('loading')} style={{ ...wrap, flex: 1, display: 'grid', placeItems: 'center' }}><IconLoadingOutlineRegular size={24} /></div>
  return <div style={wrap} aria-busy={busy}>
    <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{t('title')}</h2>
    <p style={{ margin: 0 }}>{t('limitation')}</p>
    {error && <div role="alert" style={card}>{t('failure')}<pre style={{ whiteSpace: 'pre-wrap' }}>{error}</pre>
      <Button onClick={() => { void refresh().then(() => setError(null), report) }}>{t('retry')}</Button>
    </div>}
    <fieldset disabled={busy || !config} style={card}>
      <label>{t('instruction')}<textarea aria-label={t('instruction')} value={instruction} onChange={event => setInstruction(event.target.value)} style={{ ...field, width: '100%', minHeight: 80, boxSizing: 'border-box' }} /></label>
      <label>{t('examples')}<textarea aria-label={t('examples')} value={examples} onChange={event => setExamples(event.target.value)} style={{ ...field, width: '100%', minHeight: 80, boxSizing: 'border-box' }} /></label>
      <label>{t('target')} <select value={target} onChange={event => setTarget(event.target.value)} style={field}>
        <option value="">{t('none')}</option><option value="personaPrefix">{t('prefix')}</option><option value="personaSuffix">{t('suffix')}</option>
      </select></label>
      <label>{t('strategy')} <select value={config?.strategy ?? 'gepa'} onChange={event => { void update({ strategy: EvolveOptionsSchema.shape.strategy.parse(event.target.value) }) }} style={field}>
        <option value="gepa">{t('gepa')}</option><option value="miprov2">{t('miprov2')}</option><option value="bootstrapFewShot">{t('bootstrapFewShot')}</option>
      </select></label>
      <label>{t('mode')} <select value={config?.mode ?? 'dspy'} onChange={event => { void update({ mode: EvolveOptionsSchema.shape.mode.parse(event.target.value) }) }} style={field}>
        <option value="dspy">{t('dspy')}</option><option value="heuristic">{t('heuristic')}</option>
      </select></label>
      <label>{t('metric')} <select value={config?.metric ?? 'exact_match'} onChange={event => { void update({ metric: EvolveOptionsSchema.shape.metric.parse(event.target.value) }) }} style={field}>
        <option value="exact_match">{t('exact')}</option><option value="contains">{t('contains')}</option>
      </select></label>
      <label><input type="checkbox" checked={config?.autoApply ?? false} onChange={event => { void update({ autoApply: event.target.checked }) }} /> {t('autoApply')}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={busy || !config} onClick={() => { void evolve(false) }}>{t('dryRun')}</Button>
        <Button disabled={busy || !config || !target} onClick={() => { void evolve(true) }}>{t('apply')}</Button>
      </div>
    </fieldset>
    <section style={card}>
      <h3 style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{t('history')}</h3>
      <div>{t('trainset')}: {status?.trainsetSize ?? '—'}</div>
      {status?.history.length === 0 && <div>{t('empty')}</div>}
      {status?.history.map((run, index) => <article key={`${run.createdAt}:${index}`} style={card}>
        <div>{run.strategy} · {run.mode === 'heuristic' ? t('unmeasured') : t('measured')}</div>
        <div>{run.metricBefore?.toFixed(3) ?? '—'} → {run.metricAfter?.toFixed(3) ?? '—'}</div>
        <div>{run.applied ? t('applied', { target: run.appliedTarget, session: run.appliedSession }) : t('notApplied')}</div>
        <p style={{ margin: 0 }}>{run.reasoning}</p>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.instruction}</pre>
      </article>)}
    </section>
  </div>
}
