/** Model tools return canonical JSON; the Harness owns execution and durable result logging. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { EvolveOptionsSchema, TrainExampleSchema } from '../types.ts'
import type { DspyEngine } from '../engine.ts'
import { z } from 'zod'

/** Register three tools as plugin-owned Cordis effects. */
export function registerDspyTools(ctx: Context, engine: DspyEngine): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dspy_evolve',
    description: 'Optimize an explicit instruction or selected current-agent persona fragment. DSPy requires labeled examples; heuristic mode is unmeasured. Application replaces only an explicitly selected prefix or suffix for this session, starting with its next prompt assembly.',
    parameters: {
      strategy: { type: 'string', enum: ['gepa', 'miprov2', 'bootstrapFewShot'] },
      mode: { type: 'string', enum: ['dspy', 'heuristic'], description: 'Use heuristic only for a deterministic rewrite without model calls or measured scores.' },
      autoApply: { type: 'boolean', description: 'Apply to the current agent; requires targetSection.' },
      dryRun: { type: 'boolean', description: 'Never apply, even when autoApply is enabled.' },
      targetSection: { type: 'string', enum: ['personaPrefix', 'personaSuffix'], description: 'Explicit fragment to read or replace; never replaces the whole system prompt.' },
      instruction: { type: 'string', description: 'Instruction to optimize; omitted reads the explicitly selected fragment.' },
      trainset: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        input: { type: 'object', additionalProperties: true, required: true },
        expected: { type: 'string', required: true },
      } }, description: 'Labeled examples: input fields must be strings; expected is the reference answer. Required in DSPy mode.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args, exec) => engine.evolve(
      EvolveOptionsSchema.parse({
        strategy: args.strategy, mode: args.mode, autoApply: args.autoApply,
        dryRun: args.dryRun, targetSection: args.targetSection,
      }), args.instruction, z.array(TrainExampleSchema).parse(args.trainset ?? []), exec.agent, exec.signal,
    ),
  })), 'dspy_evolve')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dspy_status',
    description: 'Read DSPy configuration, latest training example count, and optimization history. Does not return credentials.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async () => engine.getStatus(),
  })), 'dspy_status')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dspy_rlm',
    description: 'Generate a deterministic reasoning plan and Python scaffold. It does not execute code, call models, or solve the question.',
    parameters: {
      question: { type: 'string', required: true },
      context: { type: 'string', description: 'Grounding text included in the scaffold.' },
      tools: { type: 'array', items: { type: 'string' }, description: 'Tool names to mention; omitted lists none.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: (args, exec) => engine.rlmPlan(args.question, args.context ?? '', args.tools ?? [], exec.signal),
  })), 'dspy_rlm')
}
