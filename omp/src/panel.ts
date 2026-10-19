import type { Draft, Tab } from '../../types'
import {
  GH_MISSING_TEXT,
  PR_GROUP_TITLES,
  PR_TONES,
  checkActions,
  checkRunText,
  prBlockActions,
  prCheckId,
  prMarkId,
  prThreadId,
  threadActions,
  threadRowText,
  threadSentIn,
} from '../../hooks/pr-tab'
import type { PrAction, PrPress } from '../../hooks/pr-tab'
import { failingChecks, readiness, waitingThreads } from '../../hooks/prs'
import { noteText } from '../../hooks/presses'
import type { RowPress } from '../../hooks/presses'
import type { SessionView } from '../../hooks/session'
import type { ToneName } from '../../hooks/tones'
import { ago } from '../../hooks/text'
import {
  DEMO_NOTICE,
  FINDING_GROUPS,
  QUEUED_AFTER_MS,
  ROW_COPY,
  SETTLED_MS,
  TABS,
  closedTotal,
  emptyText,
  feedbackOf,
  feedbackText,
  firstWaiting,
  foldLabel,
  heldReplies,
  isFailure,
  isWaitingRow,
  replyHint,
  rowAfterClose,
  rowFeedbackText,
  rowKeyPlan,
  rowMark,
  settledLabel,
} from '../../hooks/view'
import type { Feedback, ReplyHolds, RowView } from '../../hooks/view'

export type PanelPress = RowPress | PrPress

/** What the panel draws: the session's view and the host facts the shared view does not hold. */
export type PanelScreen = {
  view: SessionView
  /** The model that runs the inbox update, or null when the person has none. */
  modelName: string | null
  isGhMissing: boolean
  isFetchingPrs: boolean
  isDemo?: boolean
}

export type Tone = ToneName | 'accent' | 'sep'

/** The terminal styles the panel draws with. The host maps them onto the active omp theme. */
export type Style = {
  bold(s: string): string
  dim(s: string): string
  inverse(s: string): string
  underline(s: string): string
  tone(name: Tone, s: string): string
}

export type PanelUi = {
  tab: Tab
  selectedId: string | null
  /** The focused button of one row. Another row's focus starts at its recommended option. */
  focus: { rowId: string; index: number } | null
  /** The row whose reply field is open. */
  typing: string | null
  /** Replies begun and not sent, by row id. Cancelling the field keeps its draft. */
  drafts: Record<string, Draft>
  /** Rows whose draft the person discarded, and when. */
  discarded: Record<string, number>
  /** A line about the last press that the row itself cannot show, until `at` + SETTLED_MS. */
  notice: { text: string; at: number } | null
}

export const INITIAL_UI: PanelUi = {
  tab: 'needsYou',
  selectedId: null,
  focus: null,
  typing: null,
  drafts: {},
  discarded: {},
  notice: null,
}

export function holdsOf(ui: Pick<PanelUi, 'typing' | 'drafts' | 'discarded'>): ReplyHolds {
  return { replies: heldReplies(ui.typing, ui.drafts), discarded: ui.discarded }
}

const AGENT = 'omp'
const REPLY_KEY = 'r'
const INDENT = 7

type Button = {
  label: string
  key: string | null
  press: PanelPress
  isRecommended: boolean
  isFollowUp: boolean
}

type Lead = { text: string; tone: Tone | null }

type Line = {
  id: string
  /** Extra indent, for the rows under a PR. */
  depth: number
  lead: Lead
  title: string
  isDim: boolean
  /** The status words after a PR's title. */
  status: { text: string; tone: Tone | null; rest: string } | null
  age: number | null
  detail: string | null
  file: string | null
  feedback: { text: string; tone: Tone | null } | null
  /** Set once the row has closed and its label shows until it leaves. */
  settled: { label: string; undo: PanelPress | null } | null
  buttons: Button[]
  row: RowView | null
}

