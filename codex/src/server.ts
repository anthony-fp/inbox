// The plugin's MCP server: Codex's record_finding, close and inbox tools, and
// the Inbox tab with the app-only tools it calls. It speaks MCP over stdio by
// hand, since it needs only a few message shapes.

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

import {
  applyPrPress,
  fetchTracked,
  isDismissing,
  isTracked,
  itemPrSteps,
  prRowId,
  splitLinked,
} from '../../hooks/pr-tab'
import type { Applied, PrPress } from '../../hooks/pr-tab'
import {
  applyPress,
  demoRecord,
  demoTurns,
  doneWake,
  localPath,
  markSentToAgent,
  recordPress,
  withDeliveryId,
  noteText,
  openCommands,
  runLocalEffects,
  runSends,
  withAcceptedSend,
  withLasts,
  withUnconfirmed,
} from '../../hooks/presses'
import type { EffectHost, RowPress } from '../../hooks/presses'
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
import { ghFinder, ghIn } from './gh'
import { SETTLED_MS } from '../../hooks/view'
import { SETTLE_WINDOW_MS } from './settle'
import { readState, updateState } from './state'
import { reconcileUpdateStatus } from './update'
import type { SessionState } from './state'
import { CODEX, INBOX_DESCRIPTION, inboxToolText, VIEW_DESCRIPTION } from './texts'
import type { Run } from './run'
import type { LastAction, PrViews, RowNote } from '../../types'

/**
 * The tab's address for one build of its page. Codex keeps a tab's page by its address, even across server
 * restarts, so a new build needs a new address for a new chat to load it. An open tab learns of a new build
 * from `devPage` and swaps its page itself.
 */
export function tabUri(tabHtml: string): string {
  return `ui://inbox/tab-${createHash('sha256').update(tabHtml).digest('hex').slice(0, 12)}`
}
const TAB_MIME = 'text/html;profile=mcp-app'

const APP_ONLY = { ui: { visibility: ['app'] } }
/** How old a session's PRs may be before a view asks gh again. */
const PRS_REFRESH_MS = 120_000
/** How soon a PR linked since the last fetch, which has no view yet, is fetched. */
const NEW_PR_FETCH_MS = 15_000

/** A press as the server applies it: the ledger after it, the last actions it records and removes, and its effects. */
type Pressed = Exclude<Applied, { stale: true }>

/** The PR views a session still shows: those it tracks, and a PR dismissed moments ago, which draws settled. */
function viewsStillShown(
  prs: PrViews,
  linked: string[],
  lastActions: Record<string, LastAction>,
  at: number,
): PrViews['views'] {
  return Object.fromEntries(
    Object.entries(prs.views).filter(([ref]) => isTracked(prs, linked, ref) || isDismissing(lastActions, ref, at)),
  )
}

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
    description: 'The tab page the server serves now.',
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
  /** Why the loader could not load a newer build of the server, while this one keeps running. */
  loadError?: () => string | null
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
  delivery?: 'unconfirmed'
}

