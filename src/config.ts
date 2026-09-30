/** Cordis validates deployment configuration before mounting the plugin. */
import { ConfigSchema } from './types.ts'

/** An omitted deployment config resolves every documented field default; invalid values reject. */
export const Config = ConfigSchema.prefault({})