type Entry =
  { kind: 'heading'; text: string } | { kind: 'note'; text: string; isStrong?: boolean } | { kind: 'row'; line: Line }

const wrapIndex = (i: number, n: number) => ((i % n) + n) % n

function feedbackTone(f: Feedback): Tone | null {
  if (isFailure(f)) return 'error'
  if (f.is === 'done' || (f.is === 'local' && f.result.state === 'done') || f.is === 'closed') return 'done'

  return null
}

function rowButtons(row: RowView): Button[] {
  const { keys, more } = rowKeyPlan(row, true)
  const recommended = row.item?.rec

  return [...keys, ...more].flatMap((k): Button[] => {
    if (k.slot === 'allOptions') return []
    if (k.slot === 'retry')
      return [{ label: k.label, key: null, press: k.press, isRecommended: false, isFollowUp: false }]
    const { press } = k.action
    const key = press.action === 'type' ? REPLY_KEY : (k.hotkey ?? null)

    return [
      {
        label: k.action.label,
        key,
        press,
        isRecommended: k.slot === 'choice' && press.action === 'answer' && press.option === recommended,
        isFollowUp: k.slot === 'action' && k.action.isFollowUp,
      },
    ]
  })
}

function prButtons(actions: PrAction[]): Button[] {
  return actions.map(a => ({
    label: a.label,
    key: a.hotkey ?? null,
    press: a.press,
    isRecommended: false,
    isFollowUp: a.isFollowUp === true,
  }))
}

function leadOf(row: RowView): Lead {
  const mark = rowMark(row, AGENT)
  if (mark.tone === 'done') return { text: mark.text, tone: 'done' }
  if (mark.tone === 'issue') return { text: mark.text, tone: 'issue' }

  return { text: mark.text, tone: mark.text === '•' ? 'sep' : null }
}

function lineOfRow(row: RowView): Line {
  const feedbackLabel = rowFeedbackText(row, AGENT)
  const f = row.feedback
  const state = row.state
  const undo = row.actions.find(a => a.press.action === 'undo')

  return {
    id: row.id,
    depth: 0,
    lead: leadOf(row),
    title: row.title,
    isDim: state.is === 'settled',
    status: null,
    age: row.at,
    detail: row.detail,
    file: row.fileName,
    feedback: feedbackLabel && f ? { text: feedbackLabel, tone: feedbackTone(f) } : null,
    settled:
      state.is === 'settled'
        ? { label: settledLabel(state.label, state.delivery), undo: state.canUndo && undo ? undo.press : null }
        : null,
    buttons: state.is === 'settled' ? [] : rowButtons(row),
    row,
  }
}

function rowEntries(screen: PanelScreen, tab: 'needsYou' | 'findings'): Entry[] {
  const { view } = screen
  const out: Entry[] = []
  const rows = tab === 'needsYou' ? [...view.needsYou.questions, ...view.needsYou.tasks] : view.findings.rows
  const lineOf = (row: RowView): Entry => ({ kind: 'row', line: lineOfRow(row) })
  if (tab === 'needsYou') out.push(...rows.map(lineOf))
  else
    for (const kind of Object.keys(FINDING_GROUPS) as (keyof typeof FINDING_GROUPS)[]) {
      const group = rows.filter(r => r.finding?.kind === kind)
      if (group.length === 0) continue
      out.push({ kind: 'heading', text: FINDING_GROUPS[kind].title }, ...group.map(lineOf))
    }
  if (rows.length === 0) {
    const empty = emptyText(tab, AGENT)
    out.push({ kind: 'note', text: empty.title, isStrong: true }, { kind: 'note', text: empty.hint })
  }
  const settledIds = new Set(rows.filter(r => r.state.is === 'settled').map(r => r.id))
  const closed =
    tab === 'needsYou' ? [...view.needsYou.closed.questions, ...view.needsYou.closed.tasks] : view.findings.closed
  const total = closedTotal(closed, settledIds)
  if (total > 0) out.push({ kind: 'note', text: foldLabel(total) })

  return out
}

