// The plugin's session logic as pure functions on SessionState: what a prompt
// tells Codex, what the tab shows, and how a turn ends.
// Hooks and the MCP server do the I/O around them.

import { EMPTY } from '../../hooks/ledger'
import type { Exchange, Press } from '../../hooks/ledger'
import {
  addActivity,
  carryText,
  guidanceText,
  promptNotes,
  screenText,
  START_TITLE,
  toolActivity,
} from '../../hooks/model-text'
import { inboxView, perTurnStatus } from '../../hooks/view'
import type { InboxView } from '../../hooks/view'
import { drawnPrs, itemPrSteps, linkedPrs, olderPrsText, threadSentIn } from '../../hooks/pr-tab'
import { withArrival, withUnconfirmed } from '../../hooks/presses'
import { prNeedsYou, prRefs } from '../../hooks/prs'
import type { LastAction, PrView, Turns } from '../../types'
import { PRESS_TIMEOUT_MS, SETTLE_WINDOW_MS } from './settle'
import type { Heard, SessionState } from './state'
import { CODEX } from './texts'

/** The tab polls every few seconds; a poll this recent means it is open. */
const TAB_OPEN_MS = 15_000

export function isTabOpen(s: SessionState, now: number): boolean {
  return now - s.tabSeenAt < TAB_OPEN_MS
}

/**
 * What SessionStart gives Codex: the guidance, and where the session stands
 * when it has a ledger. A resumed conversation still holds the guidance from
 * its start, so it gets only where the session stands. Null when that is empty.
 */
export function startContext(s: SessionState, source: string | undefined): string | null {
  const carried = carryText(s.ledger, START_TITLE, true)
  const parts = [source === 'resume' ? null : guidanceText(CODEX), carried].filter((x): x is string => x !== null)

  return parts.length > 0 ? parts.join('\n\n') : null
}

/** A cleared conversation starts a new ledger; the rest of the state stays. */
export function cleared(s: SessionState): SessionState {
  return {
    ...s,
    ledger: EMPTY,
    turn: { person: null, activity: [], press: null },
    told: { inbox: null, closed: [] },
    pending: [],
    lastActions: {},
  }
}

/**
 * Records a prompt and returns what Codex reads beside it: the questions a
 * numbered answer refers to, and the inbox when it changed. A message the
 * tab sent is matched by its text, since UserPromptSubmit carries only that.
 * An uncertain earlier attempt blocks a same-text match with a later send.
 */
export function notePrompt(s: SessionState, text: string, now: number): { state: SessionState; notes: string[] } {
  const matchingAt = s.sent.findIndex(x => x.text === text)
  const matching = matchingAt >= 0 ? s.sent[matchingAt] : undefined
  const sentAt = matching && (matching.phase === undefined || matching.phase === 'accepted') ? matchingAt : -1
  const sentBy: Press | null = sentAt >= 0 ? (s.sent[sentAt]?.press ?? null) : null
  const sent = sentAt >= 0 ? s.sent[sentAt] : undefined
  const eligible =
    sent?.deliveryId === null
      ? Object.fromEntries(
          Object.entries(s.lastActions).filter(
            ([_id, last]) =>
              (last.delivery?.state === 'queued' || last.delivery?.state === 'unconfirmed') &&
              last.delivery.id === undefined,
          ),
        )
      : s.lastActions
  const arrived =
    sent && sent.row !== null
      ? {
          ...s.lastActions,
          ...(sent.deliveryId === null
            ? withUnconfirmed(eligible, text)
            : withArrival(eligible, text, sent.pressedAt ?? undefined, sent.deliveryId)),
        }
      : s.lastActions
  const lastActions = s.sent
    .slice(matchingAt + 1)
    .reduce(
      (actions, later) =>
        later.text === text && later.row !== null
          ? withUnconfirmed(actions, text, later.pressedAt ?? undefined, later.deliveryId)
          : actions,
      arrived,
    )
  const ledger = { ...s.ledger, turn: s.ledger.turn + 1 }
  const r = promptNotes(CODEX, ledger, { text, isPress: sentAt >= 0, isOpen: isTabOpen(s, now) }, s.told)
  const person = s.turn.person === null ? text : `${s.turn.person}\n\n${text}`

  return {
    state: {
      ...s,
      ledger,
      told: r.told,
      lastActions,
      sent: sentAt >= 0 ? s.sent.filter((_x, i) => i !== sentAt) : s.sent,
      turn: { ...s.turn, person, press: sentBy ?? s.turn.press },
      presence: { ...s.presence, turnsStarted: s.presence.turnsStarted + 1 },
    },
    notes: r.notes,
  }
}

