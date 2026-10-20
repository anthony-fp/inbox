import { expect, test } from 'claude-code/testing'

import { CLAUDE_CODE } from '../hooks/model-text'
import { emptySession, noteCommandOutput, recorded, sessionView } from '../hooks/session'
import { press, wakeForDone } from '../hooks/session-host'
import { NO_HOLDS } from '../hooks/view'
import { fakeHost } from './session-fake-host'
import { runSessionScript } from './session-script'

test('one scripted session runs through the shared session functions', async () => {
  await runSessionScript(fakeHost, (actual, expected, label) => expect(actual, label).toEqual(expected))
})

test('a refused Done message leaves its row reading Not sent, with Undo', async () => {
  let clock = 1_000_000
  const scripted = fakeHost(async () => null).host
  const host = {
    ...scripted,
    now: () => clock,
    deliver: async () => ({ state: 'rejected' as const, reason: 'queue refused' }),
  }
  await host.update(s => recorded(CLAUDE_CODE, s, 'record', { kind: 'task', ask: 'Sign in to npm' }, clock).state)
  const id = (await host.read()).ledger.items[0]!.id
  await press(host, { action: 'done', id }, false, NO_HOLDS)
  clock += host.settleWindowMs
  await wakeForDone(host)
  const view = sessionView(await host.read(), clock, host.settleWindowMs)

  expect(view.needsYou.closed.tasks.map(c => c.delivery)).toEqual([{ error: 'queue refused', canUndo: true }])
})

test('a command that prints local URLs notes each once, and gh pr create links the PR it names', () => {
  const printed = 'Local: http://localhost:5173/app\nAlso http://localhost:5173/app and http://api.localhost:3000.\n'
  const served = noteCommandOutput(emptySession(), 'npm run dev', printed)
  expect(served.turn.activity).toEqual([
    'URL in output: http://localhost:5173/app',
    'URL in output: http://api.localhost:3000.',
  ])
  expect(served.ledger.prs).toEqual([])

  const opened = noteCommandOutput(served, 'gh pr create --fill', 'https://github.com/acme/app/pull/12\n')
  expect(opened.ledger.prs).toEqual(['acme/app#12'])
  expect(opened.turn.activity).toEqual(served.turn.activity)

  const echoed = noteCommandOutput(opened, 'echo done', 'https://github.com/acme/app/pull/99\n')
  expect(echoed).toBe(opened)
})

test('a PR already linked keeps its place when gh pr create names it again with a new one', () => {
  const linked = noteCommandOutput(emptySession(), 'gh pr create', 'https://github.com/acme/app/pull/1\n')
  const second = noteCommandOutput(linked, 'gh pr create', 'https://github.com/acme/app/pull/2\n')
  const again = noteCommandOutput(second, 'gh pr create', 'https://github.com/acme/app/pull/1\n')
  expect(again.ledger.prs).toEqual(['acme/app#1', 'acme/app#2'])
})