function prEntries(screen: PanelScreen, now: number): Entry[] {
  const { prs, lastActions } = screen.view
  const isSent = threadSentIn(lastActions)
  const out: Entry[] = []
  const plain = (id: string): Line => ({
    id,
    depth: 0,
    lead: { text: '', tone: null },
    title: '',
    isDim: false,
    status: null,
    age: null,
    detail: null,
    file: null,
    feedback: null,
    settled: null,
    buttons: [],
    row: null,
  })
  if (screen.isGhMissing) out.push({ kind: 'note', text: GH_MISSING_TEXT })
  for (const { pr, isSettled } of prs.drawn) {
    const markId = prMarkId(pr.ref)
    const lead: Lead = { text: `#${pr.number}`, tone: 'prs' }
    if (isSettled) {
      out.push({
        kind: 'row',
        line: {
          ...plain(markId),
          lead,
          title: pr.title,
          isDim: true,
          settled: { label: 'Dismissed', undo: { action: 'pr-undo', ref: pr.ref } },
        },
      })
      continue
    }
    const { status, head, unlisted } = readiness(pr, isSent)
    const last = lastActions[markId]
    const f = last?.action === 'pr-dismiss' ? null : pressFeedback(screen, markId, now)
    out.push({
      kind: 'row',
      line: {
        ...plain(markId),
        lead,
        title: pr.title,
        status: { text: head, tone: PR_TONES[status], rest: unlisted.map(r => ` · ${r}`).join('') },
        feedback: f,
        detail: pr.error ? `Last refresh failed: ${pr.error}` : null,
        buttons: prButtons(prBlockActions(pr, isSent, prs.branchRef, lastActions)),
      },
    })
    const threads = waitingThreads(pr)
    if (threads.length > 0) out.push({ kind: 'heading', text: PR_GROUP_TITLES.threads })
    for (const t of threads) {
      const id = prThreadId(pr, t)
      const text = threadRowText(pr, t, lastActions)
      out.push({
        kind: 'row',
        line: {
          ...plain(id),
          depth: 1,
          lead: { text: '•', tone: 'sep' },
          title: text.title,
          isDim: text.fold !== null,
          detail: [text.meta, text.fold?.note].filter(Boolean).join(' · ') || null,
          feedback: pressFeedback(screen, id, now),
          buttons: prButtons(threadActions(pr, t, lastActions)),
        },
      })
    }
    const checks = failingChecks(pr)
    if (checks.length > 0) out.push({ kind: 'heading', text: PR_GROUP_TITLES.checks })
    for (const c of checks) {
      const id = prCheckId(pr, c)
      out.push({
        kind: 'row',
        line: {
          ...plain(id),
          depth: 1,
          lead: { text: '•', tone: 'sep' },
          title: c.name,
          detail: checkRunText(c),
          feedback: pressFeedback(screen, id, now),
          buttons: prButtons(checkActions(pr, c, lastActions)),
        },
      })
    }
  }
  if (prs.olderText) out.push({ kind: 'note', text: prs.olderText })
  if (prs.drawn.length === 0 && !screen.isGhMissing)
    out.push({ kind: 'note', text: screen.isFetchingPrs ? 'Checking for PRs…' : 'No PRs', isStrong: true })

  return out
}

function pressFeedback(screen: PanelScreen, id: string, now: number): Line['feedback'] {
  const f = feedbackOf(id, screen.view.lastActions[id], undefined, screen.view.turns, now)

  return f ? { text: feedbackText(f, AGENT), tone: feedbackTone(f) } : null
}

function entriesOf(screen: PanelScreen, tab: Tab, now: number): Entry[] {
  return tab === 'prs' ? prEntries(screen, now) : rowEntries(screen, tab)
}

const linesOf = (entries: Entry[]): Line[] => entries.flatMap(e => (e.kind === 'row' ? [e.line] : []))
const isSelectable = (line: Line) => line.settled === null

