import { emptySession } from '../hooks/session'
import type { Session } from '../hooks/session'
import type { SessionHost } from '../hooks/session-host'
import type { Effect } from '../hooks/presses'
import type { MakeHost } from './session-script'

export const fakeHost: MakeHost = ask => {
  let state: Session = emptySession()
  let clock = 1_000_000
  let isHeld = false
  let ids = 0
  const delivered: string[] = []
  const performed: Exclude<Effect, { kind: 'send' }>[] = []
  const host: SessionHost<Session> = {
    now: () => (clock += 10),
    read: async () => state,
    update: async change => {
      state = await change(state, async saved => {
        state = saved
      })
      return state
    },
    exclusive: async fn => {
      if (isHeld) return { acquired: false }
      isHeld = true
      try {
        return { acquired: true, value: await fn() }
      } finally {
        isHeld = false
      }
    },
    ask,
    deliver: async (_s, text) => {
      delivered.push(text)
      return { state: 'accepted', queuedId: null }
    },
    prepare: async () => {},
    perform: async (_s, effect) => {
      performed.push(effect)
      return null
    },
    gh: {
      find: async () => null,
      forget: () => {},
      run: () => async () => ({ exitCode: 1, stdout: '', stderr: '' }),
      noteMissing: () => {},
    },
    settleWindowMs: 1000,
    newId: () => `id${++ids}`,
  }
  return { host, delivered, performed }
}
