import type { GhRun } from '../../hooks/pr-tab'
import type { Run } from './run'

const CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const GH_TIMEOUT_MS = 20_000

/**
 * Finds the first gh that starts: `exec` ends with code -1 for a command it cannot start. The first one found is
 * kept; while none starts, each call looks again, since the person may install gh without restarting Codex.
 */
export function ghFinder(exec: Run): () => Promise<string | null> {
  let found: string | null = null

  return async () => {
    if (found) return found
    for (const candidate of CANDIDATES) {
      const r = await exec([candidate, '--version'], { cwd: '/', timeoutMs: 5000 })
      if (r.code !== -1) {
        found = candidate
        return found
      }
    }

    return null
  }
}

export function ghIn(exec: Run, bin: string, cwd: string): GhRun {
  return async args => {
    const r = await exec([bin, ...args], { cwd: cwd || '/', timeoutMs: GH_TIMEOUT_MS })

    return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr }
  }
}
