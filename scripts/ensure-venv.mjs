/** Explicit Python setup. Missing interpreters, venv failures, and pip errors fail the command. */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'python')
const venv = join(root, '.venv')
const python = process.platform === 'win32' ? 'python' : 'python3'
const cache = join(root, '.cache')
mkdirSync(cache, { recursive: true, mode: 0o700 })
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, TMPDIR: cache, TEMP: cache, TMP: cache, DSPY_CACHEDIR: cache },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.signal ?? result.status}`)
}
if (!existsSync(venv)) run(python, ['-m', 'venv', venv])
const interpreter = process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
run(interpreter, ['-m', 'pip', 'install', '-r', join(root, 'dsh_dspy', 'requirements.txt')])
run(interpreter, ['-c', 'import dspy, importlib.metadata; print("DSPy", importlib.metadata.version("dspy"))'])
