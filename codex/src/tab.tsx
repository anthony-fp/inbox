// The Inbox tab beside a Codex conversation, bundled into tab.html. It polls
// the plugin's server for the view and sends presses back. It owns how the
// Codex look draws a row; row rules come from hooks/view.ts. See docs/looks.md.

import { render } from 'preact'
import type { ComponentChildren, JSX } from 'preact'

import { ago, isLapsed } from '../../hooks/ledger'
import { capitalized, clipLabel, noteText, pendingResult, stepEffects, stepIconKind } from '../../hooks/presses'
import type { HelpStep, RowPress } from '../../hooks/presses'
import {
  allRows,
  closedShown,
  DOT,
  drawnLists,
  emptyText,
  entryId,
  ROW_TABS,
  FINDING_BADGES,
  feedbackText,
  hasAge,
  isFailure,
  isGuarded,
  NEW_ROW_MS,
  PRESS_GUARD_MS,
  rowKeyPlan,
  SETTLED_MS,
  settledIn,
} from '../../hooks/view'
import { ROW_PAD_PT } from '../../hooks/layout'
import type { DrawnEntry, DrawnLists, Feedback, PlannedKey, RowView } from '../../hooks/view'
import type { Finding, Item, RowNote } from '../../types'
import { followTo } from '../../hooks/arrivals'
import { isShownEmpty, newRows, TAB_IDS, TAB_OF } from './arrivals'
import type { Group, SeenRows, Tab } from './arrivals'
import type { TabView as View } from './core'
import type { PressReply } from './server'
import { ENTER_MS, EXIT_MS, isMoving, MOVE_MS, ROW_STATE_MS, stepRow } from './rows'
import type { RowState, RowTarget, RowTrack } from './rows'
import { drawnSettled, POLL_MS, PRESS_TIMEOUT_MS, settledIds, settledSeen } from './settle'

type Tone = 'needsYou' | 'findings' | 'done' | 'error'

/** One of a row's actions, with the key that presses it while the tab has focus, if it has one. */
type Key = { hotkey?: string; label: string; isPrimary?: boolean; icon?: IconName; run: () => void }

/**
 * Outline icons in the style of Codex's own: a 24-unit box drawn at 14 px, stroked in the text color, so they
 * follow hover and the solid button. Each names what a press does; an answer's own words need none.
 */
const ICONS = {
  check: 'M20 6 9 17l-5-5',
  play: 'M7 4.5v15l12-7.5z',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  open: 'M7 17 17 7M8 7h9v9',
  retry: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  right: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
} as const
type IconName = keyof typeof ICONS

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

/** A step's icon: play when it asks Codex to run a command, else copy or open, by its first help. */
function stepIcon(step: HelpStep | undefined): IconName | undefined {
  const kind = stepIconKind(step)

  return kind === 'run' ? 'play' : kind
}

/** A list row. Selected, it shows its title in full, its body and its keys; otherwise one line. */
type Row = {
  id: string
  handle: string
  /** `done` once the row is handed to Codex, which also sets how its feedback reads. */
  handleTone?: Tone
  /** A finding's kind, which sets its handle's color and size. */
  kind?: Finding['kind']
  /** A line above the title, as a finding's kind and age, drawn open and closed. */
  meta?: JSX.Element
  title: string
  /** Muted text after the title, such as an age. */
  titleAfter?: string
  /** The unselected line, when it differs from the title and its age. */
  line?: { text: string; after?: string; afterTone?: Tone }
  /** Unselected, the title may take a second line. */
  hasSecondLine?: boolean
  body?: JSX.Element | null
  keys: Key[]
  /** Actions that talk about the row or drop it, after `keys` and a muted dot. */
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
let serverNote: string | null = null
// Polls that failed in a row while a view shows, and when the shown view was read.
let pollFailures = 0
let readAt = 0
let tab: Tab = 'needsYou'
// Each tab's open row, and when a click or key opened it; 0 when it was open by default when pressed.
// Null until a row opens there: the tab then draws its top row open.
const selection: Record<Tab, { id: string; openedAt: number } | null> = { needsYou: null, findings: null }
let typing: string | null = null
let focusTyping = false
// Typed text by row, kept until it is sent, so a redraw, a new selection or a closed field keeps it.
const drafts = new Map<string, string>()
// Questions whose every option shows. Until then, one with more than 5 options shows 4.
const optionsShown = new Set<string>()
const unfolded = new Set<Group>()
// What a row shows while its press runs: "Sending…", or a Local press's pending note.
const sending = new Map<string, string>()
const errors = new Map<string, string>()
// A row's stale or sample note, shown for SETTLED_MS from `at`.
const notes = new Map<string, { text: string; at: number }>()
const copies = new Map<string, { name: string; text: string }>()
// A note for a press whose row is no longer drawn, shown on its own line under the tab row for SETTLED_MS.
let lineNote: { text: string; at: number; isError?: boolean } | null = null
// When the tab first saw each row the view lists as settled. It draws one in place for SETTLED_MS from then.
let seen = new Map<string, number>()
// The row ids the tab has seen, and when each row new to it appeared. A new row draws a bar for NEW_ROW_MS.
let rowsSeen: SeenRows = {}
const arrived = new Map<string, number>()
// Rows and Closed lists that arrived since the last draw, which grow in when they are first drawn.
const entering = new Set<string>()
// Settled rows whose Undo press is out. They stay drawn, and their Undo fill stops, until it answers.
const undoing = new Set<string>()
// Closed folds still drawn while their list collapses.
const closingFolds = new Set<Group>()
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
let isPressing = false

// ── State kept across a page swap ───────────────────────────────────────────

/**
 * What the person chose or typed in this tab, which the page a swap writes in reads back once. Notes and presses
 * still out are left behind, since the new page reads the view fresh. A new `version` makes an older record unread.
 */
type Kept = {
  version: 1
  isDemo: boolean
  tab: Tab
  selection: Record<Tab, string | null>
  typing: string | null
  drafts: [string, string][]
  optionsShown: string[]
  unfolded: Group[]
}
const KEPT_KEY = 'inbox-tab-kept'

// The host may block storage in the tab's frame. Then a swap starts the new page empty, as a reload does.
function keepState() {
  const kept: Kept = {
    version: 1,
    isDemo,
    tab,
    selection: { needsYou: selection.needsYou?.id ?? null, findings: selection.findings?.id ?? null },
    typing,
    drafts: [...drafts],
    optionsShown: [...optionsShown],
    unfolded: [...unfolded],
  }
  try {
    sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept))
  } catch {}
}

