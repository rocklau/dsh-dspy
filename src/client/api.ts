/** Client signatures for this plugin's strict mounted descriptors; carrier failures are explicit results. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DspyConfig, DspyStatus, EvolveOptions, OptimizedPrompt, TrainExample } from '../types.ts'

export interface RemoteDspyApi {
  getStatus(): Promise<RemoteResult<DspyStatus>>
  getConfig(): Promise<RemoteResult<DspyConfig>>
  setConfig(patch: Partial<DspyConfig>): Promise<RemoteResult<DspyConfig>>
  evolve(options: EvolveOptions, instruction: string | undefined, trainset: TrainExample[], sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<OptimizedPrompt>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { dspyApi: RemoteDspyApi }
}
export interface DspyApiFace {
  getStatus(): Promise<DspyStatus>
  getConfig(): Promise<DspyConfig>
  setConfig(patch: Partial<DspyConfig>): Promise<DspyConfig>
  evolve(options: EvolveOptions, instruction: string | undefined, trainset: TrainExample[], sessionId: SessionId, signal?: AbortSignal): Promise<OptimizedPrompt>
}
export function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}
export function createDspyApi(remote: RemoteDspyApi): DspyApiFace {
  return {
    getStatus: async () => unwrap(await remote.getStatus()),
    getConfig: async () => unwrap(await remote.getConfig()),
    setConfig: async patch => unwrap(await remote.setConfig(patch)),
    evolve: async (options, instruction, trainset, sessionId, signal) => unwrap(await remote.evolve(options, instruction, trainset, sessionId, signal)),
  }
}
