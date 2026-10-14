import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { demoView } from '../../hooks/demo'
import type { Feedback } from '../../hooks/view'
import { noteHook, notePrompt, viewOf } from '../src/core'
import type { View } from '../src/core'
import { makeServer, tabUri } from '../src/server'
import { PRESS_TIMEOUT_MS, SETTLE_WINDOW_MS } from '../src/settle'
import { readState, updateState } from '../src/state'
import { fakeRunner, tempDir } from './helpers'

async function setup(queueCode: number) {
  const dir = tempDir()
  await updateState(dir, 's1', s => ({
    ...s,
    root: '/repo',
    cliPath: '/apps/codex',
    ledger: {
      ...s.ledger,
      nextId: 2,
      items: [
        {
          id: 'i1',
          kind: 'question',
          label: null,
          ask: 'Ship it?',
          options: ['Yes', 'No'],
          rec: null,
          helps: [],
          turn: 1,
          at: 1,
        },
      ],
    },
  }))
  const runner = fakeRunner(() =>
    queueCode === 0
      ? { code: 0, stdout: 'Queued message q1\n', stderr: '' }
      : { code: queueCode, stdout: '', stderr: 'no such thread' },
  )
  const handle = makeServer({
    dir,
    now: () => 100,
    exec: runner.exec,
    tabHtml: '<html></html>',
    fallbackCli: async () => 'codex',
  })
  const call = (name: string, args: Record<string, unknown>, meta: Record<string, unknown>) =>
    handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: meta } }) as Promise<{
      result: {
        structuredContent: {
          error: string | null
          note: string | null
          view: { needsYou: { questions: { id: string; state: { is: string }; feedback: Feedback | null }[] } }
        }
        content: { text: string }[]
      }
    }>

  return { dir, calls: runner.calls, call, handle }
}

const ANSWER = { press: { action: 'answer', id: 'i1', option: 'Yes' }, thread: 's1' }

test('a press sends its message into the tab’s thread with the codex binary the hooks saw, and the next prompt reads it as a press', async () => {
  const { dir, calls, call } = await setup(0)
  const r = await call('inbox_press', ANSWER, { thread_id: 's1' })
  assert.equal(r.result.structuredContent.error, null)
  assert.equal(r.result.structuredContent.note, null)
  assert.deepEqual(calls, [['/apps/codex', 'queue', '--thread', 's1', '--message', 'Re "Ship it?": Yes']])
  // The answered question settles in place before it leaves.
  assert.deepEqual(
    r.result.structuredContent.view.needsYou.questions.map(q => [q.id, q.state.is]),
    [['i1', 'settled']],
  )
  const s = await readState(dir, 's1')
  assert.equal(s.sent[0]?.text, 'Re "Ship it?": Yes')

  const prompt = notePrompt(s, 'Re "Ship it?": Yes', 200)
  assert.deepEqual(prompt.state.turn.press, { id: 'i1', action: 'answer' })
  assert.deepEqual(prompt.state.sent, [])
  assert.match(prompt.notes.join('\n'), /Closed since you last read the inbox:\n- "Ship it\?" → Yes/)
})

test('a press drawn in another thread, or on a row that changed, reads stale and sends and saves nothing', async () => {
  const { dir, calls, call } = await setup(0)
  const before = await readState(dir, 's1')
  // The tab drew the press for another thread, or is an old tab that sends none.
  for (const thread of ['s2', undefined]) {
    const r = await call('inbox_press', { ...ANSWER, thread }, { thread_id: 's1' })
    assert.equal(r.result.structuredContent.note, 'stale')
    assert.equal(r.result.content[0]?.text, 'This changed before your press. Nothing was sent.')
  }
  // Codex closed the question before the person's typed answer reached it.
  await updateState(dir, 's1', s => ({ ...s, ledger: { ...s.ledger, items: [] } }))
  const typed = await call(
    'inbox_press',
    { press: { action: 'type', id: 'i1', text: 'Yes, ship it' }, thread: 's1' },
    { thread_id: 's1' },
  )
  assert.equal(typed.result.structuredContent.note, 'stale')
  assert.deepEqual(calls, [])
  const s = await readState(dir, 's1')
  assert.deepEqual(s.sent, [])
  assert.deepEqual(s.lastActions, before.lastActions)
})

