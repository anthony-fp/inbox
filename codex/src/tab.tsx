// The Inbox tab beside a Codex conversation, bundled into tab.html. It polls
// the plugin's server for the view and sends presses back. It owns how the
// Codex look draws a row; row rules come from hooks/view.ts. See docs/looks.md.

import { render } from 'preact'
import { ActionButton, RowActions, ledgerActions, Icon } from './row-actions'
import type { ComponentChildren, JSX } from 'preact'
import type { IconName } from './row-actions'

import { closedState } from '../../hooks/ledger'
import { ago } from '../../hooks/text'
import type { ClosedState } from '../../hooks/ledger'
import { CLOSED_MARKS } from '../../hooks/view'
import { baseName, capitalized, clipLabel, noteText, pendingResult, stepEffects } from '../../hooks/presses'
import type { RowPress } from '../../hooks/presses'
import {
  allRows,
  closedShown,
  closedTotal,
  DEMO_NOTICE,
  DOT,
  earlierLabel,
  drawnLists,
  emptyText,
  groupEmptyText,
  entryId,
  TABS,
  feedbackOf,
  feedbackText,
  foldLabel,
  hasAge,
  isFailure,
  isGuarded,
  firstWaiting,
  keptOpen,
  listWaits,
  PRESS_GUARD_MS,
  rowAfterClose,
  replyHint,
  rowMark,
  rowFeedbackText,
  settledLabel,
  ROW_COPY,
  SETTLED_MS,
  settledIn,
  shortAgo,
} from '../../hooks/view'
import { ROW_PAD_PT } from '../../hooks/layout'
import type { ActionEmphasis, DrawnEntry, DrawnLists, Feedback, RowView, RowWait } from '../../hooks/view'
import {
  checkActions,
  PR_TONES,
  prBlockActions,
  prCheckId,
  prMarkId,
  prRowWaits,
  prThreadId,
  threadActions,
  threadShowsCheckIn,
  threadSentIn,
} from '../../hooks/pr-tab'
import type { PrAction, PrPress } from '../../hooks/pr-tab'
import {
  commentLine,
  commentParts,
  failingChecks,
  readableComment,
  readiness,
  THREAD_TITLE_CHARS,
  threadWhere,
  took,
  waitingThreads,
} from '../../hooks/prs'
import type { Finding, PrCheck, PrThread, PrView } from '../../types'
import { followTo } from '../../hooks/arrivals'
import { parseInline } from '../../hooks/inline'
import { isShownEmpty, newRows, openRows, TAB_IDS, TAB_OF } from './arrivals'
import type { FoldGroup, Group, SeenRows, Tab } from './arrivals'
import type { TabView as View } from './core'
import type { PressReply } from './server'
import { ENTER_MS, EXIT_MS, isMoving, MOVE_MS, ROW_STATE_MS, stepRow } from './rows'
import type { RowState, RowTarget, RowTrack } from './rows'
import { drawnSettled, POLL_MS, PRESS_TIMEOUT_MS, settledIds, settledSeen } from './settle'

type Tone = 'needsYou' | 'issue' | 'findings' | 'done' | 'error'

/** The tabs: Needs you and Findings list the ledger's rows, PRs lists what the server fetched from GitHub. */
type ShownTab = Tab | 'prs'

/**
 * How loudly an action draws: `primary` is a filled button, at most one per row; `normal` an outlined button; `quiet`
 * plain text.
 */
type Emphasis = ActionEmphasis

/** One of a row's actions, with the key that presses it while the tab has focus, if it has one. */
type Key = {
  hotkey?: string
  label: string
  emphasis: Emphasis
  /** Drawn at the far right of the action row. */
  isDismiss?: boolean
  icon?: IconName
  run: () => void
}

/** A list row. Selected, it shows its title in full, its body and its keys; otherwise one line. */
type Row = {
  id: string
  view?: RowView
  handle: string
  /** `done` once the row is handed to Codex, which also sets how its feedback reads. */
  handleTone?: Tone
  /** A finding's kind, which sets its handle's color and size. */
  kind?: Finding['kind']
  /** Muted text before the title: a PR thread's file and line, or a check's workflow. */
  lead?: string
  title: string
  /** A second muted line under a closed row's title: who wrote a PR thread, or how long a check ran. */
  meta?: string
  /** How long ago the row appeared, in the side column. */
  age?: string
  body?: JSX.Element | null
  keys: Key[]
  /** Actions that talk about the row or drop it, after `keys`. */
  more: Key[]
  /** The row no longer waits on the person, so its group's count leaves it out. Selected, it also shows `note`. */
  fold?: { note?: string }
  typing?: { hint: string; send: (text: string) => void }
  feedback: Feedback | null
}

/** A row that just closed, drawn in its place with its outcome, or a row still open. */
type Entry = DrawnEntry<Row>

let view: View | null = null
// The demo shows the mod's sample entries, and its presses send nothing.
let isDemo = false
// Why the first read of the view failed, which leaves no view to show. Null when it has not failed.
let readError: string | null = null
/**
 * What the tab says about the server it talks to: why a newer build of it did not load, or that its fingerprint
 * still differs from this page's while the page cannot replace itself. Null when neither holds.
 */
let serverNote: { text: string; isReloadable: boolean } | null = null
// Whether the first read has taken long enough to say "Loading…". A read that answers sooner shows nothing in between.
let isLoadingShown = false
let isConnected = false
let initializing: Promise<boolean> | null = null
let didStart = false
type HostContext = Parameters<typeof applyHost>[0]
let hostContext: HostContext = {}
let stagedHostChanges: HostContext = {}
// Polls that failed in a row while a view shows, and when the shown view was read.
let pollFailures = 0
let readAt = 0
let tab: ShownTab = 'needsYou'
// Each tab's open row, and when a click or key opened it; 0 when it was open by default when pressed.
// Null until a row opens there, and again once a press closed the open row with no other row waiting: the tab then
// draws its first waiting row open.
// `index` is the row's place when it opened, so the row in that place opens once it leaves.
const selection: Record<ShownTab, { id: string; openedAt: number; index?: number } | null> = {
  needsYou: null,
  findings: null,
  prs: null,
}
let typing: string | null = null
let focusTyping = false
// Typed text by row, kept until it is sent, so a redraw, a new selection or a closed field keeps it.
const drafts = new Map<string, { text: string }>()
// Questions whose every option shows. Until then, one with more than 5 options shows 4.
const optionsShown = new Set<string>()
const unfolded = new Set<FoldGroup>()
// What a row shows while its press runs: "Sending…", or a Local press's pending note.
const sending = new Map<string, string>()
const latestPress = new Map<string, number>()
const errors = new Map<string, string>()
// A row's stale or sample note, shown for SETTLED_MS from `at`.
const notes = new Map<string, { text: string; at: number }>()
const copies = new Map<string, { name: string; text: string }>()
// A note for a press whose row is no longer drawn, shown on its own line under the tab row for SETTLED_MS.
let lineNote: { text: string; at: number; isError?: boolean } | null = null
// When the tab first saw each row the view lists as settled. It draws one in place for SETTLED_MS from then.
let seen = new Map<string, number>()
// The row ids the tab has seen in each tab.
let rowsSeen: SeenRows = {}
// Rows and Closed lists that arrived since the last draw, which grow in when they are first drawn.
const entering = new Set<string>()
// Settled rows whose Undo press is out. They stay drawn, and their Undo fill stops, until it answers.
const undoing = new Set<string>()
// Closed folds still drawn while their list collapses.
const closingFolds = new Set<FoldGroup>()
/**
 * A row the shown tab draws: its state in the machine in rows.ts, and the row as it last drew open, whose panel it
 * keeps while it closes, settles or leaves.
 */
type DrawnRow = { track: RowTrack; openRow?: Row }
// Each drawn row, by id. The rows of a tab not shown have none.
const drawnRows = new Map<string, DrawnRow>()
// The lists the last row step returned, which the draw shows and the next step reads each row's place from.
let lastLists: Lists | null = null
// Each view request takes the next number, and a reply older than the view shown is dropped.
let requested = 0
let shown = 0
let activePresses = 0
let viewGeneration = 0

// ── State kept across a page swap ───────────────────────────────────────────

type Kept = {
  version: 1
  isDemo: boolean
  tab: ShownTab
  selection: Record<ShownTab, string | null>
  typing: string | null
  drafts: [string, string][]
  optionsShown: string[]
  /** An earlier page kept 'finding' for the one fold Findings had. */
  unfolded: (FoldGroup | 'finding')[]
}
type CandidatePage = {
  initialize: () => Promise<boolean>
  activate: (kept: Kept) => void
  start: () => void
  dispose: () => void
}
type PageHandoff = {
  page: string
  root: HTMLDivElement
  aborted: boolean
  dispose?: () => void
  ready: (candidate: CandidatePage) => void
}
const KEPT_KEY = 'inbox-tab-kept'
const inboxWindow = window as Window & {
  __inboxPage?: string
  __inboxKept?: Kept
  __inboxRequestId?: number
  __inboxHandoff?: PageHandoff
}
const handoff = inboxWindow.__inboxHandoff ?? null
const root = handoff?.root ?? document.getElementById('app')!
const instanceAbort = new AbortController()
const timers = new Set<number>()
const animations = new Set<Animation>()
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: number }>()
let isDisposed = false
let isActive = handoff === null
if (handoff) handoff.dispose = dispose

function later(run: () => void, ms: number): number {
  if (isDisposed) return 0
  const id = window.setTimeout(() => {
    timers.delete(id)
    if (!isDisposed) run()
  }, ms)
  timers.add(id)
  return id
}

function cancelTimer(id: number | undefined) {
  if (id === undefined) return
  window.clearTimeout(id)
  timers.delete(id)
}

function dispose() {
  if (isDisposed) return
  isDisposed = true
  instanceAbort.abort()
  for (const timer of timers) window.clearTimeout(timer)
  timers.clear()
  for (const animation of animations) {
    animation.onfinish = null
    animation.oncancel = null
    animation.cancel()
  }
  animations.clear()
  for (const request of pending.values()) request.reject(new Error('Inbox page replaced'))
  pending.clear()
  render(null, root)
  if (isActive) document.body.classList.remove('still')
}

function capturedState(): Kept {
  return {
    version: 1,
    isDemo,
    tab,
    selection: {
      needsYou: selection.needsYou?.id ?? null,
      findings: selection.findings?.id ?? null,
      prs: selection.prs?.id ?? null,
    },
    typing,
    drafts: [...drafts].map(([id, draft]) => [id, draft.text]),
    optionsShown: [...optionsShown],
    unfolded: [...unfolded],
  }
}

