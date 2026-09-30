/** Emit current Harness host ESM and browser ModuleLoader bundles. */
import { build } from 'esbuild'

const PACKAGE_ID = 'dsh-dspy'
const productionEnv = process.env.NODE_ENV ?? 'production'

const HOST_SHARED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: false,
  minify: false,
  treeShaking: true,
  external: ['@deepseek-ai/*', 'node:*'],
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  sourcemap: true,
  minify: false,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(productionEnv),
    'import.meta.env.MODE': JSON.stringify(productionEnv),
    'import.meta.env': JSON.stringify({ MODE: productionEnv }),
  },
  external: [...HOST_SHARED_MODULES, '@deepseek-ai/*'],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('dsh-dspy build complete: lib/index.js + lib/client.js')
