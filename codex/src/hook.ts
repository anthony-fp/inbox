import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { dialogActivity } from '../../hooks/model-text'
import { cleared, isUnseen, needsUpdate, noteActivity, noteCommandOutput, startContext } from '../../hooks/session'
import { activityOf, endTurn, heardState, noteHook, notePrompt, patchFiles } from './core'
import { updateState } from './state'
import type { SessionState } from './state'
import { CODEX } from './texts'
import { isNonInteractiveRun, readRollout, turnIn } from './transcript'

export type HookInput = {
  hook_event_name: string
  session_id: string
  turn_id?: string
  /** Set when a subagent's hook fires. It carries the parent's session id. */
  agent_id?: string
  transcript_path: string | null
  cwd?: string
  source?: string
  prompt?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  last_assistant_message?: string | null
}

export type HookDeps = {
  dir: string
  env: NodeJS.ProcessEnv
  now: () => number
  startUpdate: (sessionId: string) => void
}

export async function handleHook(input: HookInput, deps: HookDeps): Promise<Record<string, unknown> | null> {
  const id = input.session_id
  const { dir, env, now } = deps
  // INBOX_IN_EXEC lets a test drive a whole session through `codex exec`.
  if (!id || (!env.INBOX_IN_EXEC && (await isNonInteractiveRun(input.transcript_path)))) return null
  const cliPath = env.CODEX_CLI_PATH || null
  const withCli = (s: SessionState): SessionState => (cliPath && s.cliPath !== cliPath ? { ...s, cliPath } : s)
  // A subagent's hook names its own rollout, not the session's.
  const rolloutPath = input.agent_id ? null : input.transcript_path
  const withRollout = (s: SessionState): SessionState =>
    rolloutPath !== null && s.transcriptPath !== rolloutPath ? { ...s, transcriptPath: rolloutPath } : s
  const withHost = (s: SessionState): SessionState => withRollout(withCli(s))
  let isMarkedBehind = false
  /**
   * The first hook of a session the inbox has recorded nothing of marks the ledger `behind` when the rollout holds
   * earlier turns, as when the plugin was turned on in the middle of a conversation. A compaction start runs in the
   * middle of a turn, so it marks nothing.
   */
  const withBehind = async (s: SessionState): Promise<SessionState> => {
    const isFirstHook = heardState(s.heard) === 'none'
    if (!isFirstHook || rolloutPath === null || input.source === 'compact' || !isUnseen(s)) return s
    const rollout = await readRollout(rolloutPath, input.cwd ?? s.root, input.turn_id)
    if ((rollout?.earlierTurns ?? 0) === 0) return s
    isMarkedBehind = true

    return { ...s, presence: { ...s.presence, ledgerState: 'behind' } }
  }

  switch (input.hook_event_name) {
    case 'SessionStart': {
      const root = input.cwd ?? ''
      const s = await updateState(dir, id, async s =>
        noteHook(withHost(await withBehind({ ...(input.source === 'clear' ? cleared(s) : s), root })), 'start', now()),
      )
      if (isMarkedBehind) deps.startUpdate(id)

      const context = startContext(CODEX, s, input.source)

      return context ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } } : null
    }
    case 'UserPromptSubmit': {
      let notes: string[] = []
      await updateState(dir, id, async s => {
        const r = notePrompt(withHost(await withBehind(s)), input.prompt ?? '', now())
        notes = r.notes

        return input.agent_id ? r.state : noteHook(r.state, 'prompt', now(), input.turn_id)
      })
      if (isMarkedBehind) deps.startUpdate(id)

      return notes.length === 0
        ? null
        : { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notes.join('\n\n') } }
    }
    case 'PreToolUse': {
      const tool = input.tool_name ?? ''
      const toolInput = input.tool_input ?? {}
      const command = typeof toolInput.command === 'string' ? toolInput.command : ''
      if (tool === 'apply_patch') {
        const files = patchFiles(command).map(f => resolve(input.cwd || '/', f))
        await updateState(dir, id, s => files.reduce((x, f) => noteActivity(x, `edited ${f}`), withRollout(s)))

        return null
      }
      const line = activityOf(tool, toolInput)
      if (line) await updateState(dir, id, s => noteActivity(withRollout(s), line))

      return null
    }
    case 'Stop': {
      const reply = input.last_assistant_message ?? ''
      const { dialogs, commands } = await turnIn(input.transcript_path, input.turn_id)
      const lines = dialogs.map(questions => dialogActivity(questions, { kind: 'open' }))
      const written = await updateState(dir, id, async s => {
        const withLines = lines.reduce((x, line) => noteActivity(x, line), withHost(await withBehind(s)))
        const withOutput = commands.reduce((x, c) => noteCommandOutput(x, c.command, c.output), withLines)

        return noteHook(endTurn(withOutput, reply, now()), 'stop', now())
      })
      if (needsUpdate(written)) deps.startUpdate(id)

      return null
    }
  }

  return null
}

/** Starts the update in a detached process, so a model call longer than the hook's limit still finishes. */
export function detachedUpdate(dir: string, env: NodeJS.ProcessEnv, script: string): (sessionId: string) => void {
  return sessionId => {
    const child = spawn(process.execPath, [script, sessionId], {
      detached: true,
      stdio: 'ignore',
      env: { ...env, INBOX_DATA: dir },
    })
    child.unref()
  }
}
