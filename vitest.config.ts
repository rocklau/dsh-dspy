import { defineConfig } from 'vitest/config'
import { transform } from 'esbuild'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@deepseek-ai/dsh-api-gateway/client',
        replacement: require.resolve('@deepseek-ai/dsh-api-gateway/src/client/index.ts'),
      },
      {
        find: '@deepseek-ai/dsh-client-connection/client',
        replacement: require.resolve('@deepseek-ai/dsh-client-connection/src/client/index.ts'),
      },
      {
        find: '@deepseek-ai/dsh-client-ui-renderer/client',
        replacement: require.resolve('@deepseek-ai/dsh-client-ui-renderer/src/client/index.ts'),
      },
      {
        find: '@deepseek-ai/dsh-client-locale/client',
        replacement: require.resolve('@deepseek-ai/dsh-client-locale/src/client/index.ts'),
      },
    ],
  },
  plugins: [{
    name: 'dspy-standard-decorators',
    enforce: 'pre',
    async transform(source, id) {
      if (id.endsWith('/src/services/dspyApi.ts')) {
        return transform(source, { loader: 'ts', target: 'es2022' })
      }
    },
  }],
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
})