function resolveSelected(lines: Line[], selectedId: string | null): Line | null {
  const selectable = lines.filter(isSelectable)
  const current = lines.find(l => l.id === selectedId)
  if (current && isSelectable(current)) return current
  const waits = lines.map(l => ({ id: l.id, isWaiting: l.row ? isWaitingRow(l.row) : isSelectable(l) }))
  const nextId = (current ? rowAfterClose(waits, current.id) : null) ?? firstWaiting(waits)

  return lines.find(l => l.id === nextId) ?? selectable[0] ?? null
}

function defaultFocus(line: Line): number {
  return Math.max(
    0,
    line.buttons.findIndex(b => b.isRecommended),
  )
}

const focusOf = (line: Line, ui: PanelUi): number =>
  ui.focus?.rowId === line.id ? Math.min(ui.focus.index, line.buttons.length - 1) : defaultFocus(line)

export type KeyResult = { ui: PanelUi; press?: PanelPress; close?: true }

function withSelection(ui: PanelUi, id: string | null): PanelUi {
  return { ...ui, selectedId: id, focus: null }
}

function activate(ui: PanelUi, line: Line, button: Button, now: number): KeyResult {
  const { press } = button
  if (!('ref' in press) && press.action === 'type') {
    const draft = ui.drafts[line.id] ?? { text: '', since: now }

    return { ui: { ...ui, typing: line.id, focus: null, drafts: { ...ui.drafts, [line.id]: draft } } }
  }
  if (!('ref' in press) && press.action === 'discard') {
    const { [line.id]: _discarded, ...drafts } = ui.drafts
    const recent = Object.entries(ui.discarded).filter(([, at]) => now - at < SETTLED_MS)

    return { ui: { ...ui, focus: null, drafts, discarded: { ...Object.fromEntries(recent), [line.id]: now } } }
  }

  return { ui: { ...ui, focus: null }, press }
}

function typingKey(ui: PanelUi, id: string, key: string, now: number, text: string | undefined): KeyResult {
  const draft = ui.drafts[id] ?? { text: '', since: now }
  const edit = (next: string): KeyResult => ({
    ui: { ...ui, drafts: { ...ui.drafts, [id]: { ...draft, text: next } } },
  })
  if (key === 'escape') return { ui: { ...ui, typing: null } }
  if (key === 'enter') {
    if (draft.text.trim() === '') return { ui }
    const { [id]: _sent, ...drafts } = ui.drafts

    return { ui: { ...ui, typing: null, drafts }, press: { action: 'type', id, text: draft.text } }
  }
  if (key === 'backspace') return edit([...draft.text].slice(0, -1).join(''))
  if (text !== undefined) return edit(draft.text + text.replace(/[\r\n]+/g, ' '))

  return { ui }
}

/**
 * Applies one key. `key` is the parsed key name, as pi-tui's `parseKey` gives it. `text` is the printable text the
 * key types, which only a reply field reads.
 */