test('a press reads Queued until Codex takes its message as a prompt, then Explaining… until the reply, then ✓', async () => {
  const { dir, call } = await setup(0)
  const r = await call('inbox_press', { press: { action: 'explain', id: 'i1' }, thread: 's1' }, { thread_id: 's1' })
  assert.deepEqual(r.result.structuredContent.view.needsYou.questions[0]?.feedback, {
    is: 'queued',
    label: 'Explain',
    at: 100,
  })
  const s = await readState(dir, 's1')
  assert.deepEqual(
    s.sent.map(x => [x.row, x.queuedId]),
    [['i1', 'q1']],
  )
  // UserPromptSubmit carries the message the tab queued.
  const arrived = notePrompt(s, s.sent[0]!.text, 200).state
  assert.deepEqual(viewOf(arrived, 200).needsYou.questions[0]?.feedback, {
    is: 'working',
    label: 'Explaining…',
    at: 100,
  })
  const replied = { ...arrived, presence: { ...arrived.presence, turnsApplied: arrived.presence.turnsStarted } }
  assert.deepEqual(viewOf(replied, 300).needsYou.questions[0]?.feedback, { is: 'done', label: 'Explained', at: 100 })
})

test('a press whose message fails to send is undone, and its row says why with [Try again]', async () => {
  const { dir, call } = await setup(1)
  const r = await call('inbox_press', ANSWER, { thread_id: 's1' })
  // The tab keeps a typed draft only when the reply says the press failed.
  assert.match(r.result.structuredContent.error ?? '', /Not sent: no such thread/)
  const question = r.result.structuredContent.view.needsYou.questions[0]
  assert.equal(question?.state.is, 'open')
  assert.deepEqual(question?.feedback, {
    is: 'notSent',
    reason: 'no such thread',
    retry: { action: 'answer', id: 'i1', option: 'Yes' },
  })
  const s = await readState(dir, 's1')
  assert.deepEqual(s.sent, [])
  assert.deepEqual(s.ledger.closed, [])
})

test('a close Codex read, then undone, is reported again when the row closes a second time', async () => {
  const { dir, calls, call } = await setup(0)
  const press = (action: string) =>
    call('inbox_press', { press: { action, id: 'i1' }, thread: 's1' }, { thread_id: 's1' })
  const prompt = async (text: string) => {
    let notes: string[] = []
    await updateState(dir, 's1', s => {
      const r = notePrompt(s, text, 200)
      notes = r.notes
      return r.state
    })
    return notes.join('\n')
  }
  const closedLine = /Closed since you last read the inbox:\n- "Ship it\?" → dismissed by the user/

  await press('dismiss')
  assert.match(await prompt('carry on'), closedLine)
  const undone = await press('undo')
  assert.equal(undone.result.structuredContent.note, null)
  assert.deepEqual(
    undone.result.structuredContent.view.needsYou.questions.map(q => [q.id, q.state.is]),
    [['i1', 'open']],
  )
  await press('dismiss')
  assert.match(await prompt('and now?'), closedLine)
  // Dismiss and Undo send nothing.
  assert.deepEqual(calls, [])
})

test('the tab opens from the app-only inbox_view tool, and the model’s inbox tool mounts nothing', async () => {
  const { handle } = await setup(0)
  const r = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: { tools: { name: string; title?: string; _meta?: Record<string, unknown> }[] }
  }
  const tool = (name: string) => r.result.tools.find(t => t.name === name)
  assert.equal(tool('inbox')?._meta, undefined)
  assert.equal(tool('inbox_view')?.title, 'Inbox')
  assert.deepEqual(tool('inbox_view')?._meta, {
    ui: { resourceUri: tabUri('<html></html>'), visibility: ['app'] },
    'openai/ui': { entrypoints: [{ type: 'thread' }] },
  })
  // Codex keeps a page by its address, so a changed page needs a new one.
  assert.notEqual(tabUri('<html></html>'), tabUri('<html>changed</html>'))
  const read = (await handle({ jsonrpc: '2.0', id: 2, method: 'resources/read' })) as {
    result: { contents: { uri: string }[] }
  }
  assert.equal(read.result.contents[0]?.uri, tabUri('<html></html>'))
  const older = tabUri('<html>older</html>')
  const readOlder = (await handle({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: older } })) as {
    result: { contents: { uri: string; text: string }[] }
  }
  assert.equal(readOlder.result.contents[0]?.uri, older)
  assert.match(readOlder.result.contents[0]?.text ?? '', /<html>/)
})

