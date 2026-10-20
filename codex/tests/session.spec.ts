import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { fakeHostWith, runSessionScript } from '../../tests/session-script'
import type { MakeHost } from '../../tests/session-script'
import { codexStore } from '../src/host'
import type { SessionState } from '../src/state'

const SESSION_ID = 'script'

const codexHost = (dir: string): MakeHost<SessionState> => {
  const { read, update, exclusive } = codexStore(dir, SESSION_ID, () => 0)

  return fakeHostWith<SessionState>({ read, update, exclusive })
}

test('one scripted session runs through the Codex session host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inbox-codex-script-'))
  try {
    await runSessionScript(codexHost(dir), (actual, expected, label) => assert.deepEqual(actual, expected, label))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