export function handleKey(screen: PanelScreen, ui: PanelUi, key: string, now: number, text?: string): KeyResult {
  const lines = linesOf(entriesOf(screen, ui.tab, now))
  const selected = resolveSelected(lines, ui.selectedId)
  const base: PanelUi = { ...ui, selectedId: selected?.id ?? null }
  if (base.typing !== null) return typingKey(base, base.typing, key, now, text)
  if (key === 'escape') return { ui: base, close: true }
  const selectable = lines.filter(isSelectable)
  const at = selectable.findIndex(l => l.id === selected?.id)
  if ((key === 'up' || key === 'k' || key === 'down' || key === 'j') && selectable.length > 0) {
    const step = key === 'up' || key === 'k' ? -1 : 1

    return { ui: withSelection(base, selectable[wrapIndex(Math.max(0, at) + step, selectable.length)]!.id) }
  }
  const tabs = TABS.map(t => t.id)
  const pickedTab = TABS.find(t => t.hotkey === key)
  if (key === 'tab' || key === 'shift+tab') {
    const step = key === 'tab' ? 1 : -1

    return { ui: { ...withSelection(base, null), tab: tabs[wrapIndex(tabs.indexOf(base.tab) + step, tabs.length)]! } }
  }
  if (pickedTab) return { ui: { ...withSelection(base, null), tab: pickedTab.id } }
  if (key === 'u') {
    const undoable = lines.filter(l => l.settled?.undo).at(-1)
    const press = undoable?.settled?.undo
    if (undoable && press) return { ui: withSelection(base, undoable.id), press }

    return { ui: base }
  }
  if (!selected || selected.buttons.length === 0) return { ui: base }
  if (key === 'left' || key === 'right') {
    const index = wrapIndex(focusOf(selected, base) + (key === 'left' ? -1 : 1), selected.buttons.length)

    return { ui: { ...base, focus: { rowId: selected.id, index } } }
  }
  const button = key === 'enter' ? selected.buttons[focusOf(selected, base)] : selected.buttons.find(b => b.key === key)

  return button ? activate(base, selected, button, now) : { ui: base }
}

/**
 * True while the view changes with the clock alone: a closed row counting down to leave, a local press's result
 * showing, a send waiting to read as queued, or a notice. Changes the host saves arrive as events instead.
 */
export function isAnimating(screen: PanelScreen, ui: PanelUi, now: number): boolean {
  const { view } = screen
  const rows = [...view.needsYou.questions, ...view.needsYou.tasks, ...view.findings.rows]
  const isPressMoving = Object.values(view.lastActions).some(
    l =>
      (l.result !== undefined && (l.result.state === 'pending' || now - l.result.at < SETTLED_MS)) ||
      (l.delivery?.state === 'queued' && now - l.at < QUEUED_AFTER_MS),
  )
  const isNoticeShown = ui.notice !== null && now - ui.notice.at < SETTLED_MS

  return (
    rows.some(r => r.state.is === 'settled') || view.prs.drawn.some(p => p.isSettled) || isPressMoving || isNoticeShown
  )
}

/** The notice for a press the row cannot show: a failed send, or a press whose row had changed. */
export function noticeFor(
  outcome: { error: string | null; note: 'stale' | 'sample' | null },
  now: number,
): PanelUi['notice'] {
  const text = outcome.error ?? (outcome.note ? noteText(outcome.note) : null)

  return text === null ? null : { text, at: now }
}

const ANSI = /\x1b\[[0-9;]*m/g
export const visibleLength = (s: string): number => [...s.replace(ANSI, '')].length

function fit(s: string, width: number): string {
  if (visibleLength(s) <= width) return s
  let out = ''
  let n = 0
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) {
      out += part
      continue
    }
    for (const ch of part) {
      if (n >= width - 1) return `${out}…\x1b[0m`
      out += ch
      n++
    }
  }

  return out
}

function spread(left: string, right: string, width: number): string {
  const gap = width - visibleLength(left) - visibleLength(right)

  return gap >= 2 ? left + ' '.repeat(gap) + right : fit(left, width)
}

function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const long = [...word].length > width ? [...word].slice(0, width - 1).join('') + '…' : word
      if (line === '') line = long
      else if ([...line].length + 1 + [...long].length <= width) line += ` ${long}`
      else {
        out.push(line)
        line = long
      }
    }
    out.push(line)
  }

  return out
}

