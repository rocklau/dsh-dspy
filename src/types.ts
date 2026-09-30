/** Validated values shared by the host, remote panel, and Python protocol. */
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Validate a nonempty wire identifier while retaining its Session identity type. */
export const SessionIdSchema = z.custom<SessionId>(value => typeof value === 'string' && value.length > 0)
export const StrategySchema = z.enum(['gepa', 'miprov2', 'bootstrapFewShot'])
export const ModeSchema = z.enum(['dspy', 'heuristic'])
export const TargetSectionSchema = z.enum(['personaPrefix', 'personaSuffix'])
export const TrainExampleSchema = z.strictObject({
  input: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(name => name !== 'answer' && name !== 'expected'), z.string())
    .refine(input => Object.keys(input).length > 0, 'Provide at least one input field'),
  expected: z.string().min(1),
})
export const EvolveOptionsSchema = z.strictObject({
  strategy: StrategySchema.optional(),
  mode: ModeSchema.optional(),
  metric: z.enum(['exact_match', 'contains']).optional(),
  maxRounds: z.number().int().min(1).max(20).optional(),
  autoApply: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  targetSection: TargetSectionSchema.optional(),
})
export const ConfigSchema = z.strictObject({
  strategy: StrategySchema.default('gepa'),
  mode: ModeSchema.default('dspy'),
  metric: z.enum(['exact_match', 'contains']).default('exact_match'),
  autoApply: z.boolean().default(false),
  maxRounds: z.number().int().min(1).max(20).default(3),
  maxDemos: z.number().int().min(0).max(16).default(4),
  python: z.string().min(1).default('auto'),
  dataDir: z.string().default(''),
  apiKeyRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('DEEPSEEK_API_KEY'),
  baseUrl: z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS endpoint').default('https://api.deepseek.com'),
  model: z.string().min(1).default('openai/deepseek-chat'),
  requestTimeoutMs: z.number().int().positive().max(2_147_483_647).default(300_000),
  shutdownTimeoutMs: z.number().int().positive().max(2_147_483_647).default(2_000),
  historyLimit: z.number().int().positive().default(100),
})
/** Patch codecs preserve omitted fields instead of applying deployment defaults. */
export const ConfigPatchSchema = z.strictObject({
  strategy: ConfigSchema.shape.strategy.unwrap().optional(),
  mode: ConfigSchema.shape.mode.unwrap().optional(),
  metric: ConfigSchema.shape.metric.unwrap().optional(),
  autoApply: ConfigSchema.shape.autoApply.unwrap().optional(),
  maxRounds: ConfigSchema.shape.maxRounds.unwrap().optional(),
  maxDemos: ConfigSchema.shape.maxDemos.unwrap().optional(),
  python: ConfigSchema.shape.python.unwrap().optional(),
  dataDir: ConfigSchema.shape.dataDir.unwrap().optional(),
  apiKeyRef: ConfigSchema.shape.apiKeyRef.unwrap().optional(),
  baseUrl: ConfigSchema.shape.baseUrl.unwrap().optional(),
  model: ConfigSchema.shape.model.unwrap().optional(),
  requestTimeoutMs: ConfigSchema.shape.requestTimeoutMs.unwrap().optional(),
  shutdownTimeoutMs: ConfigSchema.shape.shutdownTimeoutMs.unwrap().optional(),
  historyLimit: ConfigSchema.shape.historyLimit.unwrap().optional(),
})
export const OptimizedPromptSchema = z.strictObject({
  instruction: z.string().min(1),
  demos: z.array(z.strictObject({
    input: z.record(z.string(), z.string()),
    output: z.record(z.string(), z.string()),
  })),
  metricBefore: z.number().finite().nullable(),
  metricAfter: z.number().finite().nullable(),
  reasoning: z.string(),
  strategy: StrategySchema,
  mode: ModeSchema,
  createdAt: z.string(),
  trainsetSize: z.number().int().nonnegative(),
  applied: z.boolean(),
  appliedSession: SessionIdSchema.nullable(),
  appliedTarget: TargetSectionSchema.nullable(),
})
export const StatusSchema = z.strictObject({
  config: ConfigSchema,
  trainsetSize: z.number().int().nonnegative(),
  lastRun: OptimizedPromptSchema.nullable(),
  history: z.array(OptimizedPromptSchema),
})
export const RlmPlanSchema = z.strictObject({
  plan: z.string(), code: z.string(), rationale: z.string(), executed: z.literal(false),
})
export type Strategy = z.infer<typeof StrategySchema>
export type Mode = z.infer<typeof ModeSchema>
export type TargetSection = z.infer<typeof TargetSectionSchema>
export type TrainExample = z.infer<typeof TrainExampleSchema>
export type EvolveOptions = z.infer<typeof EvolveOptionsSchema>
export type DspyConfig = z.infer<typeof ConfigSchema>
export type OptimizedPrompt = z.infer<typeof OptimizedPromptSchema>
export type DspyStatus = z.infer<typeof StatusSchema>
export type RlmPlan = z.infer<typeof RlmPlanSchema>
