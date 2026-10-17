import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { applyExchangeUpdate, parseReply } from '../../hooks/ledger'
import { buildPrompt, systemText } from '../../hooks/model-text'
import { readState, statePath, tryWithLock, updateState } from './state'
import type { SessionState } from './state'
import { CODEX } from './texts'
import type { Run } from './run'

/** The inbox model, at low reasoning effort. gpt-6-luna is faster but closed a finding the reply only mentioned. */
export const MODEL = 'gpt-6.1-sol'
const TIMEOUT_MS = 120_000

/** A release that drops one of these rejects it by name, so askModel drops any name rejected and tries again. */
const OFF = [
  'shell_tool',
  'unified_exec',
  'code_mode_host',
  'apps',
  'plugins',
  'memories',
  'multi_agent',
  'image_generation',
  'browser_use',
  'computer_use',
  'tool_suggest',
  'skill_search',
  'view_image',
  'goals',
  'sleep_tool',
  'personality',
]

export type Ask = (prompt: string) => Promise<string | null>

/** Null when it fails. */
export function codexAsk(exec: Run, cli: string, dir: string): Ask {
  return async prompt => {
    const work = join(dir, 'exec')
    const system = join(dir, 'inbox-system.md')
    const out = join(work, `reply-${randomUUID()}.txt`)
    await mkdir(work, { recursive: true })
    const instructions = systemText(CODEX)
    if ((await readFile(system, 'utf8').catch(() => '')) !== instructions) await writeFile(system, instructions)
    let off = [...OFF]
    for (let tries = 0; tries <= OFF.length; tries += 1) {
      await rm(out, { force: true })
      const r = await exec(
        [
          cli,
          'exec',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '-C',
          work,
          '-m',
          MODEL,
          '-c',
          'model_reasoning_effort="low"',
          '-c',
          `model_instructions_file=${JSON.stringify(system)}`,
          '-c',
          'project_doc_max_bytes=0',
          ...off.flatMap(f => ['--disable', f]),
          '-o',
          out,
          prompt,
        ],
        { cwd: work, timeoutMs: TIMEOUT_MS },
      )
      const unknown = r.stderr.match(/Unknown feature flag: (\S+)/)?.[1]
      if (r.code !== 0 && unknown && off.includes(unknown)) {
        off = off.filter(f => f !== unknown)
        continue
      }
      if (r.code !== 0) return null
      const text = await readFile(out, 'utf8').catch(() => null)
      await rm(out, { force: true })

      return text
    }

    return null
  }
}

/**
 * Applies the model's answer for the oldest pending exchange, and drops that exchange. One whose first update
 * failed stays pending, marked failed, for the next update to try again.
 */
export function applied(s: SessionState, reply: string | null, now: number, promptAt: number): SessionState {
  const next = s.pending[0]
  if (!next) return s
  const { ex } = next
  const parsed = reply === null ? null : parseReply(reply, [ex.reply, ...ex.activity].join('\n'))
  if (!parsed && !next.failed)
    return {
      ...s,
      pending: [{ ...next, failed: true }, ...s.pending.slice(1)],
      presence: { ...s.presence, ledgerState: 'failed' },
    }
  const ledger = parsed ? applyExchangeUpdate(s.ledger, parsed, ex, now, promptAt) : s.ledger

  return {
    ...s,
    ledger,
    pending: s.pending.slice(1),
    presence: {
      ...s.presence,
      ledgerState: parsed ? 'current' : 'failed',
      turnsApplied: Math.max(s.presence.turnsApplied, next.turnsStarted),
    },
  }
}

export async function reconcileUpdateStatus(dir: string, sessionId: string): Promise<SessionState> {
  const state = await readState(dir, sessionId)
  if (!state.presence.isUpdating) return state
  const checked = await tryWithLock(`${statePath(dir, sessionId)}.updating`, () =>
    updateState(dir, sessionId, current =>
      current.presence.isUpdating
        ? {
            ...current,
            presence: {
              ...current.presence,
              isUpdating: false,
              ledgerState: current.pending.length > 0 ? 'failed' : current.presence.ledgerState,
            },
          }
        : current,
    ),
  )
  return checked.acquired ? checked.value : state
}

/**
 * Runs the pending exchanges, oldest first, while this process holds the
 * update lock. An update started meanwhile finds the lock held and exits, so
 * the pending list is read again after the lock is released.
 */
export async function runUpdates(dir: string, sessionId: string, ask: Ask, now: () => number): Promise<void> {
  const lock = `${statePath(dir, sessionId)}.updating`
  while ((await readState(dir, sessionId)).pending.length > 0) {
    const held = await tryWithLock(lock, async () => {
      try {
        for (;;) {
          const s = await updateState(dir, sessionId, x => ({
            ...x,
            presence: { ...x.presence, isUpdating: x.pending.length > 0 },
          }))
          const next = s.pending[0]
          if (!next) break
          const promptAt = now()
          const reply = await ask(buildPrompt(s.ledger, next.ex)).catch(() => null)
          const after = await updateState(dir, sessionId, x =>
            x.pending[0]?.turnsStarted === next.turnsStarted && x.pending[0].ex.turn === next.ex.turn
              ? applied(x, reply, now(), promptAt)
              : x,
          )
          if (after.pending[0]?.failed && !next.failed) return 'retry' as const
        }
      } finally {
        await updateState(dir, sessionId, x => ({ ...x, presence: { ...x.presence, isUpdating: false } }))
      }
    })
    if (!held.acquired || held.value === 'retry') return
  }
}