function restoreState() {
  let kept: Kept | null = null
  try {
    const raw = sessionStorage.getItem(KEPT_KEY)
    sessionStorage.removeItem(KEPT_KEY)
    kept = raw ? (JSON.parse(raw) as Kept) : null
  } catch {}
  if (kept?.version !== 1) return
  isDemo = kept.isDemo
  tab = kept.tab
  for (const t of TAB_IDS) {
    const id = kept.selection[t]
    // An openedAt of 0 reads as open by default, so the restored row's actions take a press at once.
    selection[t] = id ? { id, openedAt: 0 } : null
  }
  typing = kept.typing
  focusTyping = typing !== null
  for (const [id, text] of kept.drafts) drafts.set(id, text)
  for (const id of kept.optionsShown) optionsShown.add(id)
  for (const g of kept.unfolded) unfolded.add(g)
}

// ── The host ────────────────────────────────────────────────────────────────

let nextId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: number }>()

/** Sends a request to the host. With `timeoutMs`, a request the host has not answered by then fails, and a later answer is dropped. */
function request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer =
      timeoutMs === undefined
        ? undefined
        : window.setTimeout(() => {
            if (pending.delete(id)) reject(new Error(`The inbox did not answer in ${Math.round(timeoutMs / 1000)} s`))
          }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
  })
}

window.addEventListener('message', e => {
  const m = e.data
  if (!m || m.jsonrpc !== '2.0') return
  if (m.id != null && !m.method && pending.has(m.id)) {
    const p = pending.get(m.id)!
    pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.error) p.reject(m.error)
    else p.resolve(m.result)
    return
  }
  if (m.method === 'ui/notifications/host-context-changed') applyHost(m.params ?? {})
  if (m.id != null && m.method) parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*')
})

function applyHost(ctx: { theme?: string; styles?: { variables?: Record<string, string> } }) {
  if (ctx.theme) document.documentElement.dataset.theme = ctx.theme
  for (const [k, v] of Object.entries(ctx.styles?.variables ?? {})) document.documentElement.style.setProperty(k, v)
}

/** A tool's answer for the tab. A call the server could not answer throws, as a failed request does. */
async function callTool<T>(name: string, args: unknown = {}, timeoutMs?: number): Promise<T> {
  const r = (await request('tools/call', { name, arguments: args }, timeoutMs)) as
    { structuredContent?: T; isError?: boolean; content?: { text?: string }[] } | undefined
  if (!r || r.isError || r.structuredContent === undefined)
    throw new Error((r?.isError && r.content?.[0]?.text) || 'The answer had nothing to show')

  return r.structuredContent
}

// ── The view ────────────────────────────────────────────────────────────────

