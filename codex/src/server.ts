// The plugin's MCP server: Codex's record_finding, close and inbox tools, and
// the Inbox tab with the app-only tools it calls. It speaks MCP over stdio by
// hand, since it needs only a few message shapes.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

import {
  applyPress,
  demoRecord,
  localPath,
  noteText,
  openCommands,
  runLocalEffects,
  runSends,
} from '../../hooks/presses'
import type { EffectHost, PressResult, RowPress } from '../../hooks/presses'
import {
  CLOSE_DESCRIPTION,
  CLOSE_SCHEMA,
  FINDING_SCHEMA,
  findingDescription,
  recordClose,
  recordFinding,
} from '../../hooks/tools'
import { noteToolCall, viewOf } from './core'
import type { TabView } from './core'
import { demoState } from './demo'
import { readState, updateState } from './state'
import type { SessionState } from './state'
import { CODEX, INBOX_DESCRIPTION, inboxToolText, VIEW_DESCRIPTION } from './texts'
import type { Run } from './run'
import type { RowNote } from '../../types'

/**
 * The tab's address for one build of its page. Codex keeps a tab's page by its address, even across server
 * restarts, so a page changed under the same address would not show until Codex restarts.
 */
export function tabUri(tabHtml: string): string {
  return `ui://inbox/tab-${createHash('sha256').update(tabHtml).digest('hex').slice(0, 12)}`
}
const TAB_MIME = 'text/html;profile=mcp-app'

const APP_ONLY = { ui: { visibility: ['app'] } }
const MAX_SENT = 20

const toolsFor = (uri: string) => [
  { name: 'record_finding', description: findingDescription(CODEX), inputSchema: FINDING_SCHEMA },
  { name: 'close', description: CLOSE_DESCRIPTION, inputSchema: CLOSE_SCHEMA },
  // No resourceUri: Codex mounts every model-called MCP App inline in the transcript.
  { name: 'inbox', description: INBOX_DESCRIPTION, inputSchema: { type: 'object', properties: {} } },
  {
    // The side panel names the tab from this title. Entrypoints ignore `visibility`, so the tab still opens.
    name: 'inbox_view',
    title: 'Inbox',
    description: VIEW_DESCRIPTION,
    inputSchema: { type: 'object', properties: { demo: { type: 'boolean' } } },
    _meta: {
      ui: { resourceUri: uri, visibility: ['app'] },
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    },
  },
  {
    name: 'inbox_press',
    description: 'A press in the Inbox tab.',
    inputSchema: {
      type: 'object',
      properties: { press: { type: 'object' }, thread: { type: 'string' }, demo: { type: 'boolean' } },
      required: ['press'],
    },
    _meta: APP_ONLY,
  },
  {
    name: 'inbox_tab_page',
    description: 'The tab page the dev build keeps built.',
    inputSchema: { type: 'object', properties: {} },
    _meta: APP_ONLY,
  },
]

/** The page with its own build's address stamped in, so a tab can tell when the dev build has a newer one. */
function stamped(tabHtml: string): string {
  return tabHtml.replace(
    '</head>',
    () => `<script>window.__inboxPage = ${JSON.stringify(tabUri(tabHtml))}</script></head>`,
  )
}

export type ServerDeps = {
  dir: string
  now: () => number
  exec: Run
  tabHtml: string
  /** The codex binary to run `queue` with when no hook has named one yet. */
  fallbackCli: () => Promise<string>
  /** The tab page `npm --prefix codex run dev` keeps built, while it runs. */
  devPage?: () => Promise<string | null>
  /** The fingerprint build.mjs stamped into this server, sent with each view. */
  build?: string
}

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown> }

/**
 * The session a call belongs to. Codex's own tool calls carry it in their
 * turn metadata, and the tab's calls as the thread id, which is the same id.
 */
export function sessionOf(params: Record<string, unknown> | undefined): string | null {
  const meta = (params?._meta ?? {}) as Record<string, unknown>
  const turn = (meta['x-codex-turn-metadata'] ?? {}) as Record<string, unknown>
  const id = turn.session_id ?? meta.thread_id ?? meta.threadId

  return typeof id === 'string' && id ? id : null
}

/**
 * For a call Codex's model made in the session's own thread, the turn it came
 * in: its turn id, or null when the metadata has none. Undefined for a call that
 * says nothing about the session's prompts: the tab's calls carry no turn
 * metadata, and a subagent's or a forked chat's call can carry the root's
 * session id for a turn whose prompt the root's UserPromptSubmit never saw.
 */
export function turnOf(params: Record<string, unknown> | undefined): string | null | undefined {
  const meta = (params?._meta ?? {}) as Record<string, unknown>
  const turn = meta['x-codex-turn-metadata']
  if (typeof turn !== 'object' || turn === null) return undefined
  const t = turn as Record<string, unknown>
  const isOtherThread = typeof t.thread_id === 'string' && t.thread_id !== t.session_id
  if (t.parent_thread_id || t.forked_from_thread_id || isOtherThread) return undefined

  return typeof t.turn_id === 'string' && t.turn_id ? t.turn_id : null
}

