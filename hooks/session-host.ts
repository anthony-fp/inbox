import { buildPrompt } from './model-text'
import { fetchTracked, prRowId, splitLinked } from './pr-tab'
import type { GhRun, PrPress } from './pr-tab'
import {
  doneWake,
  markSentToAgent,
  recordPress,
  refuseDoneNotification,
  runLocalEffects,
  runSends,
  withDeliveryId,
  withLasts,
  withUnconfirmed,
} from './presses'
import type { Effect, EffectHost, RowPress } from './presses'
import { applied, completedAttempt, pressOn, withFetchedPrs } from './session'
import type { Pressed, SendOutcome, Session } from './session'
import type { ReplyHolds } from './view'
import type { RowNote } from '../types'

export type Ask = (prompt: string) => Promise<string | null>

/** Everything a host supplies to run one session. A function here takes the members it uses. */
export type SessionHost<S extends Session> = {
  now(): number | Promise<number>
  read(): Promise<S>
  /** Changes the session under its lock. An external effect, such as a delivery, runs outside a change. */
  update(change: (s: S) => S | Promise<S>): Promise<S>
  /** Runs `fn` unless another run holds the session's per-reply update. */
  exclusive<T>(fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>
  /** Calls the inbox model. Null when it fails. */
  ask: Ask
  /** Sends a message to the agent as if the person typed it. Runs outside a change, so it may change the session itself. */
  deliver(s: S, text: string, deliveryId: string): Promise<SendOutcome>
  /** Throws when `deliver` could not start. Run before a sent record is saved, so a message that cannot go leaves no record. */
  prepare?(s: S): Promise<void>
  /** Opens a link or path, or copies text. Returns why it could not, or null. */
  perform(s: S, effect: Exclude<Effect, { kind: 'send' }>): Promise<string | null>
  gh: {
    /** The gh to run, or null when none starts. */
    find(): Promise<string | null>
    /** Drops the gh `find` kept, so the next call looks again. */
    forget(): void
    /** Runs gh for the session. `onUnstartable` is called when a run cannot start. */
    run(s: S, bin: string, onUnstartable: () => void): GhRun
    /** Reports whether gh was found. */
    noteMissing(isMissing: boolean): void
  }
  /** How long a closed row stays settled before the agent is told about it. */
  settleWindowMs: number
  /** A new id for a delivery. */
  newId(): string
  /** Whether a turn runs now, which holds a Done message back. Without it, a turn runs while the turn has a person's words. */
  isTurnRunning?(s: S): boolean
}

export type UpdateHost<S extends Session> = Pick<SessionHost<S>, 'now' | 'read' | 'update' | 'exclusive' | 'ask'>

export async function reconcileUpdateStatus<S extends Session>(
  host: Pick<UpdateHost<S>, 'read' | 'update' | 'exclusive'>,
): Promise<S> {
  const state = await host.read()
  if (!state.presence.isUpdating) return state
  const checked = await host.exclusive(() =>
    host.update(current =>
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
export async function runUpdates<S extends Session>(host: UpdateHost<S>): Promise<void> {
  while ((await host.read()).pending.length > 0) {
    const held = await host.exclusive(async () => {
      try {
        for (;;) {
          const s = await host.update(x => ({
            ...x,
            presence: { ...x.presence, isUpdating: x.pending.length > 0 },
          }))
          const next = s.pending[0]
          if (!next) break
          const promptAt = await host.now()
          const reply = await host.ask(buildPrompt(s.ledger, next.ex)).catch(() => null)
          const after = await host.update(async x =>
            x.pending[0]?.turnsStarted === next.turnsStarted && x.pending[0].ex.turn === next.ex.turn
              ? applied(x, reply, await host.now(), promptAt)
              : x,
          )
          if (after.pending[0]?.failed && !next.failed) return 'retry' as const
        }
      } finally {
        await host.update(x => ({ ...x, presence: { ...x.presence, isUpdating: false } }))
      }
    })
    if (!held.acquired || held.value === 'retry') return
  }
}

type WakeHost<S extends Session> = Pick<
  SessionHost<S>,
  'now' | 'read' | 'update' | 'deliver' | 'prepare' | 'settleWindowMs' | 'newId' | 'isTurnRunning'
>

/**
 * Tells the agent about rows closed with Done once their settle window has passed. A refused message
 * marks those rows with why, so they read "Not sent" and offer Undo.
 */
export async function wakeForDone<S extends Session>(host: WakeHost<S>): Promise<void> {
  const check = async (s: S) =>
    doneWake(s.ledger, {
      now: await host.now(),
      windowMs: host.settleWindowMs,
      isTurnRunning: host.isTurnRunning ? host.isTurnRunning(s) : s.turn.person !== null,
    })
  if (!(await check(await host.read()))) return
  let attempt: { deliveryId: string; text: string } | null = null
  await host.update(async s => {
    // A host may run the change again on a newer session, which can have nothing left to send.
    attempt = null
    const wake = await check(s)
    if (!wake) return s
    await host.prepare?.(s)
    const deliveryId = host.newId()
    attempt = { deliveryId, text: wake.text }
    const lastActions = { ...s.lastActions }
    for (const closed of s.ledger.closed) {
      if (!wake.ids.includes(closed.id)) continue
      const previous = lastActions[closed.id]
      const last =
        previous?.kind === 'mark' && previous.action === 'done' && previous.at === closed.at
          ? previous
          : recordPress('mark', 'done', 'Done', { now: closed.at, turnsStarted: s.presence.turnsStarted })
      lastActions[closed.id] = { ...last, delivery: { state: 'unconfirmed', message: wake.text, id: deliveryId } }
    }
    const next: S = {
      ...s,
      ledger: markSentToAgent(s.ledger, wake.ids, deliveryId),
      lastActions,
      sent: [
        ...s.sent,
        {
          text: wake.text,
          press: { id: wake.ids[0]!, action: 'done' },
          at: await host.now(),
          row: wake.ids[0]!,
          queuedId: null,
          pressedAt: null,
          deliveryId,
          phase: 'attempting',
        },
      ],
    }

    return next
  })
  const sending = attempt as { deliveryId: string; text: string } | null
  if (!sending) return
  const outcome = await host.deliver(await host.read(), sending.text, sending.deliveryId)
  await host.update(s => {
    const after = completedAttempt(s, sending.deliveryId, outcome)

    return outcome.state === 'rejected'
      ? { ...after, ledger: refuseDoneNotification(after.ledger, sending.deliveryId, outcome.reason) }
      : after
  })
}

export type PressOutcome = {
  copy: { text: string; name: string } | null
  error: string | null
  note: RowNote['note'] | null
  /** The delivery may or may not have reached the agent. */
  isUnconfirmed: boolean
  /** The message was refused, and the pressed row still reads that failure, since no later press replaced it. */
  isRowFailed: boolean
  /** The press closed a row with Done. Call `wakeForDone` once the settle window has passed. */
  wakesForDone: boolean
}

type PressHost<S extends Session> = Pick<SessionHost<S>, 'now' | 'read' | 'update' | 'deliver' | 'perform' | 'newId'>

/** A press that is saved, with what it still runs. */
export type StartedPress = {
  /** The effects the press runs. Null when it was stale or could not be saved, so it runs nothing. */
  effects: Effect[] | null
  /** Delivers the press's message, outside the session's lock, then runs its opens and copies. */
  finish(): Promise<PressOutcome>
}

/**
 * Applies and saves a press. When it sends a message, the sent record is saved with it. A look can update its own
 * drawing before `finish` delivers, since a host's delivery can run the host's own handlers before it returns.
 */
export async function startPress<S extends Session>(
  host: PressHost<S>,
  p: RowPress | PrPress,
  isStale: boolean,
  holds: ReplyHolds,
): Promise<StartedPress> {
  const rowId = 'ref' in p ? prRowId(p) : p.id
  const localPressId = host.newId()
  let isUnconfirmed = false
  let isRowFailed = false
  let copy: PressOutcome['copy'] = null
  let error: string | null = null
  let note: PressOutcome['note'] = isStale ? 'stale' : null
  const pressed: { r?: Pressed; at?: number; deliveryId?: string } = {}
  const effectHost: EffectHost = {
    now: host.now,
    deliveryId: () => pressed.deliveryId ?? host.newId(),
    perform: async e => {
      if (e.kind === 'copy') copy = { text: e.text, name: e.name }
      return host.perform(await host.read(), e)
    },
    send: async (e, deliveryId) => {
      try {
        const outcome = await host.deliver(await host.read(), e.text, deliveryId)
        await host.update(s => completedAttempt(s, deliveryId, outcome))
        return outcome.state === 'accepted' ? { state: 'accepted' as const } : outcome
      } catch (err) {
        return { state: 'unconfirmed' as const, reason: err instanceof Error ? err.message : String(err) }
      }
    },
    saveLasts: async f => (await host.update(s => ({ ...s, lastActions: f(s.lastActions) }))).lastActions,
    saveLedger: async f => {
      await host.update(s => ({ ...s, ledger: f(s.ledger) }))
    },
  }
  await host
    .update(async saved => {
      // A host may run the change again on a newer session, where the press can be stale.
      note = isStale ? 'stale' : null
      Object.assign(pressed, { r: undefined, at: undefined, deliveryId: undefined })
      const s: S = { ...saved, heldRows: Object.keys(holds.replies) }
      if (note) return s
      // Read under the lock, so the press is timed after every write that landed before it.
      const at = await host.now()
      const r = pressOn(s, p, at, localPressId)
      if ('stale' in r) {
        note = 'stale'
        return s
      }
      const firstSend = r.effects.find(e => e.kind === 'send')
      const deliveryId = firstSend ? host.newId() : undefined
      const pressLasts =
        firstSend && deliveryId
          ? withDeliveryId(r.lasts, Object.keys(r.lasts), at, firstSend.text, deliveryId)
          : r.lasts
      const next: S = {
        ...s,
        ledger: r.ledger,
        lastActions: withLasts(s.lastActions, pressLasts, r.drop),
        told: r.reopenedId ? { ...s.told, closed: s.told.closed.filter(id => id !== r.reopenedId) } : s.told,
      }
      Object.assign(pressed, { r, at, deliveryId })
      if (!firstSend || !deliveryId) return next

      return {
        ...next,
        lastActions: withUnconfirmed(next.lastActions, firstSend.text, at, deliveryId),
        sent: [
          ...next.sent,
          {
            text: firstSend.text,
            press: firstSend.by,
            at: await host.now(),
            row: rowId,
            queuedId: null,
            pressedAt: at,
            deliveryId,
            phase: 'attempting',
          },
        ],
      }
    })
    .catch((err: unknown) => {
      pressed.r = undefined
      error = `Not sent: ${err instanceof Error ? err.message : String(err)}`
    })
  const r = pressed.r
  const at = pressed.at
  if (!r || at === undefined)
    return {
      effects: null,
      finish: async () => ({ copy, error, note, isUnconfirmed, isRowFailed, wakesForDone: false }),
    }

  return {
    effects: r.effects,
    finish: async () => {
      try {
        const failed = await runSends(effectHost, r.effects, rowId, Object.keys(r.lasts), at)
        if (failed?.state === 'rejected') {
          error = `Not sent: ${failed.reason}`
          isRowFailed = failed.isRowFailed
        }
        if (failed?.state === 'unconfirmed') isUnconfirmed = true
      } catch {
        isUnconfirmed = true
      }
      await runLocalEffects(effectHost, r.effects, rowId, r.lasts[rowId]?.result)

      return { copy, error, note, isUnconfirmed, isRowFailed, wakesForDone: !('ref' in p) && p.action === 'done' }
    },
  }
}

/** Applies a press and runs it: `startPress`, then its `finish`. */
export async function press<S extends Session>(
  host: PressHost<S>,
  p: RowPress | PrPress,
  isStale: boolean,
  holds: ReplyHolds,
): Promise<PressOutcome> {
  return (await startPress(host, p, isStale, holds)).finish()
}

const PRS_REFRESH_MS = 120_000
const NEW_PR_FETCH_MS = 15_000

/** True when the PRs are due for a fetch: none was fetched yet, the last is old, or a new tracked PR waits for its first. */
export function isPrFetchDue(s: Session, lastFetchedAt: number | undefined, now: number): boolean {
  if (lastFetchedAt === undefined) return true
  const hasNewPr = splitLinked(s.ledger.prs).tracked.some(ref => !(ref in s.prViews.views))

  return now - lastFetchedAt >= PRS_REFRESH_MS || (hasNewPr && now - lastFetchedAt >= NEW_PR_FETCH_MS)
}

/**
 * Fetches the PRs the session tracks and merges them in. `findsBranchPr` also looks up the current branch's PR.
 * Returns without fetching when gh cannot start.
 */
export async function fetchPrs<S extends Session>(
  host: Pick<SessionHost<S>, 'now' | 'read' | 'update' | 'gh'>,
  findsBranchPr: boolean,
): Promise<void> {
  const s = await host.read()
  const bin = await host.gh.find()
  host.gh.noteMissing(bin === null)
  if (bin === null) return
  let sawUnstartable = false
  const fetchWith = (path: string) =>
    fetchTracked(
      host.gh.run(s, path, () => {
        sawUnstartable = true
      }),
      s.prViews,
      s.ledger.prs,
      findsBranchPr,
    )
  let fetch = await fetchWith(bin)
  if (sawUnstartable) {
    host.gh.forget()
    const refound = await host.gh.find()
    host.gh.noteMissing(refound === null)
    if (refound === null) return
    if (refound !== bin) fetch = await fetchWith(refound)
  }
  const { views: fetched, branchRef } = fetch
  await host.update(async cur => withFetchedPrs(cur, fetched, branchRef, await host.now()))
}