test('with no dev build, the view names the installed page and inbox_tab_page serves it, so a tab from an older build replaces itself', async () => {
  const { call } = await setup(0)
  const view = (await call('inbox_view', {}, { thread_id: 's1' })) as unknown as {
    result: { structuredContent: { devPage: string } }
  }
  assert.equal(view.result.structuredContent.devPage, tabUri('<html></html>'))
  const page = (await call('inbox_tab_page', {}, { thread_id: 's1' })) as unknown as {
    result: { structuredContent: { html: string } }
  }
  assert.equal(page.result.structuredContent.html, '<html></html>')
})

test('the inbox tool answers in text: the count, each row that waits, and where to act on them', async () => {
  const { dir, call } = await setup(0)
  const codex = { 'x-codex-turn-metadata': { session_id: 's1', turn_id: 't1' } }
  await updateState(dir, 's1', s => ({
    ...s,
    ledger: {
      ...s.ledger,
      items: [
        ...s.ledger.items,
        {
          id: 'i2',
          kind: 'task',
          label: null,
          ask: 'Add the API key to .env',
          options: [],
          rec: null,
          helps: [],
          turn: 1,
          at: 2,
        },
      ],
      findings: [{ id: 'f3', kind: 'issue', title: 'No lint script', detail: 'Only tests run.', path: null, at: 3 }],
      // The question came in the reply to the latest prompt, so a "1" in the next one answers it.
      turn: 1,
      batchTurn: 1,
    },
  }))
  const r = (await call('inbox', {}, codex)) as unknown as {
    result: { content: { text: string }[]; structuredContent?: unknown }
  }
  assert.equal(r.result.structuredContent, undefined)
  assert.equal(
    r.result.content[0]?.text,
    [
      '2 wait on the user · 1 finding',
      'Questions:',
      '1) [i1] "Ship it?"; options: Yes / No',
      'Tasks:',
      '• [i2] "Add the API key to .env"',
      'Findings:',
      '• [f3] issue: No lint script',
      'Open the Inbox tab to act on these.',
    ].join('\n'),
  )
  // A row that just closed still settles in the tab, but no longer waits.
  await call('inbox_press', { press: { action: 'dismiss', id: 'i2' }, thread: 's1' }, { thread_id: 's1' })
  await call('inbox_press', { press: { action: 'dismiss', id: 'f3' }, thread: 's1' }, { thread_id: 's1' })
  const one = await call('inbox', {}, codex)
  assert.equal(
    one.result.content[0]?.text,
    [
      '1 waits on the user',
      'Questions:',
      '1) [i1] "Ship it?"; options: Yes / No',
      'Open the Inbox tab to act on these.',
    ].join('\n'),
  )
  await call('inbox_press', { press: { action: 'dismiss', id: 'i1' }, thread: 's1' }, { thread_id: 's1' })
  const after = await call('inbox', {}, codex)
  assert.equal(after.result.content[0]?.text, 'Nothing waits on the user.')
})

test('Codex’s own tool calls reach their session through the turn metadata', async () => {
  const { dir, call } = await setup(0)
  const r = await call(
    'record_finding',
    { kind: 'issue', title: 'No lint script', detail: 'Only tests run.' },
    { 'x-codex-turn-metadata': { session_id: 's1', thread_id: 's1' } },
  )
  assert.match(r.result.content[0]?.text ?? '', /^Recorded as f2/)
  assert.equal((await readState(dir, 's1')).ledger.findings[0]?.title, 'No lint script')
})

