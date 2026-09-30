/** One-operation NDJSON bridge. Cancellation and disposal await child exit. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { OptimizedPromptSchema, RlmPlanSchema, type DspyConfig, type EvolveOptions, type TrainExample } from './types.ts'

const PYTHON_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'python')
const ResponseSchema = z.union([
  z.strictObject({ id: z.number().int(), result: z.json() }),
  z.strictObject({ id: z.number().int(), error: z.strictObject({ code: z.string(), message: z.string() }) }),
])
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }

/** Scrub ambient secrets; only the explicitly resolved credential reaches Python. */
export function bridgeEnv(apiKey?: string, baseUrl?: string, model?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: '1', DSPY_CACHEDIR: join(PYTHON_ROOT, '.cache') }
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  if (apiKey) env.DEEPSEEK_API_KEY = apiKey
  if (baseUrl) env.DEEPSEEK_BASE_URL = baseUrl
  if (model) env.DSPY_MODEL = model
  return env
}

export class PythonBridge {
  private proc: ChildProcessWithoutNullStreams | undefined
  private done: Promise<void> = Promise.resolve()
  private buffer = ''
  private sequence = 0
  private pending = new Map<number, Pending>()
  private closed = false
  private failure: Error | undefined
  private stopping: Promise<void> | undefined

  constructor(
    private readonly pythonBin: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly requestTimeoutMs: number,
    private readonly shutdownTimeoutMs: number,
    private readonly pythonRoot = PYTHON_ROOT,
  ) {}

  /** Resolve the bundled interpreter or use the OS command search; missing executables reject on spawn. */
  static locate(config: string): string {
    if (config !== 'auto') return config
    const venv = process.platform === 'win32'
      ? join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
      : join(PYTHON_ROOT, '.venv', 'bin', 'python')
    return existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3'
  }

  private start(): void {
    if (this.closed) throw new Error('DSPy bridge is disposed')
    if (this.proc) return
    const proc = spawn(this.pythonBin, ['-m', 'dsh_dspy.bridge'], {
      cwd: this.pythonRoot, env: this.env, stdio: 'pipe',
    })
    this.proc = proc
    this.done = new Promise(resolve => {
      proc.once('close', (code, signal) => {
        this.closed = true
        const error = this.failure ?? new Error(`DSPy bridge exited (${signal ?? code})`)
        for (const pending of this.pending.values()) {
          pending.cleanup()
          pending.reject(error)
        }
        this.pending.clear()
        resolve()
      })
    })
    proc.once('error', error => { this.failure = new Error(`DSPy bridge could not start: ${error.message}`) })
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    // Provider diagnostics may contain credentials. They never enter tool output or host logs.
    proc.stderr.resume()
    proc.stdin.on('error', error => { void this.stop(error) })
  }

  private onData(text: string): void {
    this.buffer += text
    if (this.buffer.length > 16 * 1024 * 1024) {
      void this.stop(new Error('DSPy bridge response exceeds the protocol limit'))
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      let response: z.infer<typeof ResponseSchema>
      try {
        response = ResponseSchema.parse(JSON.parse(line))
      } catch (error) {
        void this.stop(new Error('Invalid DSPy bridge response', { cause: error }))
        return
      }
      const pending = this.pending.get(response.id)
      if (!pending) {
        void this.stop(new Error(`Unexpected DSPy response id ${response.id}`))
        return
      }
      this.pending.delete(response.id)
      pending.cleanup()
      if ('error' in response) pending.reject(new Error(`DSPy ${response.error.code}: ${response.error.message}`))
      else pending.resolve(response.result)
    }
  }

  /** Send a request with caller cancellation; timeout or abort terminates the child before rejection. */
  call(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    this.start()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const abort = () => { void this.stop(new Error('DSPy operation cancelled')) }
      const timer = setTimeout(() => { void this.stop(new Error(`DSPy bridge timeout on ${method}`)) }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve, reject,
        cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort) },
      })
      signal.addEventListener('abort', abort, { once: true })
      this.proc!.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      if (signal.aborted) abort()
    })
  }

  async compile(
    instruction: string, trainset: TrainExample[], config: DspyConfig, options: EvolveOptions, signal: AbortSignal,
  ) {
    const value = await this.call('compile', {
      strategy: options.strategy ?? config.strategy,
      mode: options.mode ?? config.mode,
      target: { instruction }, trainset,
      metric: options.metric ?? config.metric,
      options: { maxRounds: options.maxRounds ?? config.maxRounds, maxDemos: config.maxDemos },
    }, signal)
    return OptimizedPromptSchema.parse({
      ...z.record(z.string(), z.json()).parse(value),
      createdAt: new Date().toISOString(), trainsetSize: trainset.length,
      applied: false, appliedSession: null, appliedTarget: null,
    })
  }

  async rlmPlan(question: string, context: string, tools: string[], signal: AbortSignal) {
    return RlmPlanSchema.parse(await this.call('rlm_plan', { question, context, tools }, signal))
  }

  private stop(error: Error): Promise<void> {
    if (this.stopping) return this.stopping
    this.failure = error
    this.closed = true
    this.stopping = (async () => {
      const proc = this.proc
      if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
        await this.done
        return
      }
      proc.kill('SIGTERM')
      const timer = setTimeout(() => { proc.kill('SIGKILL') }, this.shutdownTimeoutMs)
      try { await this.done } finally { clearTimeout(timer) }
    })()
    return this.stopping
  }

  /** Stop accepting requests and settle only after the owned child has closed. */
  dispose(): Promise<void> {
    return this.stop(new Error('DSPy bridge disposed'))
  }
}
