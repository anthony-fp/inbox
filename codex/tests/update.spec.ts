import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Exchange } from '../../hooks/ledger'
import { readState, updateState } from '../src/state'
import { runUpdates } from '../src/update'
import { tempDir } from './helpers'

const ex = (turn: number, reply: string): Exchange => ({
  person: 'go',
  trigger: null,
  activity: [],
  reply,
  turn,
  press: null,
  screen: 'The Inbox tab is closed.',
})

test('pending exchanges reach the ledger in order, a failed one waits for the next update, and a second failure drops it', async () => {
  const dir = tempDir()
  await updateState(dir, 's1', s => ({
    ...s,
    presence: { ...s.presence, turnsStarted: 2 },
    pending: [
      { ex: ex(1, 'Should I deploy?'), turnsStarted: 1 },
      { ex: ex(2, 'Done.'), turnsStarted: 2 },
    ],
  }))
  const prompts: string[] = []
  const answers = ['GOAL: Ship\nNOW: Waiting on deploy\nNEW: decide | - | Deploy now? | Yes / No | Yes', null]
  const ask = async (p: string) => (prompts.push(p), answers.shift() ?? null)
  await runUpdates(dir, 's1', ask, () => 5)

  const kept = await readState(dir, 's1')
  assert.equal(prompts.length, 2)
  assert.match(prompts[1] ?? '', /i1 \| decide \| - \| Deploy now\?/)
  assert.deepEqual(
    kept.ledger.items.map(i => i.ask),
    ['Deploy now?'],
  )
  assert.deepEqual(
    kept.pending.map(p => [p.ex.turn, p.failed]),
    [[2, true]],
  )
  assert.deepEqual(kept.presence, { turnsStarted: 2, turnsApplied: 1, ledgerState: 'failed', isUpdating: false })

  await runUpdates(dir, 's1', ask, () => 6)
  const dropped = await readState(dir, 's1')
  assert.equal(prompts.length, 3)
  assert.deepEqual(dropped.pending, [])
  assert.deepEqual(dropped.presence, { turnsStarted: 2, turnsApplied: 2, ledgerState: 'failed', isUpdating: false })
})
