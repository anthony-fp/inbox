import { execFile } from 'node:child_process'

import type { Run } from '../../hooks/gh'

/** Runs a command, never throwing: a command that can't start ends with code -1. */
export const run: Run = (args, { cwd, timeoutMs, env }) =>
  new Promise(resolve => {
    const [file = '', ...rest] = args
    const child = execFile(
      file,
      rest,
      { cwd, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
    child.stdin?.end()
  })