function restoreState(incoming?: Kept) {
  let kept: Kept | null = incoming ?? inboxWindow.__inboxKept ?? null
  if (!incoming) {
    delete inboxWindow.__inboxKept
    try {
      const raw = sessionStorage.getItem(KEPT_KEY)
      sessionStorage.removeItem(KEPT_KEY)
      kept ??= raw ? (JSON.parse(raw) as Kept) : null
    } catch {}
  }
  if (kept?.version !== 1) return
  isDemo = kept.isDemo
  tab = kept.tab
  for (const t of [...TAB_IDS, 'prs'] as const) {
    const id = kept.selection[t]
    // An openedAt of 0 reads as open by default, so the restored row's actions take a press at once.
    selection[t] = id ? { id, openedAt: 0 } : null
  }
  typing = kept.typing
  focusTyping = typing !== null
  for (const [id, text] of kept.drafts) drafts.set(id, { text })
  for (const id of kept.optionsShown) optionsShown.add(id)
  for (const g of kept.unfolded)
    for (const fold of g === 'finding' ? (['issue', 'opportunity'] as const) : [g]) unfolded.add(fold)
}

// ── The host ────────────────────────────────────────────────────────────────

/** Sends a request to the host. With `timeoutMs`, a request the host has not answered by then fails, and a later answer is dropped. */
function request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
  if (isDisposed) return Promise.reject(new Error('Inbox page replaced'))
  return new Promise((resolve, reject) => {
    const id = (inboxWindow.__inboxRequestId = (inboxWindow.__inboxRequestId ?? Date.now()) + 1)
    const timer =
      timeoutMs === undefined
        ? undefined
        : later(() => {
            if (pending.delete(id)) reject(new Error(`The inbox did not answer in ${Math.round(timeoutMs / 1000)} s`))
          }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
  })
}

window.addEventListener(
  'message',
  e => {
    if (isDisposed) return
    const m = e.data
    if (!m || m.jsonrpc !== '2.0') return
    if (m.id != null && !m.method && pending.has(m.id)) {
      const p = pending.get(m.id)!
      pending.delete(m.id)
      cancelTimer(p.timer)
      if (m.error) p.reject(m.error)
      else p.resolve(m.result)
      return
    }
    if (m.method === 'ui/notifications/host-context-changed') {
      if (isActive) applyHost(m.params ?? {})
      else stagedHostChanges = mergeHostContext(stagedHostChanges, m.params ?? {})
    }
    if (!isActive) return
    if (m.id != null && m.method) parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*')
  },
  { signal: instanceAbort.signal },
)

function applyHost(ctx: { theme?: string; styles?: { variables?: Record<string, string> } }) {
  if (isDisposed || !isActive) return
  if (ctx.theme) document.documentElement.dataset.theme = ctx.theme
  for (const [k, v] of Object.entries(ctx.styles?.variables ?? {})) document.documentElement.style.setProperty(k, v)
}

function mergeHostContext(current: HostContext, next: HostContext): HostContext {
  return {
    ...current,
    ...next,
    styles: {
      ...current.styles,
      ...next.styles,
      variables: { ...current.styles?.variables, ...next.styles?.variables },
    },
  }
}

/** A tool's answer for the tab. A call the server could not answer throws, as a failed request does. */
async function callTool<T>(name: string, args: unknown = {}, timeoutMs?: number): Promise<T> {
  const r = (await request('tools/call', { name, arguments: args }, timeoutMs)) as
    { structuredContent?: T; isError?: boolean; content?: { text?: string }[] } | undefined
  if (isDisposed) throw new Error('Inbox page replaced')
  if (!r || r.isError || r.structuredContent === undefined)
    throw new Error((r?.isError && r.content?.[0]?.text) || 'The answer had nothing to show')

  return r.structuredContent
}

// ── The view ────────────────────────────────────────────────────────────────

function applyView(next: View, seq: number) {
  if (isDisposed || seq < shown) return
  shown = seq
  readError = null
  pollFailures = 0
  readAt = Date.now()
  const before = seen
  seen = settledSeen(seen, settledIds(next), Date.now())
  // A row seen settled for the first time starts to leave once SETTLED_MS passes. Its exit schedules its own end.
  if ([...seen.keys()].some(id => !before.has(id))) drawIn(SETTLED_MS)
  view = next
  // A dismissed PR's block draws settled until its time is up.
  for (const { pr, isSettled } of next.prs.drawn)
    if (isSettled) drawIn(Math.max(0, SETTLED_MS - (next.at - (next.lastActions[prMarkId(pr.ref)]?.at ?? next.at))))
  const isOpening = TAB_IDS.every(t => rowsSeen[t] === undefined)
  const rows = newRows(rowsSeen, next)
  rowsSeen = rows.seen
  const added = [...rows.added.needsYou, ...rows.added.findings]
  for (const id of added) entering.add(id)
  // A tab that drew its first waiting row open keeps that row open when rows arrive above it, as the mod's pane does.
  for (const t of TAB_IDS) {
    const id = !selection[t] && rows.added[t].length > 0 ? keptOpen(tabWaits(next, t), rows.added[t]) : null
    if (id) selection[t] = { id, openedAt: 0 }
  }
  // The first view moves the tab toward the rows each tab lists, as later ones do toward rows that just appeared.
  follow(next, isOpening ? openRows(next) : rows.added)
  draw()
}

/** Moves to the other tab for its new rows while the tab on screen shows only its empty text, as the mod's pane does. */
function follow(v: View, added: Record<Tab, string[]>) {
  // PR rows come from a fetch, all at once, so they never move the person off the tab they are on.
  if (tab === 'prs') return
  const drawn = shownSettled()
  const to = followTo(TAB_IDS, tab, isShownEmpty(v, tab, drawn, unfolded), added)
  if (!to) return
  tab = to
  // With no row chosen, the tab draws its top row open, as the mod's pane does.
  selection[to] = null
}

/** How long the first read may take before the tab says it is loading, so a fast one shows no flash. */
const LOADING_DELAY_MS = 300
const PAGE_START_MS = 2_000

/** How long a view read may go unanswered before it counts as failed, so a lost answer cannot stop the polls. */
const READ_TIMEOUT_MS = 3 * POLL_MS

/** Reads the view once. A failed first read shows that the inbox could not be read; a failed poll after it counts toward "retrying". */
async function read() {
  const generation = viewGeneration
  const seq = ++requested
  try {
    const next = await callTool<View>('inbox_view', { demo: isDemo }, READ_TIMEOUT_MS)
    if (generation !== viewGeneration || seq < shown) return
    requestedPage = next.devPage
    if (updateError?.page !== requestedPage) updateError = null
    const isPageOld = requestedPage !== PAGE
    if (isPageOld && !updateError) void swapPage(requestedPage)
    serverNote = next.serverLoadError
      ? {
          text: `The inbox server could not load its new build, so it still runs the last one. ${next.serverLoadError}`,
          isReloadable: false,
        }
      : next.serverBuild !== SERVER_BUILD && !isPageOld
        ? { text: 'This tab and the inbox server are from different builds.', isReloadable: true }
        : null
    applyView(next, seq)
  } catch (err) {
    if (isDisposed || generation !== viewGeneration || seq < shown) return
    if (view) pollFailures++
    else readError = failureText(err)
    draw()
  }
}

/** A failed request's reason, clipped to one short line. The host rejects with its JSON-RPC error object, not an Error. */
function failureText(err: unknown): string {
  const message =
    typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : String(err)
  const reason =
    clipLabel(
      message
        .replace(/^(Failed|Not done): /, '')
        .replace(/\s+/g, ' ')
        .trim(),
      120,
    ) || 'No reason given'

  return capitalized(/[.!?…]$/.test(reason) ? reason : `${reason}.`)
}

const PAGE = handoff?.page ?? inboxWindow.__inboxPage
let isSwapping = false
let requestedPage: string | null = null
let updateError: { page: string; text: string } | null = null