const text = (t: string) => ({ content: [{ type: 'text', text: t }] })

/** What the tab hears back from a press: the view after it, text to copy, why it failed, or a note for its row. */
export type PressReply = {
  view: TabView
  copy: { text: string; name: string } | null
  error: string | null
  note: RowNote['note'] | null
}

export function makeServer(deps: ServerDeps): (m: Message) => Promise<Record<string, unknown> | null> {
  const { dir, now } = deps
  const uri = tabUri(deps.tabHtml)
  const tools = toolsFor(uri)

  /**
   * Sends a message into the session as the person's own: it runs after any
   * running turn. Returns the id `codex queue` printed for it, or null when it printed none.
   */
  async function queue(s: SessionState, message: string): Promise<string | null> {
    const cli = s.cliPath ?? (await deps.fallbackCli())
    const r = await deps.exec([cli, 'queue', '--thread', s.sessionId, '--message', message], {
      cwd: s.root || '/',
      timeoutMs: 15_000,
    })
    if (r.code !== 0) throw new Error(r.stderr.trim() || `codex queue exited ${r.code}`)

    return /Queued message (\S+)/.exec(r.stdout)?.[1] ?? null
  }

  const pressOn = (s: SessionState, p: RowPress, at = now()) =>
    applyPress(s.ledger, s.lastActions[p.id], p, { now: at, turnsStarted: s.presence.turnsStarted, extraSteps: [] })

  /** The view for the tab, with the session it was read for. */
  const served = (s: SessionState, id: string): TabView => ({
    ...viewOf(s, now()),
    thread: id,
    ...(deps.build ? { serverBuild: deps.build } : {}),
  })

  /**
   * Applies a press drawn for `thread` in session `id`'s state, and runs its effects with `runSends` and
   * `runLocalEffects`. Its messages send under the lock that applies it, so no prompt reads the press before its
   * message went, and a failed send's undo lands in the same write. Its opens run after, outside the lock. A press
   * drawn for another session, or for a row that changed, sends nothing and returns a stale note.
   */
  async function onPress(id: string, p: RowPress, thread: unknown): Promise<PressReply> {
    let copy: PressReply['copy'] = null
    let error: string | null = null
    let note: PressReply['note'] = thread === id ? null : 'stale'
    // The press as applied under the lock, read once the lock is released.
    const pressed: { r?: Exclude<PressResult, { stale: true }> } = {}
    /** The press's effects, saving through `change`: the state a held lock writes, or a fresh lock each time. */
    const hostFor = (
      change: (f: (s: SessionState) => SessionState | Promise<SessionState>) => Promise<SessionState>,
    ): EffectHost => ({
      now,
      // The tab copies, and shows the text to copy by hand when its frame has no clipboard.
      perform: async e => {
        if (e.kind === 'copy') {
          copy = { text: e.text, name: e.name }
          return null
        }
        return open(await readState(dir, id), e.target)
      },
      send: e =>
        change(async s => {
          const queuedId = await queue(s, e.text)
          const sent = { text: e.text, press: e.by, at: now(), row: p.id, queuedId }
          return { ...s, sent: [...s.sent, sent].slice(-MAX_SENT) }
        }).then(
          () => null,
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        ),
      saveLasts: async f => (await change(s => ({ ...s, lastActions: f(s.lastActions) }))).lastActions,
      saveLedger: async f => {
        await change(s => ({ ...s, ledger: f(s.ledger) }))
      },
    })
    await updateState(dir, id, async s => {
      if (note) return s
      // Read under the lock, so the press is timed after every write that landed before it.
      const at = now()
      const r = pressOn(s, p, at)
      if ('stale' in r) {
        note = 'stale'
        return s
      }
      pressed.r = r
      let next: SessionState = {
        ...s,
        ledger: r.ledger,
        lastActions: r.last ? { ...s.lastActions, [p.id]: r.last } : s.lastActions,
        // Codex was told of the close; with the id out of `told`, a second close of the row is reported too.
        told: p.action === 'undo' ? { ...s.told, closed: s.told.closed.filter(id => id !== p.id) } : s.told,
      }
      const held = hostFor(async f => (next = await f(next)))
      const failed = await runSends(held, r.effects, p.id, r.last ? [p.id] : [], at)
      if (failed) error = `Not sent: ${failed.reason}`

      return next
    }).catch((err: unknown) => {
      error = `Not sent: ${err instanceof Error ? err.message : String(err)}`
    })
    if (pressed.r)
      await runLocalEffects(
        hostFor(f => updateState(dir, id, f)),
        pressed.r.effects,
        p.id,
        pressed.r.last?.result,
      )

    return { view: served(await readState(dir, id), id), copy, error, note }
  }

  /** Opens a link, or a path as `openCommands` decides. Returns why it could not, or null. */
  async function open(s: SessionState, target: string): Promise<string | null> {
    const run = (argv: string[]) => deps.exec(argv, { cwd: '/', timeoutMs: 10_000 })
    const failure = (r: { code: number; stderr: string }) => r.stderr.trim() || `open exited ${r.code}`
    if (/^https:\/\//.test(target)) {
      const r = await run(['open', target])
      return r.code === 0 ? null : failure(r)
    }
    const path = localPath(target, s.root || '/', s.home)
    const info = await stat(path).catch(() => null)
    if (!info) return 'it no longer exists'
    const isExecutable =
      info.isFile() &&
      (await access(path, constants.X_OK).then(
        () => true,
        () => false,
      ))
    const { argv, fallback } = openCommands(path, info.isFile(), isExecutable)
    const r = await run(argv)
    const retry = r.code !== 0 && fallback ? await run(fallback) : r

    return retry.code === 0 ? null : failure(retry)
  }

  // Each conversation's demo, kept in memory only: it starts over when the server does.
  const demos = new Map<string, SessionState>()
  const demoOf = (id: string) => {
    const s = demos.get(id) ?? demoState(now())
    demos.set(id, s)
    return s
  }

  /** A press in the demo changes only its copy and performs nothing: each send, open or copy gives its row the sample note. */
  function onDemoPress(id: string, p: RowPress, thread: unknown): PressReply {
    const s = demoOf(id)
    const r = thread === id ? pressOn(s, p) : ({ stale: true } as const)
    if ('stale' in r) return { view: served(s, id), copy: null, error: null, note: 'stale' }
    const { lasts, isSample } = demoRecord(r.last ? { [p.id]: r.last } : {}, r.effects)
    const next: SessionState = { ...s, ledger: r.ledger, lastActions: { ...s.lastActions, ...lasts } }
    demos.set(id, next)

    return { view: served(next, id), copy: null, error: null, note: isSample ? 'sample' : null }
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    id: string | null,
    turn: string | null | undefined,
  ) {
    if (!id) return { ...text('Not done: this call carries no session id.'), isError: true }
    // A call from Codex's model shows whether UserPromptSubmit recorded its turn. The tab's calls show nothing.
    const heard = (s: SessionState) => (turn === undefined ? s : noteToolCall(s, turn, now()))
    switch (name) {
      case 'record_finding':
      case 'close': {
        let result = ''
        await updateState(dir, id, s => {
          const r = (name === 'close' ? recordClose : recordFinding)(CODEX, s.ledger, args, now())
          result = r.result
          return heard({ ...s, ledger: r.ledger })
        })
        return text(result)
      }
      case 'inbox': {
        const s = turn === undefined ? await readState(dir, id) : await updateState(dir, id, heard)
        return text(inboxToolText(viewOf(s, now())))
      }
      case 'inbox_view': {
        const devPage = await deps.devPage?.()
        const dev = devPage ? { devPage: tabUri(devPage) } : {}
        if (args.demo === true)
          return { ...text('Inbox demo'), structuredContent: { ...served(demoOf(id), id), ...dev } }
        const s = await updateState(dir, id, s => ({ ...s, tabSeenAt: now() }))
        return { ...text('Inbox view'), structuredContent: { ...served(s, id), ...dev } }
      }
      case 'inbox_tab_page': {
        const devPage = await deps.devPage?.()
        if (!devPage) return { ...text('Not done: no dev build is running.'), isError: true }
        return { ...text('Tab page'), structuredContent: { html: stamped(devPage) } }
      }
      case 'inbox_press': {
        const p = args.press as RowPress
        const r = args.demo === true ? onDemoPress(id, p, args.thread) : await onPress(id, p, args.thread)
        return { ...text(r.error ?? (r.note ? noteText(r.note) : 'Done')), structuredContent: r }
      }
    }

    return { ...text(`Unknown tool: ${name}`), isError: true }
  }

  return async m => {
    const { id, method, params } = m
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'inbox', version: '0.1.0' },
        })
      case 'tools/list':
        return ok({ tools })
      case 'tools/call': {
        const name = String(params?.name ?? '')
        const args = (params?.arguments ?? {}) as Record<string, unknown>
        try {
          return ok(await callTool(name, args, sessionOf(params), turnOf(params)))
        } catch (err) {
          return ok({ ...text(`Failed: ${err instanceof Error ? err.message : String(err)}`), isError: true })
        }
      }
      case 'resources/list':
        return ok({ resources: [{ uri, name: 'Inbox', mimeType: TAB_MIME }] })
      case 'resources/templates/list':
        return ok({ resourceTemplates: [] })
      case 'resources/read':
        return ok({ contents: [{ uri, mimeType: TAB_MIME, text: stamped(deps.tabHtml) }] })
      case 'ping':
        return ok({})
    }
    if (id === undefined) return null

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}
