/** Remote controls operate on the selected live session, never the deployment-wide prompt. */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DspyConfig, EvolveOptions, TrainExample } from '../types.ts'
import type { DspyEngine } from '../engine.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dspyApi: DshDspyApi }
}
export class DshDspyApi extends TypertRemoteService {
  constructor(ctx: Context, private readonly engine: DspyEngine) { super(ctx, 'dspyApi') }

  @Remote
  getStatus() { return this.engine.getStatus() }

  @Remote
  getConfig() { return { ...this.engine.config } }

  @Remote
  setConfig(patch: Partial<DspyConfig>) { return this.engine.setConfig(patch) }

  @Remote
  evolve(options: EvolveOptions, instruction: string | undefined, trainset: TrainExample[], sessionId: SessionId, signal: AbortSignal) {
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw new Error('The selected session has no live agent')
    return this.engine.evolve(options, instruction, trainset, agent, signal)
  }
}