export function noteActivity(s: SessionState, line: string | null): SessionState {
  const activity = addActivity(s.turn.activity, line)
  if (activity === s.turn.activity) return s

  return { ...s, turn: { ...s.turn, activity } }
}

/** What the agent did with a tool, as an activity line: Codex's shell and MCP tools read as the mod's Bash and MCP tools. */
export function activityOf(tool: string, input: Record<string, unknown>): string | null {
  return toolActivity(tool === 'Bash' ? 'Bash' : tool, input)
}

/** The files a patch adds, updates or deletes, as written in it. */
export function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(m => (m[1] ?? '').trim())
    .filter(Boolean)
}

/** Ends the turn: the exchange waits for the inbox model. */
export function endTurn(s: SessionState, reply: string, now: number): SessionState {
  const refs = prRefs(reply)
  const base = {
    ...s,
    ledger: refs.length > 0 ? { ...s.ledger, prs: linkedPrs(s.ledger.prs, refs) } : s.ledger,
    turn: { person: null, activity: [], press: null },
  }
  if (reply.trim() === '') return base
  const ex: Exchange = {
    person: s.turn.person,
    trigger: s.turn.person === null ? 'unknown' : null,
    activity: s.turn.activity,
    reply,
    turn: s.ledger.turn,
    press: s.turn.press,
    screen: screenText(CODEX, isTabOpen(s, now), null),
  }

  return { ...base, pending: [...base.pending, { ex, turnsStarted: s.presence.turnsStarted }] }
}

/** How many of UserPromptSubmit's turn ids the session keeps. */
const MAX_PROMPT_TURNS = 10

/** Records that a hook ran: SessionStart, UserPromptSubmit with its turn id, or Stop. */
export function noteHook(
  s: SessionState,
  hook: 'start' | 'prompt' | 'stop',
  now: number,
  turnId?: string,
): SessionState {
  const h = s.heard
  const heard: Heard =
    hook === 'start'
      ? { ...h, startAt: now }
      : hook === 'prompt'
        ? {
            ...h,
            promptAt: now,
            prompts: h.prompts + 1,
            promptTurns: turnId
              ? [...h.promptTurns.filter(t => t !== turnId), turnId].slice(-MAX_PROMPT_TURNS)
              : h.promptTurns,
          }
        : { ...h, stopAt: now, stops: h.stops + 1 }

  return { ...s, heard }
}

/**
 * Whether a model tool call came in a turn UserPromptSubmit did not record.
 * Another plugin's Stop hook can send Codex back within the same turn, so the
 * turn ids decide. Times decide only for a call with no turn id, or when no turn id was recorded.
 */
export function isPromptMissed(h: Heard, turnId: string | null): boolean {
  if (turnId !== null && (h.promptTurns.length > 0 || h.promptAt === null)) return !h.promptTurns.includes(turnId)

  return h.promptAt === null || (h.stopAt !== null && h.promptAt < h.stopAt)
}

/** Records a model tool call: when its turn was not recorded, UserPromptSubmit is being skipped. */
export function noteToolCall(s: SessionState, turnId: string | null, now: number): SessionState {
  return isPromptMissed(s.heard, turnId) ? { ...s, heard: { ...s.heard, promptMissedAt: now } } : s
}

/**
 * Whether the session's hooks are running: `none` when no hook ran, `partial`
 * when SessionStart did not run but another hook did, when UserPromptSubmit
 * missed a turn since it last ran, or when it recorded two turns and Stop none,
 * so no reply reaches the inbox model.
 */
export type HeardState = 'heard' | 'none' | 'partial'

export function heardState(h: Heard): HeardState {
  if (h.startAt === null && h.promptAt === null && h.stopAt === null) return 'none'
  const isMissed = h.promptMissedAt !== null && (h.promptAt === null || h.promptMissedAt >= h.promptAt)
  // Prompts in one turn, such as a steer, share its turn id. A prompt with no turn id counts on its own.
  const turns = h.promptTurns.length > 0 ? h.promptTurns.length : h.prompts

  return h.startAt === null || isMissed || (turns >= 2 && h.stops === 0) ? 'partial' : 'heard'
}

