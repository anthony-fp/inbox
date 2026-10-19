import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

import type { Run } from '../../hooks/gh'
import { localPath, openCommands } from '../../hooks/presses'

const OPEN_TIMEOUT_MS = 10_000

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