test('a tool call from Codex in a turn UserPromptSubmit never recorded shows the hook skipped; the tab’s own calls show nothing', async () => {
  const { dir, call } = await setup(0)
  await updateState(dir, 's1', s => noteHook(noteHook(s, 'start', 10), 'prompt', 20, 't1'))
  const viewed = async () => {
    const r = (await call('inbox_view', {}, { thread_id: 's1' })) as unknown as {
      result: { structuredContent: { heard: string } }
    }
    return r.result.structuredContent.heard
  }
  assert.equal(await viewed(), 'heard')
  await call('close', { id: 'i1', reason: 'done' }, { 'x-codex-turn-metadata': { session_id: 's1', turn_id: 't1' } })
  assert.equal(await viewed(), 'heard')
  // A subagent's call carries the root's session id, in a turn the root's prompt hook never sees.
  await call('inbox', {}, { 'x-codex-turn-metadata': { session_id: 's1', thread_id: 'sub1', turn_id: 'u1' } })
  await call('inbox', {}, { 'x-codex-turn-metadata': { session_id: 's1', parent_thread_id: 's1', turn_id: 'u2' } })
  assert.equal(await viewed(), 'heard')
  await call('inbox', {}, { 'x-codex-turn-metadata': { session_id: 's1', turn_id: 't2' } })
  assert.equal((await readState(dir, 's1')).heard.promptMissedAt, 100)
  assert.equal(await viewed(), 'partial')
})

test('a press in the demo changes only the demo, sends nothing into the conversation, and says so', async () => {
  const { dir, calls, call } = await setup(0)
  const before = await readState(dir, 's1')
  type NeedsYou = {
    result: {
      structuredContent: {
        needsYou: {
          questions: { id: string; state: { is: string }; item: { options: string[] } }[]
          tasks: { id: string; steps: { label: string; step: { kind: string }[] }[] }[]
        }
      }
    }
  }
  const demo = (await call('inbox_view', { demo: true }, { thread_id: 's1' })) as unknown as NeedsYou
  const first = demo.result.structuredContent.needsYou.questions.find(q => q.state.is === 'open')
  assert.ok(first)
  const option = first.item.options[0]
  const r = await call(
    'inbox_press',
    { press: { action: 'answer', id: first.id, option }, thread: 's1', demo: true },
    { thread_id: 's1' },
  )
  assert.deepEqual(calls, [])
  assert.equal(r.result.structuredContent.view.needsYou.questions.find(q => q.id === first.id)?.state.is, 'settled')
  assert.equal(r.result.structuredContent.note, 'sample')
  assert.equal(r.result.content[0]?.text, 'Sample entry: nothing was sent.')
  // A copy step copies nothing in the demo: its row gets the same note.
  const copyTask = demo.result.structuredContent.needsYou.tasks.find(t =>
    t.steps[0]?.step.every(h => h.kind === 'copy'),
  )
  assert.ok(copyTask)
  const copied = await call(
    'inbox_press',
    { press: { action: 'step', id: copyTask.id, step: 0, label: copyTask.steps[0]!.label }, thread: 's1', demo: true },
    { thread_id: 's1' },
  )
  assert.equal(copied.result.structuredContent.note, 'sample')
  assert.equal((copied.result.structuredContent as unknown as { copy: unknown }).copy, null)
  assert.deepEqual(await readState(dir, 's1'), before)
})

test('an Open step shows a file macOS would run in Finder, opens any other file, and records on its row what happened', async () => {
  const { dir, calls, call } = await setup(0)
  const root = tempDir()
  writeFileSync(join(root, 'deploy.command'), 'echo hi')
  writeFileSync(join(root, 'notes.md'), '# Notes')
  await updateState(dir, 's1', s => ({
    ...s,
    root,
    ledger: {
      ...s.ledger,
      items: [
        {
          id: 'i2',
          kind: 'task',
          label: null,
          ask: 'Check the deploy script',
          options: [],
          rec: null,
          helps: [
            { kind: 'open', path: 'deploy.command' },
            { kind: 'open', path: 'notes.md' },
            { kind: 'open', path: 'moved.md' },
          ],
          turn: 1,
          at: 1,
        },
      ],
    },
  }))
  const step = (step: number, label: string) =>
    call('inbox_press', { press: { action: 'step', id: 'i2', step, label }, thread: 's1' }, { thread_id: 's1' })
  await step(0, 'Open deploy.command')
  await step(1, 'Open notes.md')
  assert.deepEqual(calls, [
    ['open', '-R', join(root, 'deploy.command')],
    ['open', join(root, 'notes.md')],
  ])
  assert.deepEqual((await readState(dir, 's1')).lastActions.i2?.result, {
    state: 'done',
    parts: [{ kind: 'open', name: 'notes.md', isCommand: false, error: null }],
    at: 100,
  })
  // A file that is gone fails on its row; the reply's error is only for a message that was not sent.
  const moved = await step(2, 'Open moved.md')
  assert.equal(moved.result.structuredContent.error, null)
  assert.deepEqual((await readState(dir, 's1')).lastActions.i2?.result, {
    state: 'failed',
    parts: [{ kind: 'open', name: 'moved.md', isCommand: false, error: 'it no longer exists' }],
    at: 100,
  })
  assert.equal(calls.length, 2)
})