async function swapPage(target: string) {
  if (isSwapping || isDisposed || target === PAGE) return
  isSwapping = true
  let staged: PageHandoff | null = null
  let nextScript: HTMLScriptElement | null = null
  let committed = false
  try {
    const { html } = await callTool<{ html: string }>('inbox_tab_page', {}, READ_TIMEOUT_MS)
    if (isDisposed || requestedPage !== target) return
    if (!/<\/html>\s*$/i.test(html)) throw new Error('The new page is incomplete.')
    const incoming = new DOMParser().parseFromString(html, 'text/html')
    const pageRoot = incoming.getElementById('app')
    const pageStyle = incoming.getElementById('inbox-style') ?? incoming.head.querySelector('style')
    const pageScript = incoming.getElementById('inbox-script') ?? incoming.body.querySelector('script')
    const stamp = [...incoming.head.querySelectorAll('script')]
      .map(script => script.textContent?.match(/^\s*window\.__inboxPage\s*=\s*("[^"\n]+")\s*;?\s*$/)?.[1])
      .find(value => value !== undefined)
    const page = stamp ? (JSON.parse(stamp) as unknown) : null
    const supportsHandoff = incoming.querySelector('meta[name="inbox-handoff"]')?.getAttribute('content') === '1'
    const ownedStyle = document.getElementById('inbox-style')
    const ownedScript = document.getElementById('inbox-script')
    if (
      !(pageRoot instanceof HTMLDivElement) ||
      pageRoot.childNodes.length > 0 ||
      !(pageStyle instanceof HTMLStyleElement) ||
      !pageStyle.textContent ||
      !(pageScript instanceof HTMLScriptElement) ||
      pageScript.src ||
      !pageScript.textContent ||
      typeof page !== 'string' ||
      page !== target ||
      !/^ui:\/\/inbox\/tab-[a-f0-9]{12}$/.test(page) ||
      !supportsHandoff ||
      !(ownedStyle instanceof HTMLStyleElement) ||
      !(ownedScript instanceof HTMLScriptElement)
    )
      throw new Error('The new page is incomplete.')
    const nextRoot = document.createElement('div')
    nextRoot.id = 'app'
    const nextStyle = document.createElement('style')
    nextStyle.id = 'inbox-style'
    nextStyle.textContent = pageStyle.textContent
    nextScript = document.createElement('script')
    nextScript.id = 'inbox-script-candidate'
    nextScript.textContent = pageScript.textContent
    let ready!: (candidate: CandidatePage) => void
    const candidateReady = new Promise<CandidatePage>(resolve => (ready = resolve))
    staged = {
      page,
      root: nextRoot,
      aborted: false,
      ready: candidate => {
        if (!staged?.aborted && inboxWindow.__inboxHandoff === staged) ready(candidate)
      },
    }
    inboxWindow.__inboxHandoff = staged
    document.body.append(nextScript)
    const waitFor = <T,>(promise: Promise<T>, ms: number) =>
      new Promise<T>((resolve, reject) => {
        const timeout = later(() => reject(new Error('The new page did not start.')), ms)
        void promise.then(
          value => {
            cancelTimer(timeout)
            resolve(value)
          },
          error => {
            cancelTimer(timeout)
            reject(error)
          },
        )
      })
    const candidate = await waitFor(candidateReady, PAGE_START_MS)
    if (!(await waitFor(candidate.initialize(), READ_TIMEOUT_MS))) throw new Error('The new page could not connect.')
    const deadline = Date.now() + PRESS_TIMEOUT_MS
    while (activePresses > 0 && Date.now() < deadline) await new Promise<void>(resolve => later(resolve, 30))
    if (activePresses > 0) throw new Error('The current press is still running.')
    if (isDisposed || requestedPage !== target || staged.aborted) return
    const kept = capturedState()
    root.replaceWith(nextRoot)
    try {
      ownedStyle.replaceWith(nextStyle)
      candidate.activate(kept)
      candidate.start()
    } catch (err) {
      if (nextRoot.isConnected) nextRoot.replaceWith(root)
      if (nextStyle.isConnected) nextStyle.replaceWith(ownedStyle)
      applyPageVariables()
      throw err
    }
    dispose()
    ownedScript.remove()
    nextScript.id = 'inbox-script'
    inboxWindow.__inboxPage = page
    committed = true
  } catch {
    if (!isDisposed && requestedPage === target) {
      updateError = { page: target, text: 'Could not load the inbox update.' }
      draw()
    }
  } finally {
    if (staged) {
      staged.aborted = true
      if (inboxWindow.__inboxHandoff === staged) delete inboxWindow.__inboxHandoff
      if (!committed) {
        try {
          staged.dispose?.()
        } catch {}
      }
    }
    if (!committed) nextScript?.remove()
    isSwapping = false
  }
}

async function poll() {
  if (activePresses === 0) await read()
  later(poll, POLL_MS)
}

/** Whether the view lists an open row with this id, which can show a note. */
function isListed(v: View, id: string): boolean {
  return (
    allRows(v).some(r => r.id === id && r.state.is !== 'settled') ||
    prRows(v).some(r => r.id === id) ||
    v.prs.drawn.some(d => prMarkId(d.pr.ref) === id)
  )
}

/** Whether the view lists this row as reading "Not sent". */
function isNotSent(v: View, id: string): boolean {
  return (
    allRows(v).some(r => r.id === id && r.feedback?.is === 'notSent') ||
    feedbackOf(id, v.lastActions[id], undefined, v.turns, v.at)?.is === 'notSent'
  )
}

/**
 * Sends a press, drawn for the view's session, to the server. `onSent` runs
 * only once the press went through, so a stale or failed press keeps a typed draft.
 */
async function act(rowId: string, press: RowPress | PrPress, onSent?: () => void, pending = 'Sending…') {
  if (isDisposed) return
  const generation = viewGeneration
  const seq = ++requested
  latestPress.set(rowId, seq)
  const isLatest = () => latestPress.get(rowId) === seq
  // Undo is pressed on a row that just closed, and a PR block's actions on no row.
  if (press.action !== 'undo' && !rowId.startsWith('pr:')) keepPressedOpen(rowId)
  const wasWaiting = !!view && tabWaits(view, tab).some(r => r.id === rowId && r.isWaiting)
  sending.set(rowId, pending)
  errors.delete(rowId)
  notes.delete(rowId)
  copies.delete(rowId)
  draw()
  activePresses++
  try {
    const r = await callTool<PressReply>('inbox_press', { press, thread: view?.thread, demo: isDemo }, PRESS_TIMEOUT_MS)
    if (isDisposed || generation !== viewGeneration) return
    if (r.copy) await copy(rowId, r.copy, isLatest)
    if (isDisposed || generation !== viewGeneration || !isLatest()) return
    if (r.view) applyView(r.view, seq)
    // A message that did not send shows on its row, from the view, when the row is there to show it.
    if (r.error && !(view && isNotSent(view, rowId))) errors.set(rowId, r.error)
    // A sample press went through on the demo's copy, so its typed words go as a real press's do.
    // After the view, so `onSent` reads the rows as they are after the press.
    if (!r.error && r.note !== 'stale' && r.delivery !== 'unconfirmed') onSent?.()
    if (!r.error && r.note !== 'stale' && r.delivery !== 'unconfirmed' && r.view && wasWaiting && typing !== rowId)
      openAfterClose(r.view, rowId)
    // A recording build leaves out the note that marks a press as a sample's.
    const note = DEMO_RECORDING && r.note === 'sample' ? null : r.note
    if (note && view && isListed(view, rowId)) {
      notes.set(rowId, { text: noteText(note), at: Date.now() })
      drawIn(SETTLED_MS)
      // A stale press's typed words go back into the field they were sent from.
      if (note === 'stale' && press.action === 'type') typing = rowId
    } else if (note) {
      lineNote = { text: noteText(note), at: Date.now() }
      drawIn(SETTLED_MS)
    }
  } catch {
    if (isDisposed || generation !== viewGeneration || !isLatest()) return
    errors.set(rowId, 'Action unconfirmed: the inbox did not answer.')
  } finally {
    activePresses--
    if (isLatest()) {
      latestPress.delete(rowId)
      sending.delete(rowId)
      draw()
    }
  }
}

/** A tab's rows in drawn order, and whether each still waits on the person. */
function tabWaits(v: View, t: ShownTab): RowWait[] {
  return t === 'prs'
    ? prRowWaits(
        v.prs.drawn.filter(x => !x.isSettled).map(x => x.pr),
        v.lastActions,
      )
    : listWaits(v)[t]
}

/**
 * Once a press stopped the shown tab's open row `id` waiting on the person, as an answer, a close or a hand-off does,
 * opens the next row that still waits. With none waiting, the tab goes back to opening its first waiting row, so a
 * row a later reply brings opens.
 */
function openAfterClose(v: View, id: string) {
  if (selection[tab]?.id !== id) return
  const rows = tabWaits(v, tab)
  if (rows.find(r => r.id === id)?.isWaiting) return
  const next = rowAfterClose(rows, id)
  const index = next === null ? -1 : tabRows(v, tab).findIndex(r => r.id === next)
  if (next === null || index < 0) {
    selection[tab] = null
    return
  }
  open(tab, next, index)
  // After the press's own draw, which draws the row open.
  later(revealSelected, 0)
}

/** Copies a press's text. The row's result already reads "✓ Copied", so only a failure says more. */
async function copy(rowId: string, c: { text: string; name: string }, isLatest: () => boolean) {
  try {
    await navigator.clipboard.writeText(c.text)
  } catch {
    if (!isLatest()) return
    // The tab's frame may not get the clipboard, so the text shows for a manual copy.
    errors.set(rowId, `Could not copy ${c.name}: this tab has no clipboard access`)
    copies.set(rowId, c)
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

function sendReply(id: string, text: string) {
  const draft = drafts.get(id)
  void act(id, { action: 'type', id, text }, () => {
    if (drafts.get(id) === draft) drafts.delete(id)
  })
}

function startTyping(id: string) {
  keepPressedOpen(id)
  typing = id
  focusTyping = true
  draw()
}

/** A row's keys, in the order `rowKeyPlan` sets, as the tab's buttons. */
function rowKeys(r: RowView): { keys: Key[]; more: Key[] } {
  const actions = ledgerActions(r, optionsShown.has(r.id), {
    press: p => {
      const step = p.action === 'step' ? r.steps[p.step] : undefined
      const action = r.actions.find(a => a.press.action === 'step' && p.action === 'step' && a.press.step === p.step)
      const pending =
        action?.kind === 'local' && r.item && step
          ? feedbackText({ is: 'local', result: pendingResult(stepEffects(r.item, step), Date.now()) }, 'codex')
          : undefined
      void act(r.id, p, undefined, pending)
    },
    reply: () => startTyping(r.id),
    showOptions: () => {
      optionsShown.add(r.id)
      draw()
    },
  })
  return actions
}

function itemRow(v: View, r: RowView): Row {
  const mark = rowMark(r, 'codex')
  const isHandedOff = r.state.is === 'handedOff'
  const id = r.id

  return {
    id,
    view: r,
    // Only a handed-off item has a mark. Its options answer a question, and the group header says the kind.
    handle: mark.text,
    handleTone: mark.tone,
    ...(isHandedOff ? { fold: {} } : {}),
    title: r.title,
    age: r.at === null ? undefined : shortAgo(v.at - r.at),
    ...rowKeys(r),
    typing: {
      hint: replyHint(r, 'Codex'),
      send: text => sendReply(id, text),
    },
    feedback: r.feedback,
  }
}

function findingRow(v: View, r: RowView, f: Finding): Row {
  // A finding's group title says its kind. Handed to Codex, it folds, as a task does, until Codex's reply leaves it open.
  const isHandedOff = r.state.is === 'handedOff'
  const id = r.id
  const mark = rowMark(r, 'codex')

  return {
    id,
    view: r,
    handle: mark.text,
    handleTone: mark.tone,
    kind: f.kind,
    ...(isHandedOff ? { fold: {} } : {}),
    title: r.title,
    age: r.at === null ? undefined : shortAgo(v.at - r.at),
    body: (
      <div>
        <p style={{ whiteSpace: 'pre-line' }}>{inlineHtml(r.detail ?? '')}</p>
        {f.path ? (
          <p>
            <span class="muted">{ROW_COPY.relevantFile}</span>
            <code title={f.path}>{r.fileName}</code>
          </p>
        ) : null}
      </div>
    ),
    ...rowKeys(r),
    typing: {
      hint: replyHint(r, 'Codex'),
      send: text => sendReply(id, text),
    },
    feedback: r.feedback,
  }
}

// ── PRs ─────────────────────────────────────────────────────────────────────

/** A PR plan's button as the tab's key. `pending` is what an open's row reads while it is out. */
function prKey(rowId: string, a: PrAction, pending?: string): Key {
  return {
    ...(a.hotkey ? { hotkey: a.hotkey } : {}),
    label: a.label,
    emphasis: a.emphasis,
    ...(a.icon ? { icon: a.icon } : {}),
    ...(a.press.action === 'pr-dismiss' ? { isDismiss: true } : {}),
    run: () => void act(rowId, a.press, undefined, a.kind === 'local' ? pending : undefined),
  }
}

/** What a row reads while an open of `name` is out. */
function opening(name: string): string {
  const result = pendingResult([{ kind: 'open', target: '', name }], Date.now())

  return feedbackText({ is: 'local', result }, 'codex')
}

function prThreadRow(v: View, pr: PrView, t: PrThread): Row {
  const id = prThreadId(pr, t)
  const isSent = threadSentIn(v.lastActions)(pr, t)
  const showsCheck = threadShowsCheckIn(v.lastActions)(pr, t)
  const isChanged = !isSent && t.isLinesChanged
  const press =
    (action: 'thread-address' | 'thread-draft' | 'thread-discuss' | 'thread-open', pending?: string) => () =>
      void act(id, { action, ref: pr.ref, thread: t.id }, undefined, pending)
  const where = threadWhere(t)
  const { head, rest } = commentParts(t.body)

  return {
    id,
    handle: showsCheck ? '✓' : '◦',
    handleTone: showsCheck ? 'done' : undefined,
    ...(isSent || isChanged
      ? { fold: t.isLinesChanged ? { note: `Lines changed since this comment${DOT}still open on GitHub` } : {} }
      : {}),
    // The first comment, which asks for the change, is the title open or closed; the line under it says where it
    // sits and who asked, or the latest reply.
    title: clipLabel(head, THREAD_TITLE_CHARS),
    meta: [
      threadWhere(t, baseName(t.path)),
      isChanged ? 'Lines changed' : '',
      t.reply ? `@${t.reply.author}: ${commentLine(t.reply.body)}` : `@${t.author}`,
    ]
      .filter(Boolean)
      .join(DOT),
    age: t.at === null ? undefined : shortAgo(v.at - t.at),
    body: (
      <div>
        {rest ? <p class="quote">{inlineHtml(clipLabel(rest, 1200))}</p> : null}
        <p class="muted">
          <button type="button" class="link" onClick={press('thread-open', opening('the comment'))}>
            {where}
          </button>
          {`${DOT}@${t.author}`}
        </p>
        {t.reply ? (
          <p class="quote">
            <b>@{t.reply.author}:</b> {inlineHtml(clipLabel(readableComment(t.reply.body), 1200))}
          </p>
        ) : null}
      </div>
    ),
    keys: threadActions(pr, t, v.lastActions).flatMap(a =>
      a.isFollowUp ? [] : [prKey(id, a, opening('the comment'))],
    ),
    more: threadActions(pr, t, v.lastActions).flatMap(a => (a.isFollowUp ? [prKey(id, a)] : [])),
    feedback: feedbackOf(id, v.lastActions[id], undefined, v.turns, v.at),
  }
}

function prCheckRow(v: View, pr: PrView, c: PrCheck): Row {
  const id = prCheckId(pr, c)
  const ran =
    c.startedAt !== undefined && c.finishedAt !== undefined
      ? `Failed after ${took(c.finishedAt - c.startedAt)}`
      : 'Failed'
  const target = c.url ? 'the log' : `PR #${pr.number}`

  return {
    id,
    handle: '✗',
    handleTone: 'error',
    ...(c.workflow ? { lead: `${c.workflow} /` } : {}),
    title: c.name,
    meta: ran,
    age: c.finishedAt === undefined ? undefined : shortAgo(v.at - c.finishedAt),
    body: <div class="muted">{ran}</div>,
    keys: checkActions(pr, c, v.lastActions).map(a => prKey(id, a, opening(target))),
    more: [],
    feedback: feedbackOf(id, v.lastActions[id], undefined, v.turns, v.at),
  }
}

/** When the tab drew a dismissed PR's block first, from its Dismiss's age in the view. */
function prSettledStart(v: View, pr: PrView): number {
  return readAt - (v.at - (v.lastActions[prMarkId(pr.ref)]?.at ?? v.at))
}

type PrBlockPlan = { pr: PrView; isSettled: boolean; threads: Row[]; checks: Row[] }

/** The PRs as the tab draws them: each block in order. */
function prPlan(v: View): { blocks: PrBlockPlan[]; rows: Row[] } {
  const blocks: PrBlockPlan[] = []
  for (const { pr, isSettled } of v.prs.drawn) {
    if (isSettled) {
      const id = prMarkId(pr.ref)
      if (undoing.has(id) || Date.now() - prSettledStart(v, pr) < SETTLED_MS)
        blocks.push({ pr, isSettled, threads: [], checks: [] })
    } else
      blocks.push({
        pr,
        isSettled,
        threads: waitingThreads(pr).map(t => prThreadRow(v, pr, t)),
        checks: failingChecks(pr).map(c => prCheckRow(v, pr, c)),
      })
  }

  return { blocks, rows: blocks.flatMap(b => [...b.threads, ...b.checks]) }
}

/** The PR rows the keys and clicks move through: each block's threads, then its checks. */
function prRows(v: View): Row[] {
  return prPlan(v).rows
}

/** The rows of a tab, in the order the keys move through them. */
function tabRows(v: View, t: ShownTab): Row[] {
  return t === 'prs' ? prRows(v) : listsOf(v, shownSettled()).byTab[t]
}

type Lists = DrawnLists<Row>

/** The view's lists as the tab draws them. A settled row shows while `drawn` has it, and is left out after. */
function listsOf(v: View, drawn: ReadonlySet<string>): Lists {
  return drawnLists(
    v,
    id => drawn.has(id),
    r => (r.item ? itemRow(v, r) : r.finding ? findingRow(v, r, r.finding) : null),
  )
}

/** The settled rows drawn in place now. */
function shownSettled(): Set<string> {
  return drawnSettled(seen, Date.now(), undoing)
}

const LIST_OF = { question: 'questions', task: 'tasks', finding: 'findings' } as const

/**
 * Moves each row the shown tab draws one step through the machine in rows.ts. Returns the lists to draw, the view's
 * rows with each leaving row in the place it last drew, and the ids of the rows whose state changed. Rows of a tab
 * not shown are forgotten, so they show their form at once when it shows.
 */
function stepLists(v: View): { lists: Lists; changed: Set<string> } {
  const now = Date.now()
  const lists = listsOf(v, shownSettled())
  const rows = tab === 'prs' ? [] : lists.byTab[tab]
  const openId = rows[selectedIndex(rows, tab, v)]?.id
  const changed = new Set<string>()
  const kept = new Set<string>()
  for (const group of (Object.keys(LIST_OF) as Group[]).filter(g => TAB_OF[g] === tab)) {
    const listed = lists[LIST_OF[group]]
    const listedIds = new Set(listed.map(entryId))
    const entries = [...listed]
    // A row the last draw drew that the view no longer lists here leaves from the place it drew.
    for (const [n, last] of (lastLists?.[LIST_OF[group]] ?? []).entries()) {
      const id = entryId(last)
      if (!listedIds.has(id) && drawnRows.has(id)) entries.splice(Math.min(n, entries.length), 0, last)
    }
    const drawn: Entry[] = []
    for (const x of entries) {
      const id = entryId(x)
      const before = drawnRows.get(id)
      const target: RowTarget = !listedIds.has(id)
        ? 'gone'
        : 'settled' in x
          ? undoing.has(id)
            ? 'undoing'
            : 'settled'
          : id === openId
            ? 'open'
            : 'closed'
      const track = stepRow(before?.track, target, now, entering.has(id), reducedMotion.matches)
      if (!track) continue
      if (track !== before?.track) changed.add(id)
      // A row keeps the panel it last drew open until its track stops drawing it.
      const openRow = !track.hasPanel ? undefined : 'row' in x && listedIds.has(id) ? x.row : before?.openRow
      drawnRows.set(id, { track, openRow })
      kept.add(id)
      drawn.push(x)
    }
    lists[LIST_OF[group]] = drawn
  }
  // The Findings tab draws a group per kind, so each takes its entries from the stepped list, leaving rows included.
  lists.findingGroups = lists.findingGroups.map(g => ({
    ...g,
    entries: lists.findings.filter(x => ('row' in x ? x.row.kind : x.settled.finding?.kind) === g.kind),
  }))
  for (const id of [...drawnRows.keys()]) if (!kept.has(id)) drawnRows.delete(id)
  return { lists, changed }
}

/** Undo on a settled row: the row comes back open and selected, which shows the Undo worked. */
async function undo(r: RowView) {
  if (undoing.has(r.id)) return
  const t = TAB_OF[r.type]
  undoing.add(r.id)
  try {
    await act(r.id, { action: 'undo', id: r.id }, () => open(t, r.id))
  } finally {
    undoing.delete(r.id)
    const at = seen.get(r.id)
    const isTimeLeft = at !== undefined && Date.now() - at < SETTLED_MS
    // A failure shows on the row while it has time left. Otherwise the row leaves, so the error shows under the tabs.
    const error = errors.get(r.id)
    if (error && !isTimeLeft) {
      lineNote = { text: error, at: Date.now(), isError: true }
      drawIn(SETTLED_MS)
    }
    // A row held past its time leaves the way any row does, with its exit.
    if (at !== undefined && !isTimeLeft) seen.set(r.id, Date.now() - SETTLED_MS)
    draw()
  }
}

/**
 * The open row's index, or -1 when none is open. A tab with no open row chosen draws its first waiting row open.
 */
function selectedIndex(rows: Row[], t: ShownTab, v: View): number {
  const s = selection[t]
  if (s) {
    const at = rows.findIndex(r => r.id === s.id)
    // While the open row still draws, as one just closed or leaving, none is open. Once it is gone, the row now in
    // its place opens, guarded as a click would open it.
    if (at >= 0 || drawnRows.has(s.id) || rows.length === 0) return at
    const index = Math.min(s.index ?? 0, rows.length - 1)
    open(t, rows[index]!.id, index)
    return index
  }
  const id = firstWaiting(tabWaits(v, t))

  return id ? rows.findIndex(r => r.id === id) : -1
}

/** Opens a row. Its buttons ignore clicks for PRESS_GUARD_MS, and draw again once that ends. */
function open(t: ShownTab, id: string, index?: number) {
  selection[t] = { id, openedAt: Date.now(), ...(index === undefined ? {} : { index }) }
  drawIn(PRESS_GUARD_MS)
}

function select(t: ShownTab, rows: Row[], index: number) {
  const row = rows[index]
  if (!row) return
  open(t, row.id, index)
  draw()
}

/**
 * Keeps a row open once it is pressed while the tab draws it open by default,
 * so the default does not open another row when this one leaves. A row open by
 * default was not opened by a click, so it is not guarded.
 */
function keepPressedOpen(id: string) {
  if (!selection[tab]) selection[tab] = { id, openedAt: 0 }
}

/** Whether the shown tab's open row opened too recently for a click on its buttons to count. */
function isOpenGuarded(): boolean {
  return isGuarded(selection[tab]?.openedAt ?? 0, Date.now())
}

/** The selected row's keys. */
function rowActions(row: Row): { keys: Key[]; more: Key[] } {
  if (row.typing && typing === row.id) return { keys: [], more: [] }

  return { keys: row.keys, more: row.more }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/**
 * One of the open row's actions. A click right after the row opened does
 * nothing; its key works at once. Keys are an extra, so no key text shows.
 */
function KeyButton({ k }: { k: Key }) {
  return <ActionButton action={k} isBlocked={() => false} />
}

/** A row's last press, "✓ Explain" or "Queued: Explain". A row whose own mark is a ✓ leaves out the second one. */
function feedbackLabel(row: Row): string | null {
  const f = row.feedback
  if (!f) return null

  return row.view
    ? rowFeedbackText(row.view, 'codex')
    : f.is === 'done' && row.handleTone === 'done'
      ? f.label
      : feedbackText(f, 'codex')
}

/** A row's note while it shows. */
function noteOf(id: string): string | null {
  const n = notes.get(id)

  return n && Date.now() - n.at < SETTLED_MS ? n.text : null
}

/** The row's own note, error or copy box replaces its feedback while it shows. */
function isFeedbackShown(row: Row): boolean {
  return !errors.has(row.id) && noteOf(row.id) === null && !copies.has(row.id)
}

function ListRow({ row, track, onSelect, now }: { row: Row; track: RowTrack; onSelect: () => void; now: number }) {
  // A closing or leaving row keeps its panel, inert, while its height shrinks over it.
  const isClosing = track.hasPanel && (track.state === 'closing' || track.state === 'leaving')
  const isSelected = track.hasPanel && !isClosing
  const handle = <span class={`mark ${row.handleTone ?? ''}`}>{row.handle}</span>

  // A row's last press that reads with an age, as "✓ Explained", takes the age's place: in the side column while the
  // row is closed, so the row keeps its one line, and after the title while it is open, its age in the side column.
  // A note, a failure or a press still out, as "Sending…", reads under the title instead. It is muted unless it
  // failed: a done row's ✓ is already green.
  const pending = sending.get(row.id)
  const f = isFeedbackShown(row) ? row.feedback : null
  const label = pending ?? (f ? feedbackLabel(row) : null)
  const ageAt = !pending && f && hasAge(f) ? f.at : null
  const isInSide = ageAt !== null && !isSelected && !isClosing && f?.is !== 'queued' && f?.is !== 'unconfirmed'
  const last = isInSide ? null : label
  const side = ageAt !== null ? shortAgo(now - ageAt) : last ? null : row.age
  const afterTone = !pending && isFailure(row.feedback) ? 'error' : undefined

  // The same elements draw the row open and closed, so its line stays put and only the panel under it comes and goes.
  // Closed, the whole row takes the click; the button keeps it in the focus order, and its click reaches the row.
  return (
    <div
      class={`row ${isSelected ? 'selected' : 'collapsed'}${isClosing ? ' closing' : ''}`}
      onClick={isSelected ? undefined : onSelect}
    >
      {handle}
      <div class="content">
        {/* Open, the line does nothing, so it leaves the focus order. */}
        <button
          type="button"
          class="line"
          {...(isSelected ? { tabIndex: -1, 'aria-disabled': true } : { 'aria-expanded': false })}
        >
          <span class="text">
            {row.lead ? (
              <>
                <span class="lead">{row.lead}</span>{' '}
              </>
            ) : null}
            {row.title}
          </span>
          {row.meta ? <span class="meta">{row.meta}</span> : null}
          {last ? (
            <span class={`after ${afterTone ? `tone-${afterTone}` : ''}`}>
              {isSelected || isClosing ? `${DOT}${last}` : last}
            </span>
          ) : null}
        </button>
        {isSelected || isClosing ? <Panel row={row} isClosing={isClosing} /> : null}
      </div>
      <span class="side">
        {isInSide ? <span class="side-label">{label}</span> : null}
        {side}
      </span>
    </div>
  )
}

/** An open row's details under its line: its kind, body, notes, actions and copy box. */
function Panel({ row, isClosing }: { row: Row; isClosing: boolean }) {
  const { keys, more } = rowActions(row)
  const copied = copies.get(row.id)
  const note = noteOf(row.id)
  const isTyping = !!row.typing && typing === row.id
  const notes = [
    row.fold?.note ? <div class="muted">{row.fold.note}</div> : null,
    note ? <div class="muted">{note}</div> : null,
    errors.has(row.id) ? <div class="tone-error">{errors.get(row.id)}</div> : null,
  ].filter(Boolean)

  return (
    <div class={isClosing ? 'panel closing' : 'panel'} inert={isClosing}>
      {row.body ? <div class="body">{row.body}</div> : null}
      {notes.length > 0 ? <div>{notes}</div> : null}
      <RowActions
        actions={[...keys, ...more]}
        reply={
          isTyping
            ? {
                id: row.id,
                hint: row.typing!.hint,
                draft: () => drafts.get(row.id)?.text ?? '',
                onDraft: text => drafts.set(row.id, { text }),
                send: text => {
                  typing = null
                  row.typing!.send(text)
                },
                cancel: () => {
                  typing = null
                  draw()
                },
              }
            : null
        }
        isBlocked={isOpenGuarded}
      />
      {copied ? (
        <div>
          <div class="muted">Copy {copied.name} from here:</div>
          <textarea rows={3} readOnly value={copied.text} onFocus={e => e.currentTarget.select()} />
          <button
            type="button"
            class="key"
            onClick={() => {
              copies.delete(row.id)
              draw()
            }}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SettledView({ settled: r, panel }: { settled: RowView; panel: Row | undefined }) {
  const { state } = r
  if (state.is !== 'settled') return null
  const start = seen.get(r.id) ?? Date.now()
  const isUndoing = undoing.has(r.id)
  const error = errors.get(r.id)

  // Laid out as an open row is, so the panel it keeps stays where the open row drew it.
  return (
    <div class={panel ? 'row settled was-open' : 'row settled'}>
      {/* The ✓ waits for an answer's message to reach Codex. */}
      <span class="mark">{state.delivery !== null ? '' : '✓'}</span>
      <div class="content">
        <div class="settled-head">
          <div class="settled-line">
            <span class="what">{r.title}</span>
            <span class="outcome-label">
              {DOT}
              {settledLabel(state.label, state.delivery)}
            </span>
            {error ? (
              <span class="tone-error">
                {DOT}
                {error}
              </span>
            ) : null}
          </div>
          {state.canUndo ? (
            <button
              type="button"
              class={isUndoing ? 'key undo undoing' : 'key undo'}
              disabled={isUndoing}
              onClick={() => void undo(r)}
            >
              {/* The delay is set once, when it is drawn: the animation keeps its own time after that. */}
              <span
                key={start}
                class={isUndoing ? 'time-left paused' : 'time-left'}
                style={{ animationDuration: `${SETTLED_MS}ms` }}
                ref={el => {
                  if (el && !el.style.animationDelay) el.style.animationDelay = `-${Math.max(0, Date.now() - start)}ms`
                }}
              />
              <Icon name="undo" />
              Undo
            </button>
          ) : null}
        </div>
        {panel ? <Panel row={panel} isClosing /> : null}
      </div>
    </div>
  )
}

/** A list's rows, with the rows that just closed and the rows leaving in their places. */
function Entries({ entries, group, all, now }: { entries: Entry[]; group: Group; all: Row[]; now: number }) {
  const t = TAB_OF[group]
  if (entries.length === 0) return null

  // One element per row, keyed by its id in every state, so its height can move between them.
  return (
    <div class="list">
      {entries.map(x => {
        const id = entryId(x)
        // stepLists tracked every entry it returned.
        const drawn = drawnRows.get(id)!

        return (
          <div class="entry" key={id} data-motion={id}>
            {'row' in x ? (
              <ListRow row={x.row} track={drawn.track} now={now} onSelect={() => select(t, all, all.indexOf(x.row))} />
            ) : (
              // A row that settled while open keeps the panel it last drew while its height shrinks over it.
              <SettledView settled={x.settled} panel={drawn.openRow} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function GroupTitle({ title, count }: { title: string; count: number }) {
  return (
    <div class="group-title">
      <b>{title}</b>
      {count > 0 ? (
        <span class="count">
          {DOT}
          {count}
        </span>
      ) : null}
    </div>
  )
}

/** A group's closed items as its fold lists them: without the rows drawn settled, up to CLOSED_SHOWN. */
function itemsClosed(v: View, kind: 'question' | 'task', entries: Entry[]): ClosedLine[] {
  return closedShown(v.needsYou.closed[kind === 'question' ? 'questions' : 'tasks'], settledIn(entries)).map(d => ({
    id: d.id,
    ask: d.ask,
    outcome: d.outcome,
    state: closedState(d),
    at: d.at,
    delivery: d.delivery,
  }))
}

function ItemGroup({
  v,
  kind,
  entries,
  all,
  now,
}: {
  v: View
  kind: 'question' | 'task'
  entries: Entry[]
  all: Row[]
  now: number
}) {
  const title = kind === 'question' ? 'Questions' : 'Tasks'
  const rest = staying(entries)
  const closed = itemsClosed(v, kind, rest)
  const rows = rest.flatMap(x => ('row' in x ? [x.row] : []))

  return (
    <section>
      {/* A row handed to Codex stays listed but leaves the count. */}
      <GroupTitle title={title} count={rows.filter(r => !r.fold).length} />
      <Entries entries={entries} group={kind} all={all} now={now} />
      <GroupEnd
        group={kind}
        empty={groupEmpty(title, rest)}
        closed={closed}
        total={closedTotal(v.needsYou.closed[kind === 'question' ? 'questions' : 'tasks'], settledIn(rest))}
        now={now}
      />
    </section>
  )
}

/** A list's entries without the rows leaving it, which no longer count: its empty line and Closed fold stand in for them. */
function staying(entries: Entry[]): Entry[] {
  return entries.filter(x => drawnRows.get(entryId(x))?.track.state !== 'leaving')
}

/** A group's empty line, and whether it is leaving. */
type GroupEmpty = { text: string; isLeaving: boolean }

/**
 * A group's empty line, drawn while no row stays. While the rows that stay are all entering, as when rows arrive in an
 * empty group, the line stays drawn, leaving, so it fades out as they grow in over its place.
 */
function groupEmpty(title: string, rest: Entry[]): GroupEmpty | null {
  const isArriving = rest.every(x => drawnRows.get(entryId(x))?.track.state === 'entering')

  return rest.length === 0 || isArriving ? { text: groupEmptyText(title), isLeaving: rest.length > 0 } : null
}

/** A closed item or finding as a Closed fold lists it. */
type ClosedLine = {
  id: string
  ask: string
  outcome: string
  state: ClosedState
  at: number
  delivery: Parameters<typeof settledLabel>[1]
}

/** Text an agent wrote, with its inline markdown as elements. Preact escapes each span's text, so no HTML gets through. */
function inlineHtml(text: string) {
  return parseInline(text).map(s => {
    let node: ComponentChildren = s.code ? <code>{s.text}</code> : s.text
    if (s.italic) node = <i>{node}</i>
    if (s.bold) node = <b>{node}</b>
    if (s.strike) node = <s>{node}</s>
    // As in the Claude panes: the label, then its URL.
    return s.link ? (
      <>
        <u>{node}</u>
        <span class="muted"> {s.link}</span>
      </>
    ) : (
      node
    )
  })
}

/**
 * What a group draws after its rows: its empty line while no row stays, and its Closed fold. One element holds both,
 * so when a group's last row leaves, they grow in while the row collapses above them, and the rows below move once.
 */
function GroupEnd({
  group,
  empty,
  closed,
  total,
  now,
}: {
  group: FoldGroup
  /** The group's empty line, or null while a row stays. */
  empty: GroupEmpty | null
  closed: ClosedLine[]
  /** Every close the fold keeps, which its label counts. `closed` lists the newest few. */
  total: number
  now: number
}) {
  const earlier = earlierLabel(total, closed.length)
  const isUnfolded = unfolded.has(group)
  const isListed = total > 0 && (isUnfolded || closingFolds.has(group))

  return (
    <>
      <div class="group-end" data-motion={`end-${group}`}>
        <div class="group-end-content">
          {empty ? (
            <div class={empty.isLeaving ? 'group-empty leaving' : 'group-empty'} aria-hidden={empty.isLeaving}>
              {empty.text}
            </div>
          ) : null}
          {total > 0 ? (
            <button type="button" class="fold" data-fold={group} onClick={() => toggleFold(group)}>
              <Icon name={isUnfolded ? 'down' : 'right'} />
              {foldLabel(total)}
            </button>
          ) : null}
        </div>
      </div>
      {isListed ? (
        <div class="list closed-list" data-motion={`closed-${group}`}>
          {closed.map(d => (
            <div class="entry" key={`closed-${d.id}`}>
              <div class="row">
                <span class="mark">{d.delivery === null ? CLOSED_MARKS[d.state] : ''}</span>
                <div class="content tight">
                  <div class="muted">{d.ask}</div>
                  <div class="outcome">{settledLabel(capitalized(d.outcome), d.delivery)}</div>
                  {d.delivery && typeof d.delivery === 'object' && d.delivery.canUndo ? (
                    <button
                      type="button"
                      disabled={sending.has(d.id)}
                      onClick={() => act(d.id, { id: d.id, action: 'undo' })}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
                <span class="side">{shortAgo(now - d.at)}</span>
              </div>
            </div>
          ))}
          {earlier ? <div class="earlier muted">{earlier}</div> : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * What Needs you reads above its rows, or in place of its empty text, when the
 * session's hooks have not all run, so the list does not read as complete. Null when they have.
 */
function notHeardText(v: View): [string, string] | null {
  if (v.heard === 'heard') return null

  return [
    'The inbox has not heard from this chat’s hooks.',
    v.heard === 'none'
      ? 'Codex runs a plugin’s hooks only after you trust them.'
      : 'Items from Codex’s replies are missing.',
  ]
}

function NeedsYou({ v, lists, now }: { v: View; lists: Lists; now: number }) {
  const all = lists.byTab.needsYou
  const isNothing = lists.questions.length === 0 && lists.tasks.length === 0
  const hasClosed =
    itemsClosed(v, 'question', lists.questions).length > 0 || itemsClosed(v, 'task', lists.tasks).length > 0
  const notHeard = notHeardText(v)
  if (isNothing && !hasClosed)
    return notHeard ? (
      <div class="empty">
        <div class="title">{notHeard[0]}</div>
        <div class="muted">{notHeard[1]}</div>
      </div>
    ) : (
      <div class="empty">
        <div class="title">{emptyText('needsYou', 'Codex').title}</div>
        <div class="muted">{emptyText('needsYou', 'Codex').hint}</div>
      </div>
    )

  // A tab that has had items keeps both groups, each with its empty line while it has nothing open.
  return (
    <main>
      {notHeard ? (
        <section>
          <div class="group-title">
            {notHeard[0]}
            <div class="muted">{notHeard[1]}</div>
          </div>
        </section>
      ) : null}
      <ItemGroup v={v} kind="question" entries={lists.questions} all={all} now={now} />
      <ItemGroup v={v} kind="task" entries={lists.tasks} all={all} now={now} />
    </main>
  )
}

function Findings({ v, lists, now }: { v: View; lists: Lists; now: number }) {
  // A finding stays listed until Codex closes it or the person dismisses it. Then it settles and moves to Closed.
  const settled = settledIn(staying(lists.findings))
  const closedOf = (kind: Finding['kind']) => v.findings.closed.filter(f => f.kind === kind)
  const shown = (kind: Finding['kind']) =>
    closedShown(closedOf(kind), settled).map(f => ({
      id: f.id,
      ask: f.title,
      outcome: f.outcome,
      state: closedState(f),
      at: f.closedAt,
      delivery: f.delivery,
    }))
  const isNothing = lists.findings.length === 0
  if (isNothing && closedTotal(v.findings.closed, settled) === 0)
    return (
      <div class="empty">
        <div class="title">{emptyText('findings', 'Codex').title}</div>
        <div class="muted">{emptyText('findings', 'Codex').hint}</div>
      </div>
    )

  // Each kind keeps its own Closed fold, as each Needs you group does.
  return (
    <main>
      {lists.findingGroups.map(g => {
        // A row handed to Codex stays listed but leaves the count.
        const rest = staying(g.entries)
        const rows = rest.flatMap(x => ('row' in x ? [x.row] : []))
        return (
          <section>
            <GroupTitle title={g.title} count={rows.filter(r => !r.fold).length} />
            <Entries entries={g.entries} group="finding" all={lists.byTab.findings} now={now} />
            <GroupEnd
              group={g.kind}
              empty={groupEmpty(g.title, rest)}
              closed={shown(g.kind)}
              total={closedTotal(closedOf(g.kind), settled)}
              now={now}
            />
          </section>
        )
      })}
    </main>
  )
}

/** A dismissed PR's block: its title and Undo, in the place of its block until its time is up. */
function SettledPr({ v, pr }: { v: View; pr: PrView }) {
  const id = prMarkId(pr.ref)
  const start = prSettledStart(v, pr)
  const isUndoing = undoing.has(id)
  const error = errors.get(id)

  return (
    <div class="row settled">
      <span class="mark">✓</span>
      <div class="content">
        <div class="settled-head">
          <div class="settled-line">
            <span class="what">
              <span class="tone-prs">#{pr.number}</span> {pr.title}
            </span>
            <span class="outcome-label">{`${DOT}Dismissed`}</span>
            {error ? <span class="tone-error">{`${DOT}${error}`}</span> : null}
          </div>
          <button
            type="button"
            class={isUndoing ? 'key undo undoing' : 'key undo'}
            disabled={isUndoing}
            onClick={() => void undoPr(id, pr.ref)}
          >
            <span
              key={start}
              class={isUndoing ? 'time-left paused' : 'time-left'}
              style={{ animationDuration: `${SETTLED_MS}ms` }}
              ref={el => {
                if (el && !el.style.animationDelay) el.style.animationDelay = `-${Math.max(0, Date.now() - start)}ms`
              }}
            />
            <Icon name="undo" />
            Undo
          </button>
        </div>
      </div>
    </div>
  )
}

/** Undo on a dismissed PR's block: the PR is tracked again and its block comes back. */
async function undoPr(id: string, ref: string) {
  if (undoing.has(id)) return
  undoing.add(id)
  try {
    await act(id, { action: 'pr-undo', ref })
  } finally {
    undoing.delete(id)
    draw()
  }
}

/** The line under a PR block's buttons: a press still out, its error or note, or its last action. */
function prLastLine(v: View, id: string): { text: string; isError: boolean } | null {
  const pending = sending.get(id)
  if (pending) return { text: pending, isError: false }
  const error = errors.get(id)
  if (error) return { text: error, isError: true }
  const note = noteOf(id)
  if (note) return { text: note, isError: false }
  // A Dismiss left on a PR that is tracked again, as one a later reply links, is over.
  const f =
    v.lastActions[id]?.action === 'pr-dismiss' ? null : feedbackOf(id, v.lastActions[id], undefined, v.turns, v.at)
  if (!f) return null
  const text = feedbackText(f, 'codex')

  return { text: hasAge(f) ? `${text}${DOT}${ago(v.at - f.at)}` : text, isError: isFailure(f) }
}

function PrBlock({
  v,
  pr,
  threads,
  checks,
  openId,
  all,
  now,
}: PrBlockPlan & { v: View; openId: string | undefined; all: Row[]; now: number }) {
  const isSent = threadSentIn(v.lastActions)
  const { status, head, unlisted } = readiness(pr, isSent)
  const tone = PR_TONES[status]
  const id = prMarkId(pr.ref)
  const keys = prBlockActions(pr, isSent, v.prs.branchRef, v.lastActions).map(a =>
    prKey(id, a, opening(`PR #${pr.number}`)),
  )
  const last = prLastLine(v, id)

  return (
    <section>
      <div class="pr-head">
        <span class="tone-prs num">#{pr.number}</span> {pr.title}{' '}
        <span class={tone ? `pr-verdict tone-${tone}` : 'pr-verdict muted'}>{head}</span>
        <span class="pr-verdict muted">{unlisted.map(r => `${DOT}${r}`).join('')}</span>
      </div>
      {pr.error ? <div class="pr-status tone-error">Last refresh failed: {pr.error}</div> : null}
      <div class="pr-actions keys">
        {keys.map(k => (
          <KeyButton k={k} />
        ))}
      </div>
      {last ? <div class={last.isError ? 'pr-last tone-error' : 'pr-last muted'}>{last.text}</div> : null}
      <div class="pr-groups">
        <PrRows title="Review threads" rows={threads} all={all} openId={openId} now={now} />
        <PrRows title="Failing checks" rows={checks} all={all} openId={openId} now={now} />
      </div>
    </section>
  )
}

/** A group of a PR's threads or checks, under a title that says their kind once. */
function PrRows({
  title,
  rows,
  all,
  openId,
  now,
}: {
  title: string
  rows: Row[]
  all: Row[]
  openId: string | undefined
  now: number
}) {
  if (rows.length === 0) return null

  return (
    <>
      <GroupTitle title={title} count={rows.length} />
      <div class="list">
        {rows.map(row => {
          const isOpen = row.id === openId
          const track: RowTrack = { state: isOpen ? 'open' : 'closed', since: 0, hasPanel: isOpen }

          return (
            <div class="entry" key={row.id}>
              <ListRow row={row} track={track} now={now} onSelect={() => select('prs', all, all.indexOf(row))} />
            </div>
          )
        })}
      </div>
    </>
  )
}

const PRS_HINT = 'Your PRs show here when this conversation opens or links one, or when your branch has one.'

function Prs({ v, now }: { v: View; now: number }) {
  const { blocks, rows } = prPlan(v)
  if (blocks.length === 0)
    return (
      <div class="empty">
        <div class="title">{v.isFetchingPrs ? 'Checking for PRs…' : 'No PRs'}</div>
        <div class="muted">{v.isGhMissing ? GH_MISSING : PRS_HINT}</div>
      </div>
    )
  const openId = rows[selectedIndex(rows, 'prs', v)]?.id

  return (
    <main>
      {v.isGhMissing ? (
        <section>
          <div class="group-title muted">{GH_MISSING}</div>
        </section>
      ) : null}
      {blocks.map(b =>
        b.isSettled ? (
          <section>
            <SettledPr v={v} pr={b.pr} />
          </section>
        ) : (
          <PrBlock {...b} v={v} openId={openId} all={rows} now={now} />
        ),
      )}
      {v.prs.olderText ? (
        <section>
          <div class="group-title muted">{v.prs.olderText}</div>
        </section>
      ) : null}
    </main>
  )
}

const GH_MISSING = 'The inbox could not find gh, so it cannot read your PRs.'

/** How long polls may fail before "retrying" turns red. */
const LATE_READ_MS = 60_000

/** At the footer's right: Updating… while the per-turn update runs, or, while polls fail, when the view shown was read. */
function Status({ v }: { v: View }) {
  const sinceRead = Date.now() - readAt
  const status =
    pollFailures >= 2 ? (
      <span class={sinceRead > LATE_READ_MS ? 'tone-error' : undefined}>
        Last read {ago(sinceRead)}
        {DOT}retrying
      </span>
    ) : v.status.isUpdating ? (
      'Updating…'
    ) : null

  return <div class="status">{status}</div>
}

/** The tabs. A read error or a note takes its own line under them. */
function TabBar({ v }: { v: View }) {
  const counts: Record<ShownTab, number> = { needsYou: v.needsYou.count, findings: v.findings.count, prs: v.prs.count }
  const { error } = v.status

  return (
    <nav>
      <div class="tabs">
        {TABS.map(t => (
          <button
            type="button"
            class={`tab ${tab === t.id ? 'shown' : ''}`}
            onClick={() => {
              tab = t.id
              draw()
            }}
          >
            {t.label}
            {counts[t.id] > 0 ? <span class={`count tone-${t.id}`}>{counts[t.id]}</span> : null}
          </button>
        ))}
      </div>
      {serverNote ? (
        serverNote.isReloadable ? (
          <ErrorStrip text={serverNote.text} reload={() => location.reload()} />
        ) : (
          <div class="status-line tone-error">{serverNote.text}</div>
        )
      ) : null}
      {updateError ? (
        <ErrorStrip
          text={updateError.text}
          label="Retry"
          reload={() => {
            const page = updateError?.page
            updateError = null
            draw()
            if (page) void swapPage(page)
          }}
        />
      ) : null}
      {error ? <div class="status-line tone-error">{error}</div> : null}
      {lineNote && Date.now() - lineNote.at < SETTLED_MS ? (
        <div class={lineNote.isError ? 'status-line tone-error' : 'status-line muted'}>{lineNote.text}</div>
      ) : null}
    </nav>
  )
}

/** Switches between the conversation's inbox and the demo. The new view starts fresh, so no row reads as just closed or new. */
async function toggleDemo() {
  viewGeneration++
  isDemo = !isDemo
  readError = null
  pollFailures = 0
  view = null
  seen = new Map()
  rowsSeen = {}
  // The other view's rows are not this one's: none of them leaves or settles in it.
  drawnRows.clear()
  lastLists = null
  selection.needsYou = null
  selection.findings = null
  selection.prs = null
  typing = null
  draw()
  await read()
}

/** An error with a Reload button, which runs `reload`. */
function ErrorStrip({ text, reload, label = 'Reload' }: { text: string; reload: () => void; label?: string }) {
  return (
    <div class="error-strip">
      <span>{text}</span>
      <button type="button" class="key" onClick={reload}>
        {label}
      </button>
    </div>
  )
}

function App({ lists }: { lists: Lists | null }): ComponentChildren {
  if (!view || !lists)
    return readError !== null ? (
      <ErrorStrip
        text={`Could not read the inbox. ${readError}`}
        reload={() => void (isConnected ? read() : initialize())}
      />
    ) : isLoadingShown ? (
      <div class="notice muted">Loading…</div>
    ) : null
  const v = view
  const now = v.at

  return (
    <>
      {isDemo && !DEMO_RECORDING ? (
        <div class="demo-note">
          <span>{DEMO_NOTICE}</span>
          <button type="button" class="key ghost" onClick={() => void toggleDemo()}>
            Hide demo
          </button>
        </div>
      ) : null}
      <TabBar v={v} />
      {tab === 'needsYou' ? (
        <NeedsYou v={v} lists={lists} now={now} />
      ) : tab === 'findings' ? (
        <Findings v={v} lists={lists} now={now} />
      ) : (
        <Prs v={v} now={now} />
      )}
      <footer>
        {isDemo || !DEMO_BUTTON ? null : (
          <button type="button" class="demo-toggle" onClick={() => void toggleDemo()}>
            Show demo
          </button>
        )}
        <Status v={v} />
      </footer>
    </>
  )
}

// ── Motion ──────────────────────────────────────────────────────────────────

// The Codex app's own curves, from its bundled styles: --cubic-enter, --cubic-move and --cubic-exit. The lengths
// are the row states', so a row comes to rest as its animation ends.
const ENTER: KeyframeAnimationOptions = { duration: ENTER_MS, easing: 'cubic-bezier(.19, 1, .22, 1)' }
const MOVE: KeyframeAnimationOptions = { duration: MOVE_MS, easing: 'cubic-bezier(.65, 0, .35, 1)' }
const EXIT: KeyframeAnimationOptions = { duration: EXIT_MS, easing: 'cubic-bezier(.8, 0, .4, 1)', fill: 'forwards' }
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

type Heights = Map<string, { el: HTMLElement; height: number }>

/** Each moving element's drawn height, by its `data-motion` key, mid-animation included. */
function measure(): Heights {
  const heights: Heights = new Map()
  for (const el of root.querySelectorAll<HTMLElement>('[data-motion]'))
    heights.set(el.dataset.motion!, { el, height: el.getBoundingClientRect().height })

  return heights
}

/**
 * Runs a height animation toward `to`, clipping the element's content until no animation is left on it.
 * `data-to` records the target, so a later draw heading the same way leaves the animation running.
 */
function run(el: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, to: number) {
  el.style.overflow = 'hidden'
  el.dataset.to = String(to)
  const a = el.animate(frames, timing)
  animations.add(a)
  const done = () => {
    animations.delete(a)
    if (isDisposed) return
    if (el.getAnimations().length === 0) unclip(el)
  }
  a.onfinish = done
  a.oncancel = done
}

/** Stops the element's animations and lets it take its content's height again. */
function release(el: HTMLElement) {
  for (const a of el.getAnimations()) a.cancel()
  unclip(el)
}

function unclip(el: HTMLElement) {
  el.style.overflow = ''
  delete el.dataset.to
}

/**
 * A row entry's or a group end's content height, which an animation of its own height does not change, as its scroll
 * height does while the animation holds it taller or shorter than its content. Its children stack with no gaps or
 * padding.
 */
function contentHeight(el: HTMLElement): number {
  return [...el.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0)
}

type Frame = { height: number; opacity: number }

/** Animates the element from one height and opacity to another, then leaves it clipped toward `to.height`. */
function tween(el: HTMLElement, from: Frame, to: Frame, timing: KeyframeAnimationOptions) {
  const keyframe = (f: Frame) => ({ height: `${f.height}px`, opacity: f.opacity })
  run(el, [keyframe(from), keyframe(to)], timing, to.height)
}

/** Grows the element in from nothing to `height`, fading in. */
function growIn(el: HTMLElement, height: number) {
  tween(el, { height: 0, opacity: 0 }, { height, opacity: 1 }, ENTER)
}

/**
 * Animates what a draw changed. A row whose state changed in this draw, as `changed` lists, starts that state's
 * animation: `entering` grows in, `closing` and `settling` shrink over the panel they keep, and `leaving` fades and
 * collapses. Each starts from the height the row is drawn at, mid-animation included. A row that came to rest drops
 * the end height its move held. Any other element whose height changed, as an open row whose note appears, moves.
 */
function animateDraw(before: Heights, changed: ReadonlySet<string>) {
  if (reducedMotion.matches) {
    entering.clear()
    return
  }
  // In the draw that starts a row's exit or entry, the heights of elements that are not rows move on that row's curve.
  // A group's empty line then grows or closes at the rate the row collapses or grows beside it, so the rows below move
  // one way. A row keeps the usual move: the draw that brings it to rest comes when that move ends.
  const started = new Set([...changed].map(key => drawnRows.get(key)?.track.state))
  const besideRow: KeyframeAnimationOptions = started.has('leaving')
    ? { ...EXIT, fill: 'none' }
    : started.has('entering')
      ? ENTER
      : MOVE
  for (const el of root.querySelectorAll<HTMLElement>('[data-motion]')) {
    const key = el.dataset.motion!
    const was = before.get(key)
    // A fold closing runs its own exit.
    if (el.dataset.closing) continue
    const state = drawnRows.get(key)?.track.state
    const isFresh = !was || was.el !== el
    // Mid-animation, a move starts from where the row is drawn now. At rest, from its height before the draw.
    const from = () => (el.getAnimations().length > 0 || isFresh ? el.getBoundingClientRect().height : was.height)
    if (state && changed.has(key) && startState(el, state, from)) continue
    // A closing, settling or leaving row runs its own animation to its end.
    if (state === 'closing' || state === 'settling' || state === 'leaving') continue
    // A group's end clips its content at the top while it moves, which its scroll height leaves out. A Closed list's
    // scroll height is its content's: only its own close shrinks it, which runs apart from this.
    const target = state || el.classList.contains('group-end') ? contentHeight(el) : el.scrollHeight
    if (isFresh) {
      // A Closed list that just unfolded grows in.
      if (!state && entering.delete(key)) growIn(el, target)
      continue
    }
    const anims = el.getAnimations()
    if (anims.length > 0 && Math.abs(Number(el.dataset.to) - target) < 1) continue
    const height = from()
    const opacity = anims.length > 0 ? Number(getComputedStyle(el).opacity) : 1
    for (const a of anims) a.cancel()
    if (Math.abs(height - target) < 1 && opacity > 0.99) continue
    tween(el, { height, opacity }, { height: target, opacity: 1 }, state ? MOVE : besideRow)
  }
  // Rows that arrived on another tab show at once when that tab shows them, not later.
  entering.clear()
}

/**
 * Starts the animation of the state a row just entered, from the height `from` gives. False for `opening`, which
 * grows to fit its panel as any element whose height changed does.
 */
function startState(el: HTMLElement, state: RowState, from: () => number): boolean {
  switch (state) {
    case 'opening':
      return false
    case 'entering':
      // A leaving row listed again drops its exit, which holds it at nothing.
      release(el)
      growIn(el, contentHeight(el))
      return true
    case 'closing':
    case 'settling':
      collapse(el, drawnFrame(el, from))
      return true
    case 'leaving': {
      const frame = drawnFrame(el, from)
      for (const a of el.getAnimations()) a.cancel()
      tween(el, frame, { height: 0, opacity: 0 }, EXIT)
      return true
    }
    default:
      // The move came to rest, and the panel it held its height over is gone: the row takes its content's height.
      release(el)
      return true
  }
}

/** The element's height and opacity as drawn now, mid-animation included, read before its animations are cancelled. */
function drawnFrame(el: HTMLElement, height: () => number): Frame {
  return { height: height(), opacity: Number(getComputedStyle(el).opacity) }
}

/**
 * Shrinks a closing or settling row over the panel it keeps, to the height it has without it, and finishes any fade
 * in it was in. The animation holds that end until the draw that removes the panel cancels it, so the panel never
 * shows again for a frame.
 */
function collapse(el: HTMLElement, from: Frame) {
  const panel = el.querySelector<HTMLElement>('.panel.closing')
  // A closing row keeps its open line until the panel goes, so its end height is measured as it will draw then.
  const row = el.querySelector<HTMLElement>('.row.closing')
  row?.classList.remove('closing')
  if (panel) panel.style.display = 'none'
  const target = contentHeight(el)
  if (panel) panel.style.display = ''
  row?.classList.add('closing')
  for (const a of el.getAnimations()) a.cancel()
  tween(el, from, { height: target, opacity: 1 }, { ...MOVE, fill: 'forwards' })
}

/**
 * Opens or closes a list's Closed fold. Closing takes the group out of `unfolded` at once, so the arrow turns
 * and a second click reopens it, and keeps the list drawn in `closingFolds` while it collapses.
 */
function toggleFold(group: FoldGroup) {
  const el = root.querySelector<HTMLElement>(`[data-motion="closed-${group}"]`)
  if (!unfolded.has(group)) {
    unfolded.add(group)
    if (closingFolds.delete(group) && el) delete el.dataset.closing
    else entering.add(`closed-${group}`)
    draw()
    return
  }
  unfolded.delete(group)
  if (!el || reducedMotion.matches) {
    draw()
    return
  }
  closingFolds.add(group)
  draw()
  el.dataset.closing = '1'
  const height = el.getBoundingClientRect().height
  for (const a of el.getAnimations()) a.cancel()
  tween(el, { height, opacity: 1 }, { height: 0, opacity: 0 }, EXIT)
  later(() => {
    if (unfolded.has(group) || !closingFolds.delete(group)) return
    draw()
  }, EXIT_MS)
}

/** Brings the open row into view, and again once its height has moved, since a row still growing is clipped. */
function revealSelected() {
  if (isDisposed) return
  root.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  if (!reducedMotion.matches)
    later(() => root.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' }), MOVE_MS + 20)
}

function applyPageVariables() {
  document.documentElement.style.setProperty('--row-pad', `${ROW_PAD_PT}px`)
  document.documentElement.style.setProperty('--move', `${MOVE_MS}ms ${MOVE.easing}`)
  document.documentElement.style.setProperty('--enter', `${ENTER_MS}ms ${ENTER.easing}`)
}

// Slack for a timer to land after the state it waits on ends.
const TIMER_SLACK_MS = 50

/** Draws again once `ms` has passed. */
function drawIn(ms: number) {
  later(draw, ms + TIMER_SLACK_MS)
}

// The draw due when the first moving row's move ends.
let moveWake: { at: number; timer: ReturnType<typeof later> } | null = null

/**
 * Draws again when the first moving row's move is due to end, which brings it to rest. Each draw arms it for the
 * next move to end.
 */
function wakeForMoves() {
  const now = Date.now()
  const ends = [...drawnRows.values()].flatMap(({ track: t }) =>
    isMoving(t.state) ? [t.since + ROW_STATE_MS[t.state]] : [],
  )
  if (ends.length === 0) return
  const at = Math.min(...ends) + TIMER_SLACK_MS
  if (moveWake && moveWake.at <= at) return
  if (moveWake) cancelTimer(moveWake.timer)
  moveWake = {
    at,
    timer: later(() => {
      moveWake = null
      draw()
    }, at - now),
  }
}

function draw() {
  if (isDisposed || !isActive) return
  const before = measure()
  const step = view ? stepLists(view) : null
  lastLists = step?.lists ?? null
  wakeForMoves()
  render(<App lists={lastLists} />, root)
  animateDraw(before, step?.changed ?? new Set())
  const fieldToFocus = focusTyping && typing ? document.getElementById(`type-${typing}`) : null
  if (fieldToFocus) {
    focusTyping = false
    fieldToFocus.focus()
  }
}

// ── Keys ────────────────────────────────────────────────────────────────────

// The pane's keys, while the tab has focus. A text field takes its own keys, and
// a held modifier leaves the key to the app.
// A press in a list moves rows under the pointer, so hover fills stay off until the pointer itself moves.
let pressedAt: { x: number; y: number } | null = null
document.addEventListener(
  'pointerdown',
  e => {
    if (!isActive) return
    if (!(e.target instanceof Element) || !root.contains(e.target) || !e.target.closest('.list, .fold')) return
    pressedAt = { x: e.clientX, y: e.clientY }
    document.body.classList.add('still')
  },
  { signal: instanceAbort.signal },
)
document.addEventListener(
  'pointermove',
  e => {
    if (!isActive) return
    if (!pressedAt || Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) < 3) return
    pressedAt = null
    document.body.classList.remove('still')
  },
  { signal: instanceAbort.signal },
)

document.addEventListener(
  'keydown',
  e => {
    if (!isActive) return
    if (e.metaKey || e.ctrlKey || e.altKey || !view) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea')) {
      if (e.key === 'Escape' && target.tagName === 'INPUT') {
        typing = null
        draw()
      }
      return
    }
    const switched = TABS.find(t => t.hotkey === e.key)
    if (switched) {
      tab = switched.id
      draw()
      return
    }
    const rows = tabRows(view, tab)
    const at = selectedIndex(rows, tab, view)
    const move = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0
    if (move !== 0) {
      e.preventDefault()
      select(tab, rows, Math.max(0, Math.min(rows.length - 1, at + move)))
      revealSelected()
      return
    }
    const row = rows[at]
    if (!row) return
    const { keys, more } = rowActions(row)
    const k = [...keys, ...more].find(x => x.hotkey === e.key)
    if (k) {
      e.preventDefault()
      k.run()
    }
  },
  { signal: instanceAbort.signal },
)

function startConnected() {
  if (isDisposed || !isActive || !isConnected || didStart) return
  didStart = true
  applyHost(hostContext)
  applyHost(stagedHostChanges)
  parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*')
  void poll()
}

function initialize(): Promise<boolean> {
  if (isDisposed) return Promise.resolve(false)
  if (isConnected) return Promise.resolve(true)
  if (initializing) return initializing
  readError = null
  if (isActive) draw()
  initializing = request(
    'ui/initialize',
    {
      protocolVersion: '2026-01-26',
      appInfo: { name: 'inbox', version: '0.2.6' },
      appCapabilities: { tools: {} },
    },
    READ_TIMEOUT_MS,
  )
    .then(r => {
      if (isDisposed) return false
      hostContext = (r as { hostContext?: Parameters<typeof applyHost>[0] } | undefined)?.hostContext ?? {}
      isConnected = true
      startConnected()
      return true
    })
    .catch(() => {
      if (isActive && !isDisposed) {
        readError = 'The inbox could not connect to Codex.'
        draw()
      }
      return false
    })
    .finally(() => {
      initializing = null
    })
  return initializing
}

function startPage() {
  startConnected()
  later(() => {
    isLoadingShown = true
    if (!view && readError === null) draw()
  }, LOADING_DELAY_MS)
}

function activatePage(kept: Kept) {
  if (isDisposed || !handoff || handoff.aborted) throw new Error('The new page stopped.')
  restoreState(kept)
  isActive = true
  applyPageVariables()
  draw()
}

if (handoff) handoff.ready({ initialize, activate: activatePage, start: startPage, dispose })
else {
  applyPageVariables()
  restoreState()
  void initialize()
  startPage()
}