function applyView(next: View, seq: number) {
  if (seq < shown) return
  shown = seq
  readError = null
  pollFailures = 0
  readAt = Date.now()
  const before = seen
  seen = settledSeen(seen, settledIds(next), Date.now())
  // A row seen settled for the first time starts to leave once SETTLED_MS passes. Its exit schedules its own end.
  if ([...seen.keys()].some(id => !before.has(id))) drawIn(SETTLED_MS)
  view = next
  const rows = newRows(rowsSeen, next)
  rowsSeen = rows.seen
  const added = [...rows.added.needsYou, ...rows.added.findings]
  for (const id of added) {
    arrived.set(id, Date.now())
    entering.add(id)
  }
  if (added.length > 0) drawIn(NEW_ROW_MS)
  follow(next, rows.added)
  draw()
}

/** Moves to the other tab for its new rows while the tab on screen shows only its empty text, as the mod's pane does. */
function follow(v: View, added: Record<Tab, string[]>) {
  const drawn = shownSettled()
  const to = followTo(TAB_IDS, tab, isShownEmpty(v, tab, drawn, unfolded), added)
  if (!to) return
  tab = to
  // With no row chosen, the tab draws its top row open, as the mod's pane does.
  selection[to] = null
}

/** How long a view read may go unanswered before it counts as failed, so a lost answer cannot stop the polls. */
const READ_TIMEOUT_MS = 3 * POLL_MS