test('an open still pending after the press timeout shows nothing on its row, and stays saved as pending', async () => {
  const { dir, call } = await setup(0)
  const pending = (at: number) => ({
    state: 'pending' as const,
    parts: [{ kind: 'open' as const, name: 'notes.md', isCommand: false, error: null }],
    at,
  })
  const opened = (at: number) => ({
    kind: 'local' as const,
    action: 'step-0',
    text: 'Open notes.md',
    at,
    result: pending(at),
  })
  // The server's clock reads 100: one press began before the timeout, one just now.
  const staleAt = 100 - PRESS_TIMEOUT_MS - 1
  await updateState(dir, 's1', s => ({
    ...s,
    ledger: {
      ...s.ledger,
      items: [
        ...s.ledger.items,
        {
          id: 'i2',
          kind: 'task',
          label: null,
          ask: 'Read the notes',
          options: [],
          rec: null,
          helps: [{ kind: 'open', path: 'notes.md' }],
          turn: 1,
          at: 1,
        },
      ],
    },
    lastActions: { i1: opened(staleAt), i2: opened(100) },
  }))
  const r = (await call('inbox_view', {}, { thread_id: 's1' })) as unknown as {
    result: { structuredContent: View }
  }
  const view = r.result.structuredContent
  assert.equal(view.needsYou.questions.find(q => q.id === 'i1')?.feedback, null)
  assert.deepEqual(view.needsYou.tasks.find(t => t.id === 'i2')?.feedback, { is: 'local', result: pending(100) })
  assert.equal(view.lastActions.i1?.result, undefined)
  const saved = await readState(dir, 's1')
  assert.deepEqual([saved.lastActions.i1?.result, saved.lastActions.i2?.result], [pending(staleAt), pending(100)])
})

test('Done on a task Codex just left queues one message once Undo ends, unless a turn runs, and Undo then reads stale', async () => {
  const dir = tempDir()
  const task = (id: string, ask: string, turn: number) => ({
    id,
    kind: 'task' as const,
    label: null,
    ask,
    options: [],
    rec: null,
    helps: [],
    turn,
    at: 1,
  })
  await updateState(dir, 's1', s => ({
    ...s,
    root: '/repo',
    cliPath: '/apps/codex',
    ledger: {
      ...s.ledger,
      turn: 2,
      nextId: 3,
      items: [task('i1', 'Water the plants', 1), task('i2', 'Sign in to npm', 2)],
    },
  }))
  let t = 100
  const runner = fakeRunner(() => ({ code: 0, stdout: 'Queued message q1\n', stderr: '' }))
  const handle = makeServer({
    dir,
    now: () => t,
    exec: runner.exec,
    tabHtml: '<html></html>',
    fallbackCli: async () => 'codex',
  })
  const call = (name: string, args: Record<string, unknown>) =>
    handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: { thread_id: 's1' } },
    }) as Promise<{
      result: { structuredContent: { note: string | null } }
    }>
  const poll = () => call('inbox_view', {})

  await call('inbox_press', { press: { action: 'done', id: 'i1' }, thread: 's1' })
  await call('inbox_press', { press: { action: 'done', id: 'i2' }, thread: 's1' })
  await updateState(dir, 's1', s => ({ ...s, turn: { ...s.turn, person: 'keep going' } }))
  t += SETTLE_WINDOW_MS
  await poll()
  const queued = () => runner.calls.filter(c => c[0] === '/apps/codex')
  assert.deepEqual(queued(), [])

  await updateState(dir, 's1', s => ({ ...s, turn: { ...s.turn, person: null } }))
  await poll()
  await poll()
  assert.deepEqual(queued(), [['/apps/codex', 'queue', '--thread', 's1', '--message', 'Done: Sign in to npm']])
  const undo = await call('inbox_press', { press: { action: 'undo', id: 'i2' }, thread: 's1' })
  assert.equal(undo.result.structuredContent.note, 'stale')
  const s = await readState(dir, 's1')
  assert.deepEqual(
    s.ledger.closed.map(c => [c.id, c.isSentToAgent ?? false]),
    [
      ['i1', false],
      ['i2', true],
    ],
  )
  assert.deepEqual(notePrompt(s, s.sent[0]!.text, t).state.turn.press, { id: 'i2', action: 'done' })
})

