// Reads Codex's session transcript, a JSONL file whose path every hook gets.

import { open } from 'node:fs/promises'

/**
 * Whether the session is a run no person chats in, where the hooks do nothing.
 * An ephemeral thread, such as the Codex app's own background jobs that
 * suggest a next message, saves no transcript, so its hooks get a null path.
 * A `codex exec` run names its originator in the transcript's first line,
 * `session_meta`, which covers the inbox's own update call and runs other
 * tools start.
 */
export async function isNonInteractiveRun(path: string | null): Promise<boolean> {
  if (path === null) return true
  try {
    const file = await open(path, 'r')
    try {
      const buf = Buffer.alloc(64 * 1024)
      const { bytesRead } = await file.read(buf, 0, buf.length, 0)
      const first = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
      const meta = JSON.parse(first) as { type?: string; payload?: { originator?: string; source?: string } }

      return (
        meta.type === 'session_meta' && (meta.payload?.originator === 'codex_exec' || meta.payload?.source === 'exec')
      )
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}
