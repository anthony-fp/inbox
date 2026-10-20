import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fakeHostWith, runSessionScript } from '../../tests/session-script'
import type { MakeHost } from '../../tests/session-script'
import { exclusiveRun, readState, updateState } from '../src/state'
import type { OmpState } from '../src/state'

const SESSION_ID = 'script'

const ompHost = (dir: string): MakeHost<OmpState> =>
  fakeHostWith<OmpState>({
    read: () => readState(dir, SESSION_ID),
    update: change => updateState(dir, SESSION_ID, change),
    exclusive: fn => exclusiveRun(dir, SESSION_ID, fn),
  })

test('one scripted session runs through the omp session host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-omp-script-'))
  try {
    await runSessionScript(ompHost(dir), (actual, expected, label) => expect(actual, label).toEqual(expected))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
