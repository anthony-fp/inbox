// Reads Codex's session transcript, a JSONL file whose path every hook gets.

import { open } from 'node:fs/promises'

import { dialogQuestions } from '../../hooks/model-text'
import type { DialogQuestion } from '../../hooks/model-text'

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

const DIALOG_TOOL = 'request_user_input_async'

const TAIL_BYTES = 4 * 1024 * 1024

type TranscriptLine = {
  type?: string
  payload?: { type?: string; name?: string; arguments?: string; turn_id?: string }
}

/**
 * The questions of each dialog the agent opened in a turn, oldest first. Codex runs no hook for its dialog tool, so
 * the call shows only in the transcript, and the answer arrives later as the person's next prompt. The turn is the
 * one with `turnId`, or the newest when none is given. A transcript that cannot be read gives no dialogs.
 * Only the last few megabytes are read. When they hold no turn start, they count as the turn.
 */
export async function dialogsInTurn(path: string | null, turnId: string | undefined): Promise<DialogQuestion[][]> {
  if (path === null) return []
  try {
    const file = await open(path, 'r')
    try {
      const { size } = await file.stat()
      const start = Math.max(0, size - TAIL_BYTES)
      const buf = Buffer.alloc(size - start)
      const { bytesRead } = await file.read(buf, 0, buf.length, start)
      const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
      if (start > 0) lines.shift()

      const byTurn = new Map<string, DialogQuestion[][]>()
      let current = ''
      let newest = ''
      for (const line of lines) {
        if (!line.includes('"task_started"') && !line.includes(DIALOG_TOOL)) continue
        let row: TranscriptLine
        try {
          row = JSON.parse(line) as TranscriptLine
        } catch {
          continue
        }
        const p = row.payload
        if (row.type === 'event_msg' && p?.type === 'task_started' && p.turn_id) {
          current = p.turn_id
          newest = current
          if (!byTurn.has(current)) byTurn.set(current, [])
        } else if (row.type === 'response_item' && p?.type === 'function_call' && p.name === DIALOG_TOOL) {
          let args: { questions?: unknown }
          try {
            args = JSON.parse(p.arguments ?? '') as { questions?: unknown }
          } catch {
            continue
          }
          byTurn.set(current, [...(byTurn.get(current) ?? []), dialogQuestions(args.questions)])
        }
      }
      const wanted = newest === '' ? '' : (turnId ?? newest)

      return (byTurn.get(wanted) ?? []).filter(questions => questions.length > 0)
    } finally {
      await file.close()
    }
  } catch {
    return []
  }
}