/** The PRs the tab draws, each with whether it is the settled block of a PR just dismissed. */
export type PrTab = {
  drawn: { pr: PrView; isSettled: boolean }[]
  branchRef: string | null
  /** How many open PRs wait on the person. */
  count: number
  /** Names the linked PRs too old for the tab to show, or null. */
  olderText: string | null
}

/** What the tab draws: the shared inbox view, and what only the tab reads. */
export type View = InboxView & {
  heard: HeardState
  done: string[]
  running: string[]
  /** Each row's last press, by row id. The tab draws from each row's feedback; a tab loaded before that still reads this. */
  lastActions: Record<string, LastAction>
  /** The turn counts each row's feedback reads, as "Explaining…" until the reply to its press. */
  turns: Turns
  prs: PrTab
  /** When the view was drawn, for the rows' ages. */
  at: number
}

/**
 * The view as the server sends it to the tab, with the session the call came
 * from. The tab sends `thread` back with each press, which reads as stale in any other session.
 * `devPage` is the address of the page the server serves now. A tab showing another page replaces itself with it.
 * The name is older than installed builds reloading, and tabs open from older builds still read it.
 * `serverBuild` is the fingerprint build.mjs stamped into the running server. `serverLoadError` says why a newer
 * build of the server did not load.
 */
export type TabView = View & {
  thread: string
  devPage: string
  serverBuild?: string
  serverLoadError?: string
  /** A fetch of the session's PRs runs now. */
  isFetchingPrs: boolean
  /** Neither `gh` nor the usual install folders hold a gh the server can start. */
  isGhMissing: boolean
}

/**
 * Each row's last press, without a Local result still pending after PRESS_TIMEOUT_MS. The server
 * runs a press's opens after saving it as pending, so a server that died between them left it pending.
 * The saved result stays, since a slow server may still record its outcome.
 */
function withoutStalePending(lastActions: Record<string, LastAction>, now: number): Record<string, LastAction> {
  const isStale = (last: LastAction) => last.result?.state === 'pending' && now - last.result.at > PRESS_TIMEOUT_MS

  return Object.fromEntries(
    Object.entries(lastActions).map(([id, last]) => {
      if (!isStale(last)) return [id, last]
      const { result: _result, ...rest } = last
      return [id, rest]
    }),
  )
}

/** What the tab draws. */
export function viewOf(s: SessionState, now: number): View {
  const l = s.ledger
  const lastActions = withoutStalePending(s.lastActions, now)
  const awaitsRetry = s.pending.length > 0 && (s.pending[0]?.failed === true || s.presence.ledgerState === 'failed')
  const update = {
    isUpdating: s.presence.isUpdating,
    isFailed: s.presence.ledgerState === 'failed',
    retries: awaitsRetry,
  }

  return {
    ...inboxView({
      ledger: l,
      lastActions,
      // The tab keeps its own row notes.
      notes: {},
      turns: s.presence,
      extraSteps: Object.fromEntries(l.items.map(item => [item.id, itemPrSteps(item, s.prViews, l.prs)])),
      // The tab times each settled row from its first poll, so the server lists a close for longer.
      settleWindowMs: SETTLE_WINDOW_MS,
      status: perTurnStatus(update),
      now,
    }),
    heard: heardState(s.heard),
    done: l.card?.done ?? [],
    running: l.card?.running ?? [],
    lastActions,
    turns: { turnsStarted: s.presence.turnsStarted, turnsApplied: s.presence.turnsApplied },
    prs: prTabOf(s, lastActions, now),
    at: now,
  }
}

function prTabOf(s: SessionState, lastActions: Record<string, LastAction>, now: number): PrTab {
  const drawn = drawnPrs(s.prViews, s.ledger.prs, lastActions, now)
  const isSent = threadSentIn(lastActions)

  return {
    drawn,
    branchRef: s.prViews.branchRef,
    count: drawn.filter(d => !d.isSettled && prNeedsYou(d.pr, isSent)).length,
    olderText: olderPrsText(s.ledger.prs),
  }
}
