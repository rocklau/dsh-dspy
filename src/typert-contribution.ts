/** Explicit strict descriptors shared by the Host registry and Client $mount. */
import { z } from 'zod'
import type { InvocationDescriptor, InvocationParameterDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ConfigSchema, ConfigPatchSchema, EvolveOptionsSchema, OptimizedPromptSchema, SessionIdSchema, StatusSchema, TrainExampleSchema } from './types.ts'

function codec(name: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol: `dsh-dspy:${name}`, create: () => schema }
}
function parameter(name: string, schema: z.ZodType, optional = false): InvocationParameterDescriptor {
  return { name, wire: name, source: 'json', codec: codec(name, schema), ...optional ? { acceptsUndefined: true as const } : {} }
}
function descriptor(method: string, parameters: InvocationParameterDescriptor[], schema: z.ZodType, cancellable = false): InvocationDescriptor {
  return {
    id: `dsh-dspy:dspyApi/${method}`, service: 'dspyApi', namespace: 'dspyApi', method,
    invocation: { kind: 'direct' }, parameters, result: codec(method, schema),
    ...cancellable ? { cancellation: { parameter: 'signal' as const } } : {},
  }
}
export const DSPY_API_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-dspy',
  descriptors: [
    descriptor('getStatus', [], StatusSchema),
    descriptor('getConfig', [], ConfigSchema),
    descriptor('setConfig', [parameter('patch', ConfigPatchSchema)], ConfigSchema),
    descriptor('evolve', [
      parameter('options', EvolveOptionsSchema),
      parameter('instruction', z.string().optional(), true),
      parameter('trainset', z.array(TrainExampleSchema)),
      parameter('sessionId', SessionIdSchema),
    ], OptimizedPromptSchema, true),
  ],
}
