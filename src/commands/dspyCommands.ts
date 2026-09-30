/** Slash command uses JSON arguments so instructions and examples retain their exact text. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { z } from 'zod'
import type { DspyEngine } from '../engine.ts'
import { EvolveOptionsSchema, TrainExampleSchema } from '../types.ts'

export const EvolveRequestSchema = z.strictObject({
  options: EvolveOptionsSchema.default({}),
  instruction: z.string().optional(),
  trainset: z.array(TrainExampleSchema).default([]),
})

/** Register /dspy status, config, and evolve with explicit request JSON. */
export function registerDspyCommands(ctx: Context, engine: DspyEngine): void {
  ctx.effect(() => ctx.commands.register({
    name: 'dspy',
    description: 'Inspect DSPy status or optimize an instruction with explicit examples and application target.',
    input: { hint: 'status | config | evolve {"instruction":"...","trainset":[],"options":{"mode":"heuristic"}}' },
    handler: async invocation => {
      const input = invocation.rawInput.trim()
      if (input === 'status' || input === '') return { kind: 'success', text: JSON.stringify(engine.getStatus(), null, 2) }
      if (input === 'config') return { kind: 'success', text: JSON.stringify(engine.config, null, 2) }
      if (!input.startsWith('evolve ')) return { kind: 'error', text: 'Use /dspy status, config, or evolve with request JSON' }
      const request = EvolveRequestSchema.parse(JSON.parse(input.slice(7)))
      const result = await engine.evolve(request.options, request.instruction, request.trainset, invocation.agent, invocation.signal)
      return { kind: 'success', text: JSON.stringify(result, null, 2) }
    },
  }), 'dspy command')
}