const GH_VIEW = JSON.stringify({
  number: 7,
  title: 'Add the PRs tab',
  url: 'https://github.com/acme/app/pull/7',
  state: 'OPEN',
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE', workflowName: 'CI' }],
})
const GH_THREADS = JSON.stringify({
  data: {
    viewer: { login: 'me' },
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: 'T1',
              isResolved: false,
              isOutdated: false,
              path: 'src/a.ts',
              line: 4,
              originalLine: 4,
              comments: { totalCount: 1, nodes: [{ author: { login: 'rev' }, body: 'Rename this', url: 'u' }] },
              last: { nodes: [] },
            },
          ],
        },
      },
    },
  },
})

type PrView = {
  prs: { drawn: { pr: { ref: string; threads: unknown[] } }[]; count: number }
  isFetchingPrs: boolean
  isGhMissing: boolean
  lastActions: Record<string, { action: string }>
}
type PrReply = { result: { structuredContent: PrView & { error: string | null; view: PrView } } }

async function prServer(answer: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  const dir = tempDir()
  await updateState(dir, 's1', s => ({ ...s, root: '/repo', cliPath: '/apps/codex' }))
  const runner = fakeRunner(answer)
  const handle = makeServer({
    dir,
    now: () => 100,
    exec: runner.exec,
    tabHtml: '<html></html>',
    fallbackCli: async () => 'codex',
  })
  const call = (name: string, args: Record<string, unknown>) =>
    handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: { thread_id: 's1' } },
    }) as Promise<PrReply>

  return { dir, calls: runner.calls, call }
}

const ghAnswer = (args: string[]) => {
  if (args[0] === 'gh' && args[1] === 'pr') return { code: 0, stdout: GH_VIEW, stderr: '' }
  if (args[0] === 'gh') return { code: 0, stdout: args.includes('api') ? GH_THREADS : 'gh 2.0', stderr: '' }
  return { code: 0, stdout: 'Queued message q1\n', stderr: '' }
}

test('a view starts a fetch of the session’s PRs through gh in its folder, and the next view shows them', async () => {
  const { dir, calls, call } = await prServer(ghAnswer)
  const first = await call('inbox_view', {})
  assert.equal(first.result.structuredContent.isFetchingPrs, true)
  assert.deepEqual(first.result.structuredContent.prs.drawn, [])
  await new Promise(resolve => setTimeout(resolve, 50))
  const next = await call('inbox_view', {})
  const { prs, isFetchingPrs } = next.result.structuredContent
  assert.equal(isFetchingPrs, false)
  assert.deepEqual(
    prs.drawn.map(d => [d.pr.ref, d.pr.threads.length]),
    [['acme/app#7', 1]],
  )
  assert.equal(prs.count, 1)
  assert.ok(calls.some(c => c[0] === 'gh' && c[1] === 'pr'))
  assert.equal((await readState(dir, 's1')).prViews.branchRef, 'acme/app#7')
})

test('a view says gh was not found when no gh can start', async () => {
  const { call } = await prServer(() => ({ code: -1, stdout: '', stderr: '' }))
  await call('inbox_view', {})
  await new Promise(resolve => setTimeout(resolve, 50))
  const next = await call('inbox_view', {})
  assert.equal(next.result.structuredContent.isGhMissing, true)
  assert.deepEqual(next.result.structuredContent.prs.drawn, [])
})

