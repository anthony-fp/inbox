import { demoView } from '../../hooks/demo'
import { pruneClosed } from '../../hooks/ledger'
import { demoRecord, demoTurns, withLasts } from '../../hooks/presses'
import { pressOn, sessionView } from '../../hooks/session'
import type { PanelSource } from './controller'
import { emptyState } from './state'
import type { OmpState } from './state'

export function demoState(now: number): OmpState {
  const d = demoView(now)
  const s = emptyState('demo')

  return {
    ...s,
    ledger: d.ledger,
    lastActions: d.lastActions,
    prViews: d.prViews,
    presence: { ...s.presence, ...d.turns },
  }
}

/** A panel source over the shared demo data. A press changes the sample and sends nothing. */
export function demoSource(deps: {
  now(): number
  after(fn: () => void, ms: number): void
  settleWindowMs: number
}): PanelSource {
  let state = demoState(deps.now())
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(l => l())

  return {
    screen: async holds => ({
      view: sessionView(state, deps.now(), deps.settleWindowMs, holds),
      modelName: null,
      isGhMissing: false,
      isFetchingPrs: false,
      stop: null,
      isDemo: true,
    }),
    press: async (p, holds) => {
      const at = deps.now()
      const r = pressOn(state, p, at)
      if ('stale' in r) return { error: null, note: 'stale' }
      const { lasts, isSample } = demoRecord(r.lasts, r.effects)
      state = {
        ...state,
        ledger: pruneClosed(r.ledger, new Set(Object.keys(holds.replies))),
        lastActions: withLasts(state.lastActions, lasts, r.drop),
        presence: { ...state.presence, ...demoTurns(state.presence, r.effects) },
      }
      if (r.effects.length > 0)
        deps.after(() => {
          state = { ...state, presence: { ...state.presence, ...demoTurns(state.presence, [], true) } }
          changed()
        }, deps.settleWindowMs)
      changed()

      return { error: null, note: isSample ? 'sample' : null }
    },
    resume: async () => null,
    fetchPrsWhenDue: () => {},
    onChange: listener => {
      listeners.add(listener)

      return () => void listeners.delete(listener)
    },
  }
}
