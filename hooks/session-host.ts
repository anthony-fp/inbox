import { buildPrompt } from './model-text'
import { fetchTracked, prRowId, splitLinked } from './pr-tab'
import type { GhRun, PrPress } from './pr-tab'
import {
  doneWake,
  markSentToAgent,
  recordPress,
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
  now(): number
  read(): Promise<S>
  /** Changes the session under its lock. `checkpoint` saves an intermediate state before an external effect. */
  update(change: (s: S, checkpoint: (state: S) => Promise<void>) => S | Promise<S>): Promise<S>
  /** Runs `fn` unless another run holds the session's per-reply update. */
  exclusive<T>(fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>
  /** Calls the inbox model. Null when it fails. */
  ask: Ask
  /** Sends a message to the agent as if the person typed it. */
  deliver(s: S, text: string): Promise<SendOutcome>
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
          const promptAt = host.now()
          const reply = await host.ask(buildPrompt(s.ledger, next.ex)).catch(() => null)
          const after = await host.update(x =>
            x.pending[0]?.turnsStarted === next.turnsStarted && x.pending[0].ex.turn === next.ex.turn
              ? applied(x, reply, host.now(), promptAt)
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
  'now' | 'read' | 'update' | 'deliver' | 'prepare' | 'settleWindowMs' | 'newId'
>

/** Tells the agent about rows closed with Done once their settle window has passed. */
export async function wakeForDone<S extends Session>(host: WakeHost<S>): Promise<void> {
  const check = (s: S) =>
    doneWake(s.ledger, { now: host.now(), windowMs: host.settleWindowMs, isTurnRunning: s.turn.person !== null })
  if (!check(await host.read())) return
  await host.update(async (s, checkpoint) => {
    const wake = check(s)
    if (!wake) return s
    await host.prepare?.(s)
    const deliveryId = host.newId()
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
      ledger: markSentToAgent(s.ledger, wake.ids),
      lastActions,
      sent: [
        ...s.sent,
        {
          text: wake.text,
          press: { id: wake.ids[0]!, action: 'done' },
          at: host.now(),
          row: wake.ids[0]!,
          queuedId: null,
          pressedAt: null,
          deliveryId,
          phase: 'attempting',
        },
      ],
    }
    await checkpoint(next)
    return completedAttempt(next, deliveryId, await host.deliver(next, wake.text))
  })
}

export type PressOutcome = {
  copy: { text: string; name: string } | null
  error: string | null
  note: RowNote['note'] | null
  /** The delivery may or may not have reached the agent. */
  isUnconfirmed: boolean
  /** The press closed a row with Done. Call `wakeForDone` once the settle window has passed. */
  wakesForDone: boolean
}

type PressHost<S extends Session> = Pick<SessionHost<S>, 'now' | 'read' | 'update' | 'deliver' | 'perform' | 'newId'>

/**
 * Applies a press. When it sends a message, the sent record is saved before
 * delivery, and delivery runs inside the same update. Opens and copies run
 * after the update, so they run only once the press is saved.
 */
export async function press<S extends Session>(
  host: PressHost<S>,
  p: RowPress | PrPress,
  isStale: boolean,
  holds: ReplyHolds,
): Promise<PressOutcome> {
  const rowId = 'ref' in p ? prRowId(p) : p.id
  const localPressId = host.newId()
  let checkpointSaved = false
  let appliedSaved = false
  let isUnconfirmed = false
  let copy: PressOutcome['copy'] = null
  let error: string | null = null
  let note: PressOutcome['note'] = isStale ? 'stale' : null
  const pressed: { r?: Pressed; deliveryId?: string } = {}
  const hostFor = (change: (f: (s: S) => S | Promise<S>) => Promise<S>): EffectHost => ({
    now: host.now,
    deliveryId: () => pressed.deliveryId ?? host.newId(),
    perform: async e => {
      if (e.kind === 'copy') copy = { text: e.text, name: e.name }
      return host.perform(await host.read(), e)
    },
    send: async (e, deliveryId) => {
      let sentOutcome: SendOutcome | null = null
      return change(async s => {
        const outcome = await host.deliver(s, e.text)
        sentOutcome = outcome
        if (outcome.state === 'unconfirmed') isUnconfirmed = true
        return completedAttempt(s, deliveryId, outcome)
      }).then(
        () =>
          sentOutcome?.state === 'accepted'
            ? { state: 'accepted' as const }
            : sentOutcome?.state === 'rejected'
              ? { state: 'rejected' as const, reason: sentOutcome.reason }
              : { state: 'unconfirmed' as const, reason: sentOutcome?.reason ?? 'Queue outcome unknown' },
        (err: unknown) => ({
          state: 'unconfirmed' as const,
          reason: err instanceof Error ? err.message : String(err),
        }),
      )
    },
    saveLasts: async f => (await change(s => ({ ...s, lastActions: f(s.lastActions) }))).lastActions,
    saveLedger: async f => {
      await change(s => ({ ...s, ledger: f(s.ledger) }))
    },
  })
  await host
    .update(async (saved, checkpoint) => {
      const s: S = { ...saved, heldRows: Object.keys(holds.replies) }
      if (note) return s
      // Read under the lock, so the press is timed after every write that landed before it.
      const at = host.now()
      const r = pressOn(s, p, at, localPressId)
      if ('stale' in r) {
        note = 'stale'
        return s
      }
      pressed.r = r
      const firstSend = r.effects.find(e => e.kind === 'send')
      pressed.deliveryId = firstSend ? host.newId() : undefined
      const pressLasts =
        firstSend && pressed.deliveryId
          ? withDeliveryId(r.lasts, Object.keys(r.lasts), at, firstSend.text, pressed.deliveryId)
          : r.lasts
      let next: S = {
        ...s,
        ledger: r.ledger,
        lastActions: withLasts(s.lastActions, pressLasts, r.drop),
        told: r.reopenedId ? { ...s.told, closed: s.told.closed.filter(id => id !== r.reopenedId) } : s.told,
      }
      if (firstSend && pressed.deliveryId) {
        next = {
          ...next,
          lastActions: withUnconfirmed(next.lastActions, firstSend.text, at, pressed.deliveryId),
          sent: [
            ...next.sent,
            {
              text: firstSend.text,
              press: firstSend.by,
              at: host.now(),
              row: rowId,
              queuedId: null,
              pressedAt: at,
              deliveryId: pressed.deliveryId,
              phase: 'attempting',
            },
          ],
        }
        await checkpoint(next)
        checkpointSaved = true
      }
      const held = hostFor(async f => (next = await f(next)))
      const failed = await runSends(held, r.effects, rowId, Object.keys(r.lasts), at)
      if (failed?.state === 'rejected') error = `Not sent: ${failed.reason}`

      return next
    })
    .then(() => {
      appliedSaved = true
    })
    .catch((err: unknown) => {
      if (checkpointSaved) isUnconfirmed = true
      error = checkpointSaved ? null : `Not sent: ${err instanceof Error ? err.message : String(err)}`
    })
  const wakesForDone = pressed.r !== undefined && !('ref' in p) && p.action === 'done'
  if (pressed.r && (appliedSaved || checkpointSaved))
    await runLocalEffects(
      hostFor(f => host.update(f)),
      pressed.r.effects,
      rowId,
      pressed.r.lasts[rowId]?.result,
    )

  return { copy, error, note, isUnconfirmed, wakesForDone }
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
 * Fetches the PRs the session tracks and merges them in. Returns without
 * fetching when gh cannot start.
 */
export async function fetchPrs<S extends Session>(
  host: Pick<SessionHost<S>, 'now' | 'read' | 'update' | 'gh'>,
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
      true,
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
  await host.update(cur => withFetchedPrs(cur, fetched, branchRef, host.now()))
}
