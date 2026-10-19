import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

import type { GhRun } from '../../hooks/pr-tab'
import { localPath, openCommands } from '../../hooks/presses'

/** Runs a command and never throws: a command that cannot start, times out or is killed ends with code -1. */
export type Run = (
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ code: number; stdout: string; stderr: string }>

const UNSTARTABLE_CODE = -1
const GH_CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']
const GH_TIMEOUT_MS = 20_000
const OPEN_TIMEOUT_MS = 10_000

/**
 * Finds the first gh that starts. The one found is kept until `forget` is called. While none starts, each call
 * looks again, since the person may install gh without restarting omp.
 */
export function ghFinder(run: Run): { find: () => Promise<string | null>; forget: () => void } {
  let found: string | null = null

  return {
    find: async () => {
      if (found) return found
      for (const candidate of GH_CANDIDATES) {
        const r = await run([candidate, '--version'], { cwd: '/', timeoutMs: 5000 })
        if (r.code !== UNSTARTABLE_CODE) {
          found = candidate
          return found
        }
      }

      return null
    },
    forget: () => {
      found = null
    },
  }
}

/** `onUnstartable` is called when a run ends with code -1, which also covers a timeout kill. */
export function ghIn(run: Run, bin: string, cwd: string, onUnstartable: () => void): GhRun {
  return async args => {
    const r = await run([bin, ...args], { cwd: cwd || '/', timeoutMs: GH_TIMEOUT_MS })
    if (r.code === UNSTARTABLE_CODE) onUnstartable()

    return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr }
  }
}

/** Opens a link, or a path as `openCommands` decides. Returns why it could not, or null. */
export async function openTarget(run: Run, target: string, root: string, home: string): Promise<string | null> {
  const open = (argv: string[]) => run(argv, { cwd: '/', timeoutMs: OPEN_TIMEOUT_MS })
  const failure = (r: { code: number; stderr: string }) => r.stderr.trim() || `open exited ${r.code}`
  if (/^https:\/\//.test(target)) {
    const r = await open(['open', target])
    return r.code === 0 ? null : failure(r)
  }
  const path = localPath(target, root || '/', home)
  const info = await stat(path).catch(() => null)
  if (!info) return 'it no longer exists'
  const isExecutable =
    info.isFile() &&
    (await access(path, constants.X_OK).then(
      () => true,
      () => false,
    ))
  const { argv, fallback } = openCommands(path, info.isFile(), isExecutable)
  const r = await open(argv)
  const retry = r.code !== 0 && fallback ? await open(fallback) : r

  return retry.code === 0 ? null : failure(retry)
}