function indented(
  text: string,
  indent: number,
  width: number,
  maxLines: number,
  paint: (s: string) => string,
): string[] {
  const wrapped = wrapText(text, Math.max(10, width - indent - 1))
  const shown = wrapped.slice(0, maxLines)
  if (wrapped.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1]!.replace(/.$/, '')}…`

  return shown.map(l => ' '.repeat(indent) + paint(l))
}

type Draw = { screen: PanelScreen; ui: PanelUi; width: number; now: number; style: Style }

function buttonCell(b: Button, isFocused: boolean, s: Style): string {
  if (isFocused) return s.inverse(s.bold(` ↵ ${b.label} `))
  if (b.isFollowUp) return s.dim(b.key ? ` ${b.key} ${b.label} ` : ` ${b.label} `)
  const label = b.isRecommended ? s.underline(b.label) : b.label

  return b.key ? ` ${s.bold(b.key)} ${label} ` : ` ${label} `
}

function buttonLines(line: Line, ui: PanelUi, indent: number, width: number, s: Style): string[] {
  const focused = focusOf(line, ui)
  const out: string[] = []
  let current = ' '.repeat(indent)
  let used = indent
  line.buttons.forEach((b, i) => {
    const cell = buttonCell(b, i === focused, s)
    const size = visibleLength(cell)
    if (used + size > width && used > indent) {
      out.push(current)
      current = ' '.repeat(indent)
      used = indent
    }
    current += cell
    used += size
  })
  out.push(current)

  return out
}

function leadText(lead: Lead, s: Style): string {
  const padded = lead.text.padEnd(2)

  return lead.tone ? s.tone(lead.tone, padded) : padded
}

function feedbackPaint(tone: Tone | null, s: Style) {
  return (text: string) => (tone ? s.tone(tone, text) : s.dim(text))
}

function drawLine(line: Line, isSelected: boolean, d: Draw): string[] {
  const { ui, width, now, style: s } = d
  const pad = line.depth * 2
  const out: string[] = []
  const status = line.status
    ? `  ${line.status.tone ? s.tone(line.status.tone, line.status.text) : s.dim(line.status.text)}${s.dim(line.status.rest)}`
    : ''
  const after = line.settled
    ? `  ${s.tone('done', line.settled.label)}${line.settled.undo ? `  ${s.dim('u Undo')}` : ''}`
    : line.feedback
      ? `  ${feedbackPaint(line.feedback.tone, s)(line.feedback.text)}`
      : ''
  const title = line.isDim ? s.dim(line.title) : isSelected ? s.bold(line.title) : line.title
  const cursor = isSelected ? s.tone('accent', '▸') : ' '
  const age = line.age !== null && line.settled === null ? s.dim(ago(now - line.age)) : ''
  out.push(spread(` ${' '.repeat(pad)}${cursor} ${leadText(line.lead, s)} ${title}${status}${after}`, `${age} `, width))
  if (!isSelected || line.settled) return out
  const indent = INDENT + pad
  if (line.detail) out.push(...indented(line.detail, indent, width, 4, s.dim))
  if (line.file) out.push(' '.repeat(indent) + s.tone('accent', line.file))
  if (line.buttons.length > 0) out.push(...buttonLines(line, ui, indent - 1, width, s))
  if (ui.typing === line.id) {
    const hint = line.row ? replyHint(line.row, AGENT) : 'Your reply'
    const text = ui.drafts[line.id]?.text ?? ''
    out.push(' '.repeat(indent) + s.dim(`${hint}:`))
    const field = wrapText(`${text}\u0000`, Math.max(10, width - indent - 1))
    out.push(...field.map(l => ' '.repeat(indent) + l.replace('\u0000', s.inverse(' '))))
  }

  return out
}

function tabBar(d: Draw): string {
  const { screen, ui, style: s } = d
  const counts: Record<Tab, number> = {
    needsYou: screen.view.needsYou.count,
    findings: screen.view.findings.count,
    prs: screen.view.prs.count,
  }
  const tabs = TABS.map(t =>
    t.id === ui.tab
      ? s.inverse(s.bold(` [${t.hotkey}] ${t.label} ${counts[t.id]} `))
      : ` ${s.dim(`[${t.hotkey}] ${t.label}`)} ${s.tone(t.id, String(counts[t.id]))} `,
  ).join(' ')

  return spread(` ${tabs}`, s.dim('esc to close '), d.width)
}

function footer(d: Draw): string[] {
  const { screen, ui, width, now, style: s } = d
  const out: string[] = [s.dim('─'.repeat(width))]
  const { status } = screen.view
  if (screen.isDemo) out.push(fit(` ${s.dim(DEMO_NOTICE)}`, width))
  if (ui.tab === 'prs' ? screen.isFetchingPrs : status.isUpdating)
    out.push(` ${s.dim(ui.tab === 'prs' ? 'Refreshing PRs…' : 'Updating…')}`)
  if (ui.tab !== 'prs' && status.error) out.push(...indented(status.error, 1, width, 2, t => s.tone('error', t)))
  if (ui.notice && now - ui.notice.at < SETTLED_MS)
    out.push(...indented(ui.notice.text, 1, width, 2, t => s.tone('error', t)))
  const hints =
    ui.typing !== null
      ? [`↵ ${ROW_COPY.send}`, `esc ${ROW_COPY.cancel}`]
      : ['←→ pick', '↵ press', '↑↓ move', 'tab switch']
  const model = screen.modelName ? `inbox model ${screen.modelName} ` : 'no inbox model '
  out.push(spread(` ${hints.map(h => s.dim(h)).join(` ${s.tone('sep', '·')} `)}`, s.dim(model), width))

  return out
}

/** The panel's lines for `width`. With `height`, the rows scroll inside it and keep the selected row in view. */
export function render(
  screen: PanelScreen,
  ui: PanelUi,
  width: number,
  now: number,
  style: Style,
  height?: number,
): string[] {
  const d: Draw = { screen, ui, width, now, style }
  const entries = entriesOf(screen, ui.tab, now)
  const selected = resolveSelected(linesOf(entries), ui.selectedId)
  const head = [tabBar(d), style.dim('─'.repeat(width))]
  const body: string[] = []
  let selectedAt = [0, 0]
  for (const e of entries) {
    if (e.kind === 'heading') body.push(` ${style.bold(e.text)}`)
    else if (e.kind === 'note') body.push(...indented(e.text, 1, width, 3, e.isStrong ? style.bold : style.dim))
    else {
      const isSelected = e.line.id === selected?.id
      const start = body.length
      body.push(...drawLine(e.line, isSelected, d))
      if (isSelected) selectedAt = [start, body.length - 1]
    }
  }
  const foot = footer(d)
  const room = height === undefined ? Infinity : Math.max(6, height - head.length - foot.length)
  const shown = body.length > room ? scrolled(body, selectedAt, room, style) : body

  return [...head, ...shown, ...foot].map(l => fit(l, width))
}

function scrolled(body: string[], selectedAt: number[], room: number, s: Style): string[] {
  const [first = 0, last = 0] = selectedAt
  let start = Math.min(Math.max(0, first - 1), body.length - room)
  if (last > start + room - 2) start = Math.min(Math.max(first, last - room + 2), body.length - room)
  const end = start + room
  const clip = body.slice(start, end)
  if (start > 0) clip[0] = s.dim(`  ↑ ${start} more lines`)
  if (end < body.length) clip[clip.length - 1] = s.dim(`  ↓ ${body.length - end} more lines`)

  return clip
}

/** The two counts the band above the prompt shows, or null when nothing needs the person. */
export function bandLine(screen: PanelScreen, width: number, style: Style): string {
  const { needsYou, findings } = screen.view
  const counts = TABS.filter(t => t.id !== 'prs')
    .map(t => ({ t, count: t.id === 'needsYou' ? needsYou.count : findings.count }))
    .filter(x => x.count > 0)
    .map(x => `${style.dim(x.t.label)} ${style.tone(x.t.id, String(x.count))}`)
  const left = ` ${counts.length > 0 ? counts.join(` ${style.tone('sep', '·')} `) : style.dim('Nothing needs you')}`

  return spread(left, style.dim('/inbox to open '), width)
}
