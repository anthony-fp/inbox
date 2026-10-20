import { forkedFrom, hasLedger, isUnseen } from '../../hooks/session'
import { heardState } from './core'
import { readState } from './state'
import type { SessionState } from './state'
import { forkedFromId, readRollout } from './transcript'

export type EarlierHistory = {
  /** The data folder, where a forked chat's parent keeps its state. */
  dir: string
  rolloutPath: string
  /** The folder the rollout's paths are shown relative to. */
  cwd: string
  /** The turn a hook runs in, which is not an earlier turn. */
  currentTurnId?: string
  /** False for a compaction start, which runs in the middle of a turn. */
  canMarkBehind?: boolean
}

/** A forked chat takes the parent's ledger when the parent has one. */
async function withForkedLedger(s: SessionState, { dir, rolloutPath }: EarlierHistory): Promise<SessionState> {
  const parentId = await forkedFromId(rolloutPath)
  const parent = parentId === null ? null : await readState(dir, parentId).catch(() => null)

  return parent !== null && hasLedger(parent) ? forkedFrom(s, parent) : s
}

/**
 * What the first sight of a session the inbox has heard nothing from takes from its rollout. A fork takes its parent's
 * ledger. A session whose rollout holds earlier turns and whose ledger is still empty, as when the plugin was turned
 * on in the middle of a conversation, is marked `behind`, and `isBehind` says an update should catch it up. A session
 * a hook or the tab has already recorded is returned as it is.
 */
export async function withEarlierHistory(
  s: SessionState,
  history: EarlierHistory,
): Promise<{ state: SessionState; isBehind: boolean }> {
  if (heardState(s.heard) !== 'none') return { state: s, isBehind: false }
  const forked = await withForkedLedger(s, history)
  const { rolloutPath, cwd, currentTurnId, canMarkBehind = true } = history
  if (!canMarkBehind || !isUnseen(forked)) return { state: forked, isBehind: false }
  const rollout = await readRollout(rolloutPath, cwd, currentTurnId)
  if ((rollout?.earlierTurns ?? 0) === 0) return { state: forked, isBehind: false }

  return { state: { ...forked, presence: { ...forked.presence, ledgerState: 'behind' } }, isBehind: true }
}