/** Reads the view once. A failed first read shows that the inbox could not be read; a failed poll after it counts toward "retrying". */
async function read() {
  const seq = ++requested
  try {
    const next = await callTool<View>('inbox_view', { demo: isDemo }, READ_TIMEOUT_MS)
    const isPageOld = next.devPage !== PAGE
    if (isPageOld) void swapPage()
    serverNote = next.serverLoadError
      ? `The inbox server could not load its new build, so it still runs the last one. ${next.serverLoadError}`
      : next.serverBuild !== SERVER_BUILD && !isPageOld
        ? 'This tab and the inbox server are from different builds. Close the Inbox tab and open it again.'
        : null
    applyView(next, seq)
  } catch (err) {
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

/** This page's address, which the server stamps into each page it serves. */
const PAGE = (window as { __inboxPage?: string }).__inboxPage
let isSwapping = false

/** Replaces this page with the one the server serves now. The new page connects to Codex again. */
async function swapPage() {
  if (isSwapping) return
  isSwapping = true
  try {
    const { html } = await callTool<{ html: string }>('inbox_tab_page', {}, READ_TIMEOUT_MS)
    // document.open keeps this window's timers, so the old page's polls and redraws would run beside the new
    // page's. Timer ids count up from 1, so clearing every id up to a new one stops them all.
    const last = window.setTimeout(() => undefined, 0)
    for (let i = 1; i <= last; i++) clearTimeout(i)
    keepState()
    document.open()
    document.write(html)
    document.close()
  } catch {
    isSwapping = false
  }
}

async function poll() {
  if (!isPressing) await read()
  setTimeout(poll, POLL_MS)
}

/** Whether the view lists an open row with this id, which can show a note. */
function isListed(v: View, id: string): boolean {
  return allRows(v).some(r => r.id === id && r.state.is !== 'settled')
}

/** Whether the view lists this row as reading "Not sent". */
function isNotSent(v: View, id: string): boolean {
  return allRows(v).some(r => r.id === id && r.feedback?.is === 'notSent')
}

/**
 * Sends a press, drawn for the view's session, to the server. `onSent` runs
 * only once the press went through, so a stale or failed press keeps a typed draft.
 */
async function act(rowId: string, press: RowPress, onSent?: () => void, pending = 'Sending…') {
  if (press.action !== 'undo') keepPressedOpen(rowId)
  sending.set(rowId, pending)
  errors.delete(rowId)
  notes.delete(rowId)
  copies.delete(rowId)
  draw()
  isPressing = true
  const seq = ++requested
  try {
    const r = await callTool<PressReply>('inbox_press', { press, thread: view?.thread, demo: isDemo }, PRESS_TIMEOUT_MS)
    if (r.copy) await copy(rowId, r.copy)
    if (r.view) applyView(r.view, seq)
    // A message that did not send shows on its row, from the view, when the row is there to show it.
    if (r.error && !(view && isNotSent(view, rowId))) errors.set(rowId, r.error)
    // A sample press went through on the demo's copy, so its typed words go as a real press's do.
    // After the view, so `onSent` reads the rows as they are after the press.
    if (!r.error && r.note !== 'stale') onSent?.()
    if (r.note && view && isListed(view, rowId)) {
      notes.set(rowId, { text: noteText(r.note), at: Date.now() })
      drawIn(SETTLED_MS)
      // A stale press's typed words go back into the field they were sent from.
      if (r.note === 'stale' && press.action === 'type') typing = rowId
    } else if (r.note) {
      lineNote = { text: noteText(r.note), at: Date.now() }
      drawIn(SETTLED_MS)
    }
  } catch {
    errors.set(rowId, 'Not sent: the inbox did not answer.')
  } finally {
    isPressing = false
    sending.delete(rowId)
    draw()
  }
}

/** Copies a press's text. The row's result already reads "✓ Copied", so only a failure says more. */
async function copy(rowId: string, c: { text: string; name: string }) {
  try {
    await navigator.clipboard.writeText(c.text)
  } catch {
    // The tab's frame may not get the clipboard, so the text shows for a manual copy.
    errors.set(rowId, `Could not copy ${c.name}: this tab has no clipboard access`)
    copies.set(rowId, c)
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────

function startTyping(id: string) {
  keepPressedOpen(id)
  typing = id
  focusTyping = true
  draw()
}

/** A row's keys, in the order `rowKeyPlan` sets, as the tab's buttons. */
function rowKeys(r: RowView): { keys: Key[]; more: Key[] } {
  const { id, item } = r
  const key = (k: PlannedKey): Key => {
    switch (k.slot) {
      case 'retry':
        return { label: 'Try again', icon: 'retry', run: () => void act(id, k.press) }
      case 'allOptions':
        return {
          label: `All ${k.count} options`,
          run: () => {
            optionsShown.add(id)
            draw()
          },
        }
      case 'choice': {
        const { action: a, hotkey } = k
        const p = a.press
        const lettered = hotkey ? { hotkey } : {}
        if (p.action === 'answer')
          return { ...lettered, label: a.label, isPrimary: a.isPrimary, run: () => void act(id, p) }
        const step = r.steps[p.step]
        // An open or copy shows its pending note, as the pane does, until the server answers.
        const pending =
          a.kind === 'local' && item && step
            ? feedbackText({ is: 'local', result: pendingResult(stepEffects(item, step), Date.now()) }, 'codex')
            : undefined
        const icon = stepIcon(step)
        return {
          ...lettered,
          label: a.label,
          ...(icon ? { icon } : {}),
          run: () => void act(id, p, undefined, pending),
        }
      }
      case 'action': {
        const { action: a, hotkey } = k
        const p = a.press
        const run = p.action === 'type' ? () => startTyping(id) : () => void act(id, p)
        return { hotkey, label: a.label, ...(p.action === 'done' ? { icon: 'check' as const } : {}), run }
      }
    }
  }
  const { keys, more } = rowKeyPlan(r, optionsShown.has(id))

  return { keys: keys.map(key), more: more.map(key) }
}

function itemRow(v: View, r: RowView, item: Item): Row {
  const isQuestion = item.kind === 'question'
  const isHandedOff = r.state.is === 'handedOff'
  const id = item.id

  return {
    id,
    // Only a handed-off item has a mark. Its options answer a question, and the group header says the kind.
    handle: isHandedOff ? '✓' : '',
    handleTone: isHandedOff ? 'done' : undefined,
    ...(isHandedOff ? { fold: {} } : {}),
    title: item.ask,
    titleAfter: item.at === null ? undefined : `${DOT}${ago(v.at - item.at)}`,
    hasSecondLine: isQuestion,
    ...rowKeys(r),
    typing: {
      hint: isQuestion ? 'Your answer' : 'Your reply to Codex',
      send: text => void act(id, { action: 'type', id, text }, () => drafts.delete(id)),
    },
    feedback: r.feedback,
  }
}

function findingRow(v: View, r: RowView, f: Finding): Row {
  const badge = FINDING_BADGES[f.kind]
  // A finding handed to Codex folds, as a task does, until Codex's reply leaves it open.
  const isHandedOff = r.state.is === 'handedOff'
  const id = f.id

  return {
    id,
    handle: isHandedOff ? '✓' : badge.mark,
    handleTone: isHandedOff ? 'done' : undefined,
    kind: f.kind,
    ...(isHandedOff ? { fold: {} } : {}),
    title: f.title,
    meta: (
      <>
        <span class={`tone-${badge.tone}`}>{badge.label}</span>
        <span class="muted age">
          {DOT}
          {ago(v.at - f.at)}
        </span>
      </>
    ),
    line: { text: f.title },
    body: (
      <div>
        <p>{f.detail}</p>
        {f.path ? (
          <p>
            <span class="muted">Relevant file: </span>
            {f.path}
          </p>
        ) : null}
      </div>
    ),
    ...rowKeys(r),
    typing: {
      hint: 'Your reply to Codex',
      send: text => void act(id, { action: 'type', id, text }, () => drafts.delete(id)),
    },
    feedback: r.feedback,
  }
}

type Lists = DrawnLists<Row>

/** The view's lists as the tab draws them. A settled row shows while `drawn` has it, and is left out after. */
function listsOf(v: View, drawn: ReadonlySet<string>): Lists {
  return drawnLists(
    v,
    id => drawn.has(id),
    r => (r.item ? itemRow(v, r, r.item) : r.finding ? findingRow(v, r, r.finding) : null),
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
  const rows = lists.byTab[tab]
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
 * The open row's index, or -1 when none is open. A tab where no row opened yet
 * draws its top row open. Once the open row leaves, none is open: a row
 * opening under the pointer would catch a second click.
 */
function selectedIndex(rows: Row[], t: Tab, v: View): number {
  const s = selection[t]
  // In Needs you the top row that counts, else the first, as when every task is handed off.
  const id = s ? s.id : ((t === 'needsYou' ? v.needsYou.topId : null) ?? rows[0]?.id)

  return id ? rows.findIndex(r => r.id === id) : -1
}

/** Opens a row. Its buttons ignore clicks for PRESS_GUARD_MS, and draw again once that ends. */
function open(t: Tab, id: string) {
  selection[t] = { id, openedAt: Date.now() }
  drawIn(PRESS_GUARD_MS)
}

function select(t: Tab, rows: Row[], index: number) {
  const row = rows[index]
  if (!row) return
  open(t, row.id)
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
function KeyButton({ k, isGhost = false }: { k: Key; isGhost?: boolean }) {
  return (
    <button
      type="button"
      class={k.isPrimary ? 'key primary' : isGhost ? 'key ghost' : 'key'}
      disabled={isOpenGuarded()}
      onClick={() => {
        if (!isOpenGuarded()) k.run()
      }}
    >
      {k.icon ? <Icon name={k.icon} /> : null}
      {k.label}
    </button>
  )
}

function TypeField({ row }: { row: Row }) {
  const typed = row.typing!
  const submit = (e: Event) => {
    e.preventDefault()
    const text = (drafts.get(row.id) ?? '').trim()
    if (!text) return
    typing = null
    typed.send(text)
  }

  return (
    <form onSubmit={submit}>
      <input
        id={`type-${row.id}`}
        value={drafts.get(row.id) ?? ''}
        placeholder={typed.hint}
        aria-label={typed.hint}
        onInput={e => drafts.set(row.id, e.currentTarget.value)}
      />
      <button type="submit" class="key primary">
        Send
      </button>
      <button
        type="button"
        class="key ghost"
        onClick={() => {
          typing = null
          draw()
        }}
      >
        Cancel
      </button>
    </form>
  )
}

/** A row's last press, "✓ Explain" or "Queued: Explain". A row whose own mark is a ✓ leaves out the second one. */
function feedbackLabel(row: Row): string | null {
  const f = row.feedback
  if (!f) return null

  return f.is === 'done' && row.handleTone === 'done' ? f.label : feedbackText(f, 'codex')
}

/** The feedback with its age. A note, a Local result and a message not sent read alone, with no age. */
function lastText(row: Row, now: number): string | null {
  const f = row.feedback
  if (!f) return null

  return hasAge(f) ? `${feedbackLabel(row)}${DOT}${ago(now - f.at)}` : feedbackLabel(row)
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

/** Whether a row appeared less than NEW_ROW_MS ago, so it draws a bar. */
function isNew(id: string): boolean {
  const at = arrived.get(id)

  return at !== undefined && Date.now() - at < NEW_ROW_MS
}

function ListRow({
  row,
  tone,
  track,
  onSelect,
  now,
}: {
  row: Row
  /** The tab's color, for the bar of a row that just appeared. */
  tone: Tone
  track: RowTrack
  onSelect: () => void
  now: number
}) {
  // A closing or leaving row keeps its panel, inert, while its height shrinks over it.
  const isClosing = track.hasPanel && (track.state === 'closing' || track.state === 'leaving')
  const isSelected = track.hasPanel && !isClosing
  const bar = isNew(row.id) ? ` new tone-bar-${tone}` : ''
  const handle = <span class={`mark ${row.handleTone ?? row.kind ?? ''}`}>{row.handle}</span>

  const plain = row.line ?? { text: row.title, after: row.titleAfter }
  // A row's last action takes the place of its age, as "✓ Discuss 1m ago". It is muted unless it failed: a done row's ✓ is already green.
  // A press still out reads there too, as "Sending…", so nothing under the line moves while it runs.
  const pending = sending.get(row.id)
  const last = pending ?? (isFeedbackShown(row) ? lastText(row, now) : null)
  const line = last
    ? {
        ...plain,
        after: `${DOT}${last}`,
        afterTone: !pending && isFailure(row.feedback) ? ('error' as const) : undefined,
      }
    : plain

  // The same elements draw the row open and closed, so its line stays put and only the panel under it comes and goes.
  // Closed, the whole row takes the click; the button keeps it in the focus order, and its click reaches the row.
  return (
    <div
      class={`row ${isSelected ? 'selected' : 'collapsed'}${isClosing ? ' closing' : ''}${bar}`}
      onClick={isSelected ? undefined : onSelect}
    >
      {handle}
      <div class="content">
        {row.meta ? <div class="meta">{row.meta}</div> : null}
        {/* Open, the line does nothing, so it leaves the focus order. */}
        <button
          type="button"
          class="line"
          {...(isSelected ? { tabIndex: -1, 'aria-disabled': true } : { 'aria-expanded': false })}
        >
          <span class={row.hasSecondLine ? 'text two' : 'text'}>{line.text}</span>
          {line.after ? (
            <span class={`after ${line.afterTone ? `tone-${line.afterTone}` : ''}`}>{line.after}</span>
          ) : null}
        </button>
        {isSelected || isClosing ? <Panel row={row} isClosing={isClosing} /> : null}
      </div>
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
      {notes.length > 0 ? <div class="tight">{notes}</div> : null}
      <div class="actions">
        {/* Each group wraps as a whole: the follow-ups move to the next line together, never split across two. */}
        {keys.length > 0 || more.length > 0 ? (
          <div class="key-groups">
            {keys.length > 0 ? (
              <div class="keys">
                {keys.map(k => (
                  <KeyButton k={k} />
                ))}
              </div>
            ) : null}
            {more.length > 0 ? (
              <div class="keys follow-ups">
                {more.map(k => (
                  <KeyButton k={k} isGhost />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {isTyping ? <TypeField row={row} /> : null}
      </div>
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
  // Green only for what the person got: Done and answers. Dismissed, expired and agent closes are muted.
  const isGood = !state.isLapsed && !state.isQueued
  const error = errors.get(r.id)

  // Laid out as an open row is, so the panel it keeps stays where the open row drew it.
  return (
    <div class={panel ? 'row settled was-open' : 'row settled'}>
      {/* The ✓ waits for an answer's message to reach Codex. */}
      <span class={isGood ? 'mark done' : 'mark'}>{state.isQueued ? '' : '✓'}</span>
      <div class="content">
        <div class="settled-head">
          {/* An error wraps, so none of it is cut. */}
          <div class={error ? 'settled-line wraps' : 'settled-line'}>
            <span class="what">{r.title}</span>
            <span class="outcome-label">
              {DOT}
              {state.isQueued ? `Queued: ${state.label}` : state.label}
            </span>
            {error ? (
              <span class="tone-error">
                {DOT}
                {error}
              </span>
            ) : null}
          </div>
          {state.canUndo ? (
            <button type="button" class="key undo" disabled={isUndoing} onClick={() => void undo(r)}>
              {/* The delay is set once, when it is drawn: the animation keeps its own time after that. */}
              <span
                key={start}
                class={isUndoing ? 'time-left paused' : 'time-left'}
                style={{ animationDuration: `${SETTLED_MS}ms` }}
                ref={el => {
                  if (el && !el.style.animationDelay) el.style.animationDelay = `-${Math.max(0, Date.now() - start)}ms`
                }}
              />
              {isUndoing ? null : <Icon name="undo" />}
              {isUndoing ? 'Undoing…' : 'Undo'}
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
              <ListRow
                row={x.row}
                tone={t}
                track={drawn.track}
                now={now}
                onSelect={() => select(t, all, all.indexOf(x.row))}
              />
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
      {title}
      {count > 0 ? <span class="count">{count}</span> : null}
    </div>
  )
}

/** A group's closed items as its fold lists them: without the rows drawn settled, up to CLOSED_SHOWN. */
function itemsClosed(v: View, kind: 'question' | 'task', entries: Entry[]): ClosedLine[] {
  return closedShown(v.needsYou.closed[kind === 'question' ? 'questions' : 'tasks'], settledIn(entries)).map(d => ({
    id: d.id,
    ask: d.ask,
    outcome: d.outcome,
    isLapsed: isLapsed(d),
    at: d.at,
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
  const closed = itemsClosed(v, kind, entries)
  // A group with no open, settled or closed items is left out.
  if (entries.length === 0 && closed.length === 0) return null
  // A leaving row no longer counts.
  const rows = entries.flatMap(x => ('row' in x && drawnRows.get(x.row.id)?.track.state !== 'leaving' ? [x.row] : []))

  return (
    <section>
      {/* A row handed to Codex stays listed but leaves the count. */}
      <GroupTitle title={title} count={rows.filter(r => !r.fold).length} />
      <Entries entries={entries} group={kind} all={all} now={now} />
      <ClosedFold group={kind} closed={closed} now={now} />
    </section>
  )
}

/** A closed item or finding as a Closed fold lists it. */
type ClosedLine = {
  id: string
  ask: string
  outcome: string
  /** Closed without the person deciding it: dismissed, expired, or overtaken by the work. */
  isLapsed: boolean
  at: number
}

/** A list's closed items or findings behind `▸ N Closed`, each with how it closed and when. */
function ClosedFold({ group, closed, now }: { group: Group; closed: ClosedLine[]; now: number }) {
  if (closed.length === 0) return null
  const isUnfolded = unfolded.has(group)
  const isListed = isUnfolded || closingFolds.has(group)

  return (
    <>
      <button type="button" class="fold" data-fold={group} onClick={() => toggleFold(group)}>
        <Icon name={isUnfolded ? 'down' : 'right'} />
        {closed.length} Closed
      </button>
      {isListed ? (
        <div class="list closed-list" data-motion={`closed-${group}`}>
          {closed.map(d => (
            <div class="entry" key={`closed-${d.id}`}>
              <div class="row">
                <span class="mark">◇</span>
                <div class="content tight">
                  <div class="muted">{d.ask}</div>
                  <div>
                    <span class={d.isLapsed ? 'outcome lapsed' : 'outcome'}>{capitalized(d.outcome)}</span>
                    <span class="muted age">
                      {DOT}
                      {ago(now - d.at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
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

  // With closed items still shown, the empty text is one line above them.
  return (
    <main>
      {notHeard ? (
        <section>
          <div class="group-title">
            {notHeard[0]}
            <div class="muted">{notHeard[1]}</div>
          </div>
        </section>
      ) : isNothing ? (
        <section>
          <div class="group-title empty-line">{emptyText('needsYou', 'Codex').title}</div>
        </section>
      ) : null}
      <ItemGroup v={v} kind="question" entries={lists.questions} all={all} now={now} />
      <ItemGroup v={v} kind="task" entries={lists.tasks} all={all} now={now} />
    </main>
  )
}

function Findings({ v, lists, now }: { v: View; lists: Lists; now: number }) {
  // A finding stays listed until Codex closes it or the person dismisses it. Then it settles and moves to Closed.
  const closed = closedShown(v.findings.closed, settledIn(lists.findings)).map(f => ({
    id: f.id,
    ask: f.title,
    outcome: f.outcome,
    isLapsed: isLapsed(f),
    at: f.closedAt,
  }))
  const isNothing = lists.findings.length === 0
  if (isNothing && closed.length === 0)
    return (
      <div class="empty">
        <div class="title">{emptyText('findings', 'Codex').title}</div>
        <div class="muted">{emptyText('findings', 'Codex').hint}</div>
      </div>
    )

  // With closed findings still shown, the empty text is one line above them.
  return (
    <main>
      <section>
        {isNothing ? <div class="group-title empty-line">No open findings.</div> : null}
        <Entries entries={lists.findings} group="finding" all={lists.byTab.findings} now={now} />
        <ClosedFold group="finding" closed={closed} now={now} />
      </section>
    </main>
  )
}

/** How long polls may fail before "retrying" turns red. */
const LATE_READ_MS = 60_000

/**
 * The tabs, with the status at the row's right. While polls fail, the status says when the view shown was read.
 * A read error or a note takes its own line under the row, so the status never moves.
 */
function TabBar({ v, now }: { v: View; now: number }) {
  const counts: Record<Tab, number> = { needsYou: v.needsYou.count, findings: v.findings.count }
  const { changedAt, isUpdating, error } = v.status
  const sinceRead = Date.now() - readAt
  const status =
    pollFailures >= 2 ? (
      <span class={sinceRead > LATE_READ_MS ? 'tone-error' : undefined}>
        Last read {ago(sinceRead)}
        {DOT}retrying
      </span>
    ) : isUpdating ? (
      'Updating…'
    ) : changedAt !== null ? (
      `Updated ${ago(now - changedAt)}`
    ) : (
      'Not updated yet'
    )

  return (
    <nav>
      <div class="tabs">
        {ROW_TABS.map(t => (
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
      <div class="status">{status}</div>
      {serverNote ? <div class="status-line tone-error">{serverNote}</div> : null}
      {error ? <div class="status-line tone-error">{error}</div> : null}
      {lineNote && Date.now() - lineNote.at < SETTLED_MS ? (
        <div class={lineNote.isError ? 'status-line tone-error' : 'status-line muted'}>{lineNote.text}</div>
      ) : null}
    </nav>
  )
}

/** Switches between the conversation's inbox and the demo. The new view starts fresh, so no row reads as just closed or new. */
async function toggleDemo() {
  isDemo = !isDemo
  view = null
  seen = new Map()
  rowsSeen = {}
  arrived.clear()
  // The other view's rows are not this one's: none of them leaves or settles in it.
  drawnRows.clear()
  lastLists = null
  selection.needsYou = null
  selection.findings = null
  typing = null
  draw()
  await read()
}

function App({ lists }: { lists: Lists | null }): ComponentChildren {
  if (!view || !lists)
    return readError !== null ? (
      <div class="notice">
        Could not read the inbox. {readError}{' '}
        <button type="button" class="key" onClick={() => void read()}>
          Try again
        </button>
      </div>
    ) : (
      <div class="notice">
        <span class="muted">Loading…</span>
      </div>
    )
  const v = view
  const now = v.at

  return (
    <>
      {isDemo ? (
        <div class="demo-note">
          <span>Showing sample entries. Presses here send nothing.</span>
          <button type="button" class="key" onClick={() => void toggleDemo()}>
            Hide demo
          </button>
        </div>
      ) : null}
      <TabBar v={v} now={now} />
      {tab === 'needsYou' ? <NeedsYou v={v} lists={lists} now={now} /> : <Findings v={v} lists={lists} now={now} />}
      <footer>
        {isDemo ? null : (
          <button type="button" class="demo-toggle" onClick={() => void toggleDemo()}>
            Show demo
          </button>
        )}
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
  for (const el of document.querySelectorAll<HTMLElement>('[data-motion]'))
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
  const done = () => {
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
 * A row entry's content height, which an animation of its own height does not change, as its scroll height does
 * while the animation holds it taller than its content. The entry's children stack with no gaps or padding.
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
  for (const el of document.querySelectorAll<HTMLElement>('[data-motion]')) {
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
    // A Closed list's scroll height is its content's: only its own close shrinks it, which runs apart from this.
    const target = state ? contentHeight(el) : el.scrollHeight
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
    tween(el, { height, opacity }, { height: target, opacity: 1 }, MOVE)
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
function toggleFold(group: Group) {
  const el = document.querySelector<HTMLElement>(`[data-motion="closed-${group}"]`)
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
  setTimeout(() => {
    if (unfolded.has(group) || !closingFolds.delete(group)) return
    draw()
  }, EXIT_MS)
}

/** Brings the open row into view, and again once its height has moved, since a row still growing is clipped. */
function revealSelected() {
  document.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  if (!reducedMotion.matches)
    setTimeout(() => document.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' }), MOVE_MS + 20)
}

const root = document.getElementById('app')!
// The row padding the Claude app pane shares, and the row states' move and enter, which tab.html reads.
document.documentElement.style.setProperty('--row-pad', `${ROW_PAD_PT}px`)
document.documentElement.style.setProperty('--move', `${MOVE_MS}ms ${MOVE.easing}`)
document.documentElement.style.setProperty('--enter', `${ENTER_MS}ms ${ENTER.easing}`)

// Slack for a timer to land after the state it waits on ends.
const TIMER_SLACK_MS = 50

/** Draws again once `ms` has passed. */
function drawIn(ms: number) {
  setTimeout(draw, ms + TIMER_SLACK_MS)
}

// The draw due when the first moving row's move ends.
let moveWake: { at: number; timer: ReturnType<typeof setTimeout> } | null = null

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
  if (moveWake) clearTimeout(moveWake.timer)
  moveWake = {
    at,
    timer: setTimeout(() => {
      moveWake = null
      draw()
    }, at - now),
  }
}

function draw() {
  // The page's "Loading…" text is not Preact's, so it goes before the first draw.
  if (root.className) {
    root.className = ''
    root.textContent = ''
  }
  const before = measure()
  const step = view ? stepLists(view) : null
  lastLists = step?.lists ?? null
  wakeForMoves()
  render(<App lists={lastLists} />, root)
  animateDraw(before, step?.changed ?? new Set())
  if (focusTyping && typing) {
    focusTyping = false
    document.getElementById(`type-${typing}`)?.focus()
  }
}

// ── Keys ────────────────────────────────────────────────────────────────────

// The pane's keys, while the tab has focus. A text field takes its own keys, and
// a held modifier leaves the key to the app.
// A press in a list moves rows under the pointer, so hover fills stay off until the pointer itself moves.
let pressedAt: { x: number; y: number } | null = null
document.addEventListener('pointerdown', e => {
  if (!(e.target instanceof Element) || !e.target.closest('.list, .fold')) return
  pressedAt = { x: e.clientX, y: e.clientY }
  document.body.classList.add('still')
})
document.addEventListener('pointermove', e => {
  if (!pressedAt || Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) < 3) return
  pressedAt = null
  document.body.classList.remove('still')
})

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || !view) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea')) {
    if (e.key === 'Escape' && target.tagName === 'INPUT') {
      typing = null
      draw()
    }
    return
  }
  const switched = ROW_TABS.find(t => t.hotkey === e.key)
  if (switched) {
    tab = switched.id
    draw()
    return
  }
  const rows = listsOf(view, shownSettled()).byTab[tab]
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
})

restoreState()
request('ui/initialize', {
  protocolVersion: '2026-01-26',
  appInfo: { name: 'inbox', version: '0.1.0' },
  appCapabilities: { tools: {} },
})
  .then(r => {
    applyHost((r as { hostContext?: Parameters<typeof applyHost>[0] } | undefined)?.hostContext ?? {})
    parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*')
    void poll()
  })
  .catch(() => {
    root.textContent = 'The inbox could not connect to Codex.'
  })
