// The state machine every row in the Inbox tab moves through, from the draw that first shows it to the draw that
// removes it. Pure, so it is tested without a page. docs/plans/codex-row-states.md describes the states.

import { EXIT_MS } from './settle'

/**
 * A row's state. The resting states draw one form: `closed` its line, `open` its line and panel, `settled` its
 * settled line, `undoing` that line while an Undo press is out. The moving states animate between them, and each
 * keeps what it moves away from drawn: `closing` keeps the panel, `settling` keeps the last open panel under the
 * settled line, and `leaving` keeps the row's last form while it fades and collapses.
 */
export type RowState =
  'entering' | 'closed' | 'opening' | 'open' | 'closing' | 'settling' | 'settled' | 'undoing' | 'leaving'

/** The form the tab wants a row in now: from the view, the open row, and an Undo press. `gone` once it is not drawn. */
export type RowTarget = 'closed' | 'open' | 'settled' | 'undoing' | 'gone'

/** A row's state and when it entered it. */
export type RowTrack = { state: RowState; since: number }

/** How long each moving state lasts, in ms: the Codex app's enter, move and exit lengths. Resting states are 0. */
export const ROW_STATE_MS: Record<RowState, number> = {
  entering: 300,
  opening: 200,
  closing: 200,
  settling: 200,
  leaving: EXIT_MS,
  closed: 0,
  open: 0,
  settled: 0,
  undoing: 0,
}

type Shape = Exclude<RowTarget, 'undoing'>

/** The form each state shows or is moving to. A row growing in takes the closed or open form it arrived in. */
const HEADING: Record<Exclude<RowState, 'entering'>, Shape> = {
  closed: 'closed',
  opening: 'open',
  open: 'open',
  closing: 'closed',
  settling: 'settled',
  settled: 'settled',
  undoing: 'settled',
  leaving: 'gone',
}

function isHeading(state: RowState, shape: Shape): boolean {
  return state === 'entering' ? shape === 'closed' || shape === 'open' : HEADING[state] === shape
}

/** Where a moving state comes to rest, toward `shape`. Null for `leaving`, whose row is removed. */
function restOf(state: RowState, shape: Shape): RowState | null {
  return state === 'entering' ? (shape === 'open' ? 'open' : 'closed') : REST[state]!
}

const REST: Partial<Record<RowState, RowState | null>> = {
  opening: 'open',
  closing: 'closed',
  settling: 'settled',
  leaving: null,
}

export function isMoving(state: RowState): boolean {
  return ROW_STATE_MS[state] > 0
}

/**
 * A row's next state, at each draw. A moving state comes to rest once its length has passed, so an animation that
 * never reports its end cannot hold a row. A new target starts the move toward it from wherever the row is drawn.
 * `isNew` grows a row the view just brought in, closed or open; any other row the tab has not drawn yet shows its
 * form at once.
 * With `isReduced`, every move ends in the draw that starts it. Null when the row is no longer drawn.
 */
export function stepRow(
  track: RowTrack | undefined,
  target: RowTarget,
  now: number,
  isNew = false,
  isReduced = false,
): RowTrack | null {
  const next = nextState(track, target, now, isNew, isReduced)
  if (next === null) return null
  if (isReduced && isMoving(next)) {
    const rest = restOf(next, target === 'undoing' ? 'settled' : target)

    return rest === null ? null : { state: settle(rest, target), since: now }
  }

  return next === track?.state ? track : { state: next, since: now }
}

function nextState(
  track: RowTrack | undefined,
  target: RowTarget,
  now: number,
  isNew: boolean,
  isReduced: boolean,
): RowState | null {
  if (!track) {
    if (target === 'gone') return null
    if ((target === 'closed' || target === 'open') && isNew && !isReduced) return 'entering'
    return target
  }
  const { state, since } = track
  const shape = target === 'undoing' ? 'settled' : target
  if (!isHeading(state, shape)) return start(state, shape)
  if (isMoving(state) && now - since >= ROW_STATE_MS[state]) {
    const rest = restOf(state, shape)

    return rest === null ? null : settle(rest, target)
  }
  if (state === 'settled' || state === 'undoing') return target === 'undoing' ? 'undoing' : 'settled'

  return state
}

/** A resting `settled` row is `undoing` while its target says so. */
function settle(rest: RowState, target: RowTarget): RowState {
  return rest === 'settled' && target === 'undoing' ? 'undoing' : rest
}

/** The move from `state` toward a new form. */
function start(state: RowState, shape: Shape): RowState {
  switch (shape) {
    case 'open':
      return 'opening'
    case 'closed':
      // A leaving row that is listed again grows back in.
      return state === 'leaving' ? 'entering' : 'closing'
    case 'settled':
      return 'settling'
    case 'gone':
      return 'leaving'
  }
}
