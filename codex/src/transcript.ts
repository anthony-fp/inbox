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

/** A shell command that finished, with the text it printed. */
export type FinishedCommand = { command: string; output: string }

type TranscriptLine = {
  type?: string
  payload?: {
    type?: string
    name?: string
    arguments?: unknown
    turn_id?: string
    call_id?: string
    output?: unknown
    action?: { command?: unknown }
    item?: { type?: string; command?: unknown; aggregated_output?: unknown }
  }
}

const SHELL_CALLS = new Set(['shell', 'shell_command', 'exec_command', 'container.exec'])
const MARKERS = ['"task_started"', DIALOG_TOOL, '"CommandExecution"', '"function_call', '"local_shell_call']

const isText = (v: unknown): v is string => typeof v === 'string'

/** The command line of an argv such as `["/bin/zsh", "-lc", "gh pr create"]`, without its shell wrapper. */
function commandText(command: unknown): string {
  if (isText(command)) return command
  if (!Array.isArray(command)) return ''
  const argv = command.filter(isText)
  const [, flag, script] = argv

  return argv.length === 3 && flag?.startsWith('-') && flag.endsWith('c') && script !== undefined
    ? script
    : argv.join(' ')
}

/** A function call's output is its text, or JSON holding the text as `output`. */
function outputText(output: unknown): string {
  if (!isText(output)) return ''
  try {
    const parsed = JSON.parse(output) as { output?: unknown }

    return isText(parsed.output) ? parsed.output : output
  } catch {
    return output
  }
}

function callCommand(p: NonNullable<TranscriptLine['payload']>): string {
  if (p.type === 'local_shell_call') return commandText(p.action?.command)
  if (p.type !== 'function_call' || !p.name || !SHELL_CALLS.has(p.name) || !isText(p.arguments)) return ''
  try {
    const args = JSON.parse(p.arguments) as { command?: unknown; cmd?: unknown }

    return commandText(args.command ?? args.cmd)
  } catch {
    return ''
  }
}

type TurnRows = { dialogs: DialogQuestion[][]; commands: FinishedCommand[] }

/**
 * What the agent did in a turn, oldest first, read from the transcript. Codex runs no hook for its dialog tool,
 * and a shell command's output reaches no hook at all when the command runs long, so both show only here.
 * The turn is the one with `turnId`, or the newest when none is given. Only the last few megabytes are read. When
 * they hold no turn start, they count as the turn. A transcript that cannot be read gives an empty turn.
 *
 * `dialogs` holds the questions of each dialog, and the answer arrives later as the person's next prompt.
 * `commands` holds each shell command that finished. The `CommandExecution` rows of Codex CLI 0.163 and later give
 * them. A turn with none falls back to older shell calls and their outputs.
 */
export async function turnIn(path: string | null, turnId: string | undefined): Promise<TurnRows> {
  const none: TurnRows = { dialogs: [], commands: [] }
  if (path === null) return none
  try {
    const file = await open(path, 'r')
    try {
      const { size } = await file.stat()
      const start = Math.max(0, size - TAIL_BYTES)
      const buf = Buffer.alloc(size - start)
      const { bytesRead } = await file.read(buf, 0, buf.length, start)
      const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
      if (start > 0) lines.shift()

      type Turn = {
        dialogs: DialogQuestion[][]
        executions: FinishedCommand[]
        calls: Map<string, FinishedCommand>
        called: FinishedCommand[]
      }
      const byTurn = new Map<string, Turn>()
      const newTurn = (): Turn => ({ dialogs: [], executions: [], calls: new Map(), called: [] })
      let current = ''
      let newest = ''
      for (const line of lines) {
        if (!MARKERS.some(m => line.includes(m))) continue
        let row: TranscriptLine
        try {
          row = JSON.parse(line) as TranscriptLine
        } catch {
          continue
        }
        const p = row.payload
        if (!p) continue
        if (row.type === 'event_msg' && p.type === 'task_started' && p.turn_id) {
          current = p.turn_id
          newest = current
          if (!byTurn.has(current)) byTurn.set(current, newTurn())
          continue
        }
        const turn = byTurn.get(current) ?? newTurn()
        byTurn.set(current, turn)
        if (row.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'CommandExecution') {
          const output = p.item.aggregated_output
          turn.executions.push({ command: commandText(p.item.command), output: isText(output) ? output : '' })
        } else if (row.type === 'response_item' && p.type === 'function_call' && p.name === DIALOG_TOOL) {
          let args: { questions?: unknown }
          try {
            args = JSON.parse(isText(p.arguments) ? p.arguments : '') as { questions?: unknown }
          } catch {
            continue
          }
          turn.dialogs.push(dialogQuestions(args.questions))
        } else if (row.type === 'response_item' && (p.type === 'function_call' || p.type === 'local_shell_call')) {
          const command = callCommand(p)
          if (command !== '' && p.call_id) turn.calls.set(p.call_id, { command, output: '' })
        } else if (row.type === 'response_item' && p.type === 'function_call_output' && p.call_id) {
          const call = turn.calls.get(p.call_id)
          if (call) turn.called.push({ command: call.command, output: outputText(p.output) })
        }
      }
      const wanted = newest === '' ? '' : (turnId ?? newest)
      const turn = byTurn.get(wanted)
      if (!turn) return none

      return {
        dialogs: turn.dialogs.filter(questions => questions.length > 0),
        commands: turn.executions.length > 0 ? turn.executions : turn.called,
      }
    } finally {
      await file.close()
    }
  } catch {
    return none
  }
}
