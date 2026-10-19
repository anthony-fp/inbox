import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Effect } from '../../hooks/presses'
import type { SessionHost } from '../../hooks/session-host'
import { runSessionScript } from '../../tests/session-script'
import type { MakeHost } from '../../tests/session-script'
import { exclusiveRun, readState, updateState } from '../src/state'
import type { OmpState } from '../src/state'

const SESSION_ID = 'script'

const ompHost =
  (dir: string): MakeHost<OmpState> =>
  ask => {
    let clock = 1_000_000
    let ids = 0
    const delivered: string[] = []
    const performed: Exclude<Effect, { kind: 'send' }>[] = []
    const host: SessionHost<OmpState> = {
      now: () => (clock += 10),
      read: () => readState(dir, SESSION_ID),
      update: change => updateState(dir, SESSION_ID, change),
      exclusive: fn => exclusiveRun(dir, SESSION_ID, fn),
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

test('one scripted session runs through the omp session host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-omp-script-'))
  try {
    await runSessionScript(ompHost(dir), (actual, expected, label) => expect(actual, label).toEqual(expected))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
