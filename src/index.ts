/** Harness 0.2.0-rc.2 plugin: explicit DSPy optimization, tools, command, and strict remote controls. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { Config } from './config.ts'
import { DspyEngine } from './engine.ts'
import { DshDspyApi } from './services/dspyApi.ts'
import { registerDspyTools } from './tools/dspyTools.ts'
import { registerDspyCommands } from './commands/dspyCommands.ts'
import { DSPY_API_CONTRIBUTION } from './typert-contribution.ts'
import type { DspyConfig } from './types.ts'

export const name = 'dsh-dspy'
export const inject = ['tools', 'commands', 'typert', 'credentials', 'agents', 'systemPrompt']
export { Config }

/** Register owned effects; unloading withdraws controls and awaits active Python children. */
export function apply(ctx: Context, config: DspyConfig = Config.parse(undefined)): void {
  const engine = new DspyEngine(ctx, config)
  ctx.effect(() => () => engine.dispose(), 'dsh-dspy engine')
  ctx.plugin(DshDspyApi, engine)
  ctx.effect(() => ctx.typert.register({
    package: 'dsh-dspy', face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: DSPY_API_CONTRIBUTION.descriptors,
  }), 'dsh-dspy strict descriptors')
  registerDspyTools(ctx, engine)
  registerDspyCommands(ctx, engine)
}