test('gh is found in the Homebrew folder when it is not on the PATH', async () => {
  const { calls, call } = await prServer(args =>
    args[0] === 'gh' ? { code: -1, stdout: '', stderr: '' } : ghAnswer(['gh', ...args.slice(1)]),
  )
  await call('inbox_view', {})
  await new Promise(resolve => setTimeout(resolve, 50))
  const next = await call('inbox_view', {})
  assert.equal(next.result.structuredContent.isGhMissing, false)
  assert.equal(next.result.structuredContent.prs.drawn.length, 1)
  assert.ok(calls.some(c => c[0] === '/opt/homebrew/bin/gh' && c[1] === 'pr'))
})

test('a PR press sends its prompt through codex queue and records the press on its row', async () => {
  const { dir, calls, call } = await prServer(ghAnswer)
  const d = demoView(100)
  await updateState(dir, 's1', s => ({ ...s, ledger: { ...s.ledger, prs: d.ledger.prs }, prViews: d.prViews }))
  const pr = Object.values(d.prViews.views).find(v => v.threads.some(t => t.isWaiting))!
  const thread = pr.threads.find(t => t.isWaiting)!
  const r = await call('inbox_press', {
    press: { action: 'thread-address', ref: pr.ref, thread: thread.id },
    thread: 's1',
  })
  assert.equal(r.result.structuredContent.error, null)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.slice(0, 4), ['/apps/codex', 'queue', '--thread', 's1'])
  assert.match(calls[0]?.[5] ?? '', new RegExp(thread.path))
  const id = `${pr.ref} thread ${thread.id}`
  assert.equal(r.result.structuredContent.view.lastActions[id]?.action, 'thread-address')
  assert.equal((await readState(dir, 's1')).sent[0]?.row, id)
})

test('a PR press with a failing queue says it was not sent and keeps the failure on its row', async () => {
  const { dir, call } = await prServer(args =>
    args[1] === 'queue' ? { code: 1, stdout: '', stderr: 'no such thread' } : ghAnswer(args),
  )
  const d = demoView(100)
  await updateState(dir, 's1', s => ({ ...s, ledger: { ...s.ledger, prs: d.ledger.prs }, prViews: d.prViews }))
  const ref = Object.values(d.prViews.views).find(v => v.mergeable === 'CONFLICTING')!.ref
  const r = await call('inbox_press', { press: { action: 'pr-conflicts', ref }, thread: 's1' })
  assert.match(r.result.structuredContent.error ?? '', /no such thread/)
  const last = (await readState(dir, 's1')).lastActions[`pr:${ref}`]
  assert.equal(last?.delivery?.state, 'failed')
})

test('dismissing a linked PR unlinks it, and its view leaves once its settled block has', async () => {
  let t = 100
  const dir = tempDir()
  await updateState(dir, 's1', s => ({ ...s, root: '/repo', cliPath: '/apps/codex' }))
  const runner = fakeRunner(() => ({ code: -1, stdout: '', stderr: '' }))
  const handle = makeServer({ dir, now: () => t, exec: runner.exec, tabHtml: '', fallbackCli: async () => 'codex' })
  const call = (name: string, args: Record<string, unknown>) =>
    handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: { thread_id: 's1' } },
    }) as Promise<PrReply>
  const d = demoView(100)
  await updateState(dir, 's1', s => ({
    ...s,
    ledger: { ...s.ledger, prs: d.ledger.prs },
    prViews: { ...d.prViews, branchRef: null },
  }))
  const ref = d.ledger.prs.find(r => r !== d.prViews.branchRef)!
  const dismissed = await call('inbox_press', { press: { action: 'pr-dismiss', ref }, thread: 's1' })
  const drawn = (v: PrView) => v.prs.drawn.map(x => x.pr.ref)
  assert.ok(drawn(dismissed.result.structuredContent.view).includes(ref))
  assert.equal((await readState(dir, 's1')).ledger.prs.includes(ref), false)
  t += SETTLE_WINDOW_MS
  const later = await call('inbox_view', {})
  assert.equal(drawn(later.result.structuredContent).includes(ref), false)
  assert.equal(ref in (await readState(dir, 's1')).prViews.views, false)
})