export function makeServer(deps: ServerDeps): (m: Message) => Promise<Record<string, unknown> | null> {
  const { dir, now } = deps
  const uri = tabUri(deps.tabHtml)
  const tools = toolsFor(uri)
  const findGh = ghFinder(deps.exec)
  // Per session, in memory only: a server that restarts fetches again on its first view.
  const fetchingPrs = new Set<string>()
  const prsFetchedAt = new Map<string, number>()
  let isGhMissing = false

  async function queueMessage(
    s: SessionState,
    message: string,
    resolvedCli?: string,
  ): Promise<
    | { state: 'accepted'; queuedId: string | null }
    | { state: 'rejected'; reason: string }
    | { state: 'unconfirmed'; reason: string }
  > {
    let cli: string
    try {
      cli = resolvedCli ?? s.cliPath ?? (await deps.fallbackCli())
    } catch (err) {
      return { state: 'rejected', reason: err instanceof Error ? err.message : String(err) }
    }
    try {
      const r = await deps.exec([cli, 'queue', '--thread', s.sessionId, '--message', message], {
        cwd: s.root || '/',
        timeoutMs: 15_000,
      })
      if (r.code !== 0) return { state: 'unconfirmed', reason: r.stderr.trim() || `codex queue exited ${r.code}` }
      return { state: 'accepted', queuedId: /Queued message (\S+)/.exec(r.stdout)?.[1] ?? null }
    } catch (err) {
      return { state: 'unconfirmed', reason: err instanceof Error ? err.message : String(err) }
    }
  }

  function completedAttempt(
    state: SessionState,
    deliveryId: string,
    outcome: Awaited<ReturnType<typeof queueMessage>>,
  ): SessionState {
    if (outcome.state === 'rejected') return { ...state, sent: state.sent.filter(s => s.deliveryId !== deliveryId) }
    const index = state.sent.findIndex(s => s.deliveryId === deliveryId)
    const attempt = state.sent[index]
    if (!attempt) return state
    const earlierUnknown = state.sent
      .slice(0, index)
      .some(s => s.text === attempt.text && (s.phase === 'attempting' || s.phase === 'uncertain'))
    let lastActions = state.lastActions
    if (outcome.state === 'accepted' && !earlierUnknown) {
      for (const [id, action] of Object.entries(lastActions)) {
        if (action.delivery && 'id' in action.delivery && action.delivery.id === deliveryId)
          lastActions = withAcceptedSend(lastActions, [id], action.at, attempt.text, deliveryId)
      }
    }
    return {
      ...state,
      lastActions,
      sent: state.sent.map(s =>
        s.deliveryId === deliveryId
          ? {
              ...s,
              phase: outcome.state === 'accepted' ? ('accepted' as const) : ('uncertain' as const),
              queuedId: outcome.state === 'accepted' ? outcome.queuedId : null,
            }
          : s,
      ),
    }
  }

  async function wakeForDone(id: string) {
    const check = (s: SessionState) =>
      doneWake(s.ledger, { now: now(), windowMs: SETTLE_WINDOW_MS, isTurnRunning: s.turn.person !== null })
    if (!check(await readState(dir, id))) return
    await updateState(dir, id, async (s, checkpoint) => {
      const wake = check(s)
      if (!wake) return s
      const cli = s.cliPath ?? (await deps.fallbackCli())
      const deliveryId = randomUUID()
      const lastActions = { ...s.lastActions }
      for (const closed of s.ledger.closed) {
        if (!wake.ids.includes(closed.id)) continue
        const previous = lastActions[closed.id]
        const last =
          previous?.kind === 'mark' && previous.action === 'done' && previous.at === closed.at
            ? previous
            : recordPress('mark', 'done', 'Done', { now: closed.at, turnsStarted: s.presence.turnsStarted })
        lastActions[closed.id] = { ...last, delivery: { state: 'unconfirmed', message: wake.text, id: deliveryId } }
      }
      const next: SessionState = {
        ...s,
        ledger: markSentToAgent(s.ledger, wake.ids),
        lastActions,
        sent: [
          ...s.sent,
          {
            text: wake.text,
            press: { id: wake.ids[0]!, action: 'done' },
            at: now(),
            row: wake.ids[0]!,
            queuedId: null,
            pressedAt: null,
            deliveryId,
            phase: 'attempting',
          },
        ],
      }
      await checkpoint(next)
      return completedAttempt(next, deliveryId, await queueMessage(next, wake.text, cli))
    })
  }

  /** The tab page to show: the dev build's while it runs, else this handler's own, which a reinstall replaces. */
  const currentPage = async () => (await deps.devPage?.()) ?? deps.tabHtml

  /** Applies a row press or a PR press to the session's state. Pure. */
  const pressOn = (
    s: SessionState,
    p: RowPress | PrPress,
    at = now(),
    localPressId?: string,
  ): Pressed | { stale: true } => {
    const ctx = { now: at, turnsStarted: s.presence.turnsStarted, localPressId }
    if ('ref' in p) return applyPrPress(s.ledger, s.prViews, s.lastActions, p, ctx)
    const item = s.ledger.items.find(i => i.id === p.id)
    const r = applyPress(s.ledger, s.lastActions[p.id], p, {
      ...ctx,
      extraSteps: item ? itemPrSteps(item, s.prViews, s.ledger.prs) : [],
    })
    if ('stale' in r) return r

    return {
      ledger: r.ledger,
      lasts: r.last ? { [p.id]: r.last } : {},
      drop: [],
      effects: r.effects,
      ...(r.reopenedId ? { reopenedId: r.reopenedId } : {}),
    }
  }

  /**
   * Fetches the session's PRs through gh in the background. The result is saved for the tab's next poll. A PR
   * dismissed while the fetch ran stays dismissed, and one dismissed moments ago keeps its last view.
   */
  async function fetchPrs(id: string) {
    const s = await readState(dir, id)
    const bin = await findGh()
    isGhMissing = bin === null
    if (bin === null) return
    const { views: fetched, branchRef } = await fetchTracked(
      ghIn(deps.exec, bin, s.root),
      now,
      s.prViews,
      s.ledger.prs,
      true,
    )
    await updateState(dir, id, cur => {
      const at = now()
      const views = Object.fromEntries(
        Object.entries(fetched).filter(([ref]) => isTracked({ ...cur.prViews, branchRef }, cur.ledger.prs, ref)),
      )
      const dismissing = Object.fromEntries(
        Object.entries(cur.prViews.views).filter(([ref]) => isDismissing(cur.lastActions, ref, at)),
      )

      return { ...cur, prViews: { views: { ...dismissing, ...views }, branchRef, isFetching: false } }
    })
  }

  /** Starts a fetch when the session's PRs were never fetched, are old, or a linked PR has no view yet. */
  function fetchPrsWhenDue(id: string, s: SessionState) {
    if (fetchingPrs.has(id)) return
    const last = prsFetchedAt.get(id)
    const hasNewPr = splitLinked(s.ledger.prs).tracked.some(ref => !(ref in s.prViews.views))
    const isDue = last === undefined || now() - last >= PRS_REFRESH_MS || (hasNewPr && now() - last >= NEW_PR_FETCH_MS)
    if (!isDue) return
    fetchingPrs.add(id)
    void fetchPrs(id)
      .catch(() => undefined)
      .finally(() => {
        prsFetchedAt.set(id, now())
        fetchingPrs.delete(id)
      })
  }

  /** The view for the tab, with the session it was read for and the page the server serves now. */
  const served = async (s: SessionState, id: string, isDemo = false): Promise<TabView> => {
    const loadError = deps.loadError?.()
    const current = !isDemo && s.presence.isUpdating ? await reconcileUpdateStatus(dir, id) : s

    return {
      ...viewOf(current, now()),
      thread: id,
      isFetchingPrs: !isDemo && fetchingPrs.has(id),
      isGhMissing: !isDemo && isGhMissing,
      devPage: tabUri(await currentPage()),
      ...(deps.build ? { serverBuild: deps.build } : {}),
      ...(loadError ? { serverLoadError: loadError } : {}),
    }
  }

  async function onPress(id: string, p: RowPress | PrPress, thread: unknown): Promise<PressReply> {
    const rowId = 'ref' in p ? prRowId(p) : p.id
    const localPressId = randomUUID()
    let checkpointSaved = false
    let appliedSaved = false
    let isUnconfirmed = false
    let copy: PressReply['copy'] = null
    let error: string | null = null
    let note: PressReply['note'] = thread === id ? null : 'stale'
    // The press as applied under the lock, read once the lock is released.
    const pressed: { r?: Pressed; deliveryId?: string } = {}
    /** The press's effects, saving through `change`: the state a held lock writes, or a fresh lock each time. */
    const hostFor = (
      change: (f: (s: SessionState) => SessionState | Promise<SessionState>) => Promise<SessionState>,
    ): EffectHost => ({
      now,
      deliveryId: () => pressed.deliveryId ?? randomUUID(),
      // The tab copies, and shows the text to copy by hand when its frame has no clipboard.
      perform: async e => {
        if (e.kind === 'copy') {
          copy = { text: e.text, name: e.name }
          return null
        }
        return open(await readState(dir, id), e.target)
      },
      send: async (e, deliveryId) => {
        let sentOutcome: Awaited<ReturnType<typeof queueMessage>> | null = null
        return change(async s => {
          const outcome = await queueMessage(s, e.text)
          sentOutcome = outcome
          if (outcome.state === 'unconfirmed') isUnconfirmed = true
          return completedAttempt(s, deliveryId, outcome)
        }).then(
          () =>
            sentOutcome?.state === 'accepted'
              ? { state: 'accepted' as const }
              : sentOutcome?.state === 'rejected'
                ? { state: 'rejected' as const, reason: sentOutcome.reason }
                : { state: 'unconfirmed' as const, reason: sentOutcome?.reason ?? 'Queue outcome unknown' },
          (err: unknown) => ({
            state: 'unconfirmed' as const,
            reason: err instanceof Error ? err.message : String(err),
          }),
        )
      },
      saveLasts: async f => (await change(s => ({ ...s, lastActions: f(s.lastActions) }))).lastActions,
      saveLedger: async f => {
        await change(s => ({ ...s, ledger: f(s.ledger) }))
      },
    })
    await updateState(dir, id, async (s, checkpoint) => {
      if (note) return s
      // Read under the lock, so the press is timed after every write that landed before it.
      const at = now()
      const r = pressOn(s, p, at, localPressId)
      if ('stale' in r) {
        note = 'stale'
        return s
      }
      pressed.r = r
      const firstSend = r.effects.find(e => e.kind === 'send')
      pressed.deliveryId = firstSend ? randomUUID() : undefined
      const pressLasts =
        firstSend && pressed.deliveryId
          ? withDeliveryId(r.lasts, Object.keys(r.lasts), at, firstSend.text, pressed.deliveryId)
          : r.lasts
      let next: SessionState = {
        ...s,
        ledger: r.ledger,
        lastActions: withLasts(s.lastActions, pressLasts, r.drop),
        told: r.reopenedId ? { ...s.told, closed: s.told.closed.filter(id => id !== r.reopenedId) } : s.told,
      }
      if (firstSend && pressed.deliveryId) {
        next = {
          ...next,
          lastActions: withUnconfirmed(next.lastActions, firstSend.text, at, pressed.deliveryId),
          sent: [
            ...next.sent,
            {
              text: firstSend.text,
              press: firstSend.by,
              at: now(),
              row: rowId,
              queuedId: null,
              pressedAt: at,
              deliveryId: pressed.deliveryId,
              phase: 'attempting',
            },
          ],
        }
        await checkpoint(next)
        checkpointSaved = true
      }
      const held = hostFor(async f => (next = await f(next)))
      const failed = await runSends(held, r.effects, rowId, Object.keys(r.lasts), at)
      if (failed?.state === 'rejected') error = `Not sent: ${failed.reason}`

      return next
    })
      .then(() => {
        appliedSaved = true
      })
      .catch((err: unknown) => {
        if (checkpointSaved) isUnconfirmed = true
        error = checkpointSaved ? null : `Not sent: ${err instanceof Error ? err.message : String(err)}`
      })
    // A server restart loses the timer; the tab's next poll checks again.
    if (pressed.r && !('ref' in p) && p.action === 'done')
      setTimeout(() => void wakeForDone(id).catch(() => undefined), SETTLE_WINDOW_MS).unref()
    if (pressed.r && (appliedSaved || checkpointSaved))
      await runLocalEffects(
        hostFor(f => updateState(dir, id, f)),
        pressed.r.effects,
        rowId,
        pressed.r.lasts[rowId]?.result,
      )

    return {
      view: await served(await readState(dir, id), id),
      copy,
      error,
      note,
      ...(isUnconfirmed ? { delivery: 'unconfirmed' as const } : {}),
    }
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
  async function onDemoPress(id: string, p: RowPress | PrPress, thread: unknown): Promise<PressReply> {
    const s = demoOf(id)
    const r = thread === id ? pressOn(s, p) : ({ stale: true } as const)
    if ('stale' in r) return { view: await served(s, id, true), copy: null, error: null, note: 'stale' }
    const { lasts, isSample } = demoRecord(r.lasts, r.effects)
    const next: SessionState = {
      ...s,
      ledger: r.ledger,
      lastActions: withLasts(s.lastActions, lasts, r.drop),
      presence: { ...s.presence, ...demoTurns(s.presence, r.effects) },
    }
    demos.set(id, next)
    // The sample reply, as the mod's demo gives it, once the sample note has shown.
    if (r.effects.some(e => e.kind === 'send'))
      setTimeout(() => {
        const d = demos.get(id)
        if (d) demos.set(id, { ...d, presence: { ...d.presence, ...demoTurns(d.presence, [], true) } })
      }, SETTLED_MS).unref()

    return { view: await served(next, id, true), copy: null, error: null, note: isSample ? 'sample' : null }
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
        if (args.demo === true) return { ...text('Inbox demo'), structuredContent: await served(demoOf(id), id, true) }
        await wakeForDone(id).catch(() => undefined)
        // A dismissed PR's view leaves once its settled block has.
        const s = await updateState(dir, id, s => ({
          ...s,
          tabSeenAt: now(),
          prViews: { ...s.prViews, views: viewsStillShown(s.prViews, s.ledger.prs, s.lastActions, now()) },
        }))
        fetchPrsWhenDue(id, s)
        return { ...text('Inbox view'), structuredContent: await served(s, id) }
      }
      case 'inbox_tab_page':
        return { ...text('Tab page'), structuredContent: { html: stamped(await currentPage()) } }
      case 'inbox_press': {
        const p = args.press as RowPress | PrPress
        const r = await (args.demo === true ? onDemoPress(id, p, args.thread) : onPress(id, p, args.thread))
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
          serverInfo: { name: 'inbox', version: '0.2.6' },
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
      case 'resources/read': {
        // Codex asks by the address from the tools/list it read when the server started, and drops the frame when
        // the reply names another. A build loaded since then has a new address, so answer under the one asked for.
        const asked = String(params?.uri ?? '')

        return ok({
          contents: [
            { uri: asked.startsWith('ui://inbox/tab-') ? asked : uri, mimeType: TAB_MIME, text: stamped(deps.tabHtml) },
          ],
        })
      }
      case 'ping':
        return ok({})
    }
    if (id === undefined) return null

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}
