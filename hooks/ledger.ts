import type { Card, Closed, ClosedFinding, Finding, Help, Item, Ledger } from '../types'
import type { Host } from './model-text'
import { clip, codeBlocks } from './text'

export const EMPTY: Ledger = {
  card: null,
  items: [],
  closed: [],
  findings: [],
  closedFindings: [],
  prs: [],
  nextId: 1,
  turn: 0,
  batchTurn: 0,
}

const NL = '\n'
const MAX_OPEN = 20
/** Prompts after which an unanswered item is dropped as moot. */
const STALE_AFTER = 12
const MAX_CLOSED = 12
/** The outcome of an item left unanswered until it went stale. */
const EXPIRED = 'expired, unanswered'
const MAX_HELPS = 3
const MAX_FINDINGS = 30

/** Reads a kind the model wrote or an older version saved; anything but a task is a question. */
export function readKind(kind: string | null | undefined): Item['kind'] {
  return kind === 'task' || kind === 'do' ? 'task' : 'question'
}

/**
 * A ledger saved by an earlier version of the mod, in the current shape.
 * Findings were once saved as `notes`; items once had no time, and closed
 * items no kind or `how`, so an old closed item counts as a question. Closed
 * items were saved as `decided`, and kinds as `decide` and `do`. Closed
 * findings were once not kept.
 */
export function upgradeLedger(ledger: Ledger): Ledger {
  const { notes, decided, ...rest } = ledger as Ledger & { notes?: Finding[]; decided?: Ledger['closed'] }

  return {
    ...rest,
    findings: [...(rest.findings ?? []), ...(notes ?? [])],
    // reopenFinding puts these back, so a conversion added for findings must run on them too.
    closedFindings: rest.closedFindings ?? [],
    items: rest.items.map(upgradeItem),
    closed: (rest.closed ?? decided ?? []).map(d => ({
      ...d,
      kind: readKind(d.kind),
      how: d.how ?? howFromOutcome(d.outcome),
      ...(d.item ? { item: upgradeItem(d.item) } : {}),
    })),
  }
}

/** An open item in the current shape. Also run on the copy a close record keeps, which reopenItem puts back. */
function upgradeItem(item: Item): Item {
  return { ...item, kind: readKind(item.kind), at: item.at ?? null, rec: recommendedOption(item.options, item.rec) }
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * The option a recommendation names: the one whose words all appear in it,
 * the longest when several do. "Symlink into a PATH folder" names "Symlink
 * into PATH". Null when it names none, since a recommendation that is not one
 * of the answers came from the wrong field or from no recommendation at all.
 */
export function recommendedOption(options: string[], rec: string | null): string | null {
  if (!rec) return null
  const named = new Set(words(rec))
  let best: string | null = null
  for (const option of options) {
    const w = words(option)
    if (w.length > words(best ?? '').length && w.every(x => named.has(x))) best = option
  }
  // "A" names "A: Cancel button" by the letter or number the reply labeled it with.
  const label = (text: string) => text.match(/^\s*\(?([a-z]|\d{1,2})\s*[:.)]/i)?.[1]?.toLowerCase()
  const byLabel = /^\s*(?:option\s+)?([a-z]|\d{1,2})\s*[.!]?\s*$/i.exec(rec)?.[1]?.toLowerCase()

  return best ?? (byLabel ? (options.find(o => label(o) === byLabel) ?? null) : null)
}

/** How a closed item saved before `how` existed closed, read from its outcome's wording. */
function howFromOutcome(outcome: string): Closed['how'] {
  if (outcome === 'dismissed') return 'dismissed'
  if (outcome === EXPIRED) return 'expired'
  if (outcome === 'done' || outcome === 'you ran it') return 'done'
  if (outcome.startsWith(CLOSED_BY_CLAUDE)) return 'claude'

  return 'update'
}
/**
 * Commands that sign in or ask for a password. They need the person's own
 * terminal, so their button copies them instead of asking Claude to run them.
 * Each word counts only as a command or subcommand, as in `gh auth login`, so a
 * path or URL holding it, as in `curl https://x/login`, stays the agent's to run.
 */
const NEEDS_PERSON =
  /(?:^|[\s;&|])(?:login|logout|signin|sign-in|sudo|passwd|ssh-add|ssh-keygen)(?=[\s:]|$)|\binit --interactive\b/i

/**
 * Words a reply uses when only the person can run a command: their credentials, device or account. The inbox
 * model sometimes marks a command the reply merely asks the person to run as theirs, so a terminal step in a
 * reply with none of these words is the agent's to run.
 */
const PERSON_ONLY_REASON =
  /credential|password|passphrase|secret|\btoken|\b2fa\b|\bmfa\b|\bdevice\b|phone|android|tablet|account|sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in|only you|you hold|your (?:mac|machine|laptop|computer|keychain)|\bsudo\b/i

export type Exchange = {
  /** What the person typed; null when something else started the turn. */
  person: string | null
  /** What started the turn when the person didn't (a task notification, a peer). */
  trigger: string | null
  activity: string[]
  reply: string
  /** The person-prompt count when the reply was written. */
  turn: number
  /** The item button the person pressed to send this turn's prompt, if any. */
  press: Press | null
  /** What the person has on screen besides the conversation, from screenText. */
  screen: string
}

/** A prompt the mod sent for an item: an answer, an Explain, a Run, or the message for a Done. */
export type Press = { id: string; action: 'answer' | 'explain' | 'run' | 'done' }

export type Update = {
  card: Card
  closed: { id: string; outcome: string }[]
  added: (Omit<Item, 'id' | 'turn' | 'at' | 'helps'> & { helps: Help[] })[]
  /** Helps for items already open. */
  helped: { id: string; help: Help }[]
  /** New options or a new recommendation for open questions. Null keeps what the question has. */
  updated: { id: string; options: string[] | null; rec: string | null }[]
  /** Findings an item now asks about: an open item's id, or the place of a NEW item in `added`. */
  asked: { id: string; item: string | number }[]
  /** Work the person set aside for later, from TODO lines. Each becomes a question about starting it. */
  todos: string[]
}

/**
 * Checks one HELP line; null when it is unusable. A path, command, URL or line
 * of text must appear in `source`, the reply and activity, so the model cannot
 * invent one. A null source (a catch-up over the whole conversation) skips that.
 */
function readHelp(
  kind: string,
  value: string,
  name: string | null,
  blocks: string[],
  source: string | null,
): Help | null {
  const isQuoted = (text: string) => source === null || source.includes(text)
  // "block N" names a code block of the reply, already quoted; anything else is the value as written.
  const block = value.match(/^block\s+(\d+)$/i)
  const quoted = block ? (blocks[Number(block[1]) - 1] ?? '') : value.replace(/^`|`$/g, '')
  const isFromReply = (text: string) => block !== null || isQuoted(text)
  if (kind === 'open') {
    const path = value.replace(/^`|`$/g, '')
    // A bare word such as "migrations" can appear in any reply, so a path needs a "/", "." or "~" and must stand alone.
    const isPath = /[/.~]/.test(path) && !/^[a-z]+:/i.test(path) && path.length <= 300
    const standsAlone = (text: string) => new RegExp(`(?<![\\w.~-])${escaped(path)}(?![\\w/-])`).test(text)
    return isPath && (source === null || standsAlone(source)) ? { kind, path } : null
  }
  if (kind === 'copy') {
    return quoted.trim() !== '' && quoted.length <= 8000 && isFromReply(quoted) ? { kind, text: quoted, name } : null
  }
  if (kind === 'run' || kind === 'terminal') {
    const command = commandText(quoted)
    const isUsable = command !== '' && command.length <= 4000 && isFromReply(command)
    const isTheirs =
      NEEDS_PERSON.test(command) || (kind === 'terminal' && (source === null || PERSON_ONLY_REASON.test(source)))
    return isUsable ? { kind: isTheirs ? 'terminal' : 'run', command, name } : null
  }
  if (kind === 'link') {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && isQuoted(value) ? { kind, url: url.href, name } : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * A HELP line's value and name, from the fields after its kind. A command can hold "|" itself, so the whole tail
 * is the value when the reply quotes it so; otherwise the last field is the name and the fields before it the value.
 */
function helpFields(tail: string[], source: string | null): { help: string; name: string | null } {
  const whole = tail.join('|').trim()
  if (tail.length <= 1 || (source !== null && source.includes(commandText(whole.replace(/^`|`$/g, '')))))
    return { help: whole, name: null }

  return { help: tail.slice(0, -1).join('|').trim(), name: dash(tail.at(-1)) }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A command as written, without surrounding space or a leading `!`. */
function commandText(text: string): string {
  return text.trim().replace(/^!\s*/, '')
}

/** The command a help runs or copies, so a copy of a command yields to its command button. */
function commandOf(help: Help): string | null {
  if (isCommand(help)) return help.command
  if (help.kind === 'copy') return commandText(help.text)

  return null
}

function isCommand(help: Help): help is Extract<Help, { kind: 'run' | 'terminal' }> {
  return help.kind === 'run' || help.kind === 'terminal'
}

/** What a help acts on, without the name the model gave it, so one command under two names counts once. */
function helpTarget(help: Help): string {
  if (help.kind === 'open') return `open ${help.path}`
  if (help.kind === 'link') return `link ${help.url}`

  return `command ${commandOf(help)}`
}

function withHelp(helps: Help[], help: Help): Help[] {
  const command = commandOf(help)
  const kept = isCommand(help) ? helps.filter(h => h.kind !== 'copy' || commandOf(h) !== command) : helps
  // A copy and a run of one command share a target, so either covers the other.
  const isCovered = kept.some(h => helpTarget(h) === helpTarget(help))

  return isCovered || kept.length >= MAX_HELPS ? kept : [...kept, help]
}

/**
 * The open tasks a shell command the person ran completes: those whose run or
 * sign-in step is that exact command, so nothing closes on a guess.
 */
export function tasksRunBy(ledger: Ledger, command: string): Item[] {
  const typed = squash(command)

  return ledger.items.filter(i => i.kind === 'task' && i.helps.some(h => isCommand(h) && squash(h.command) === typed))
}

function squash(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function dash(value: string | undefined): string | null {
  const v = (value ?? '').trim()

  return v === '' || v === '-' ? null : v
}

const KEY_LINE = /^\s*[-*]?\s*(GOAL|DONE|NOW|RUNNING|CLOSED|FIXED|ASKED|NEW|UPDATE|HELP|TODO)\s*:\s*(.*)$/

/**
 * Reads the model's line format; null when no known key appears. `source` is
 * the reply followed by the activity: HELP values must appear in it, and
 * "copy | block N" names its code blocks. Null skips both, so block copies drop.
 */
export function parseReply(text: string, source: string | null = null): Update | null {
  const blocks = source === null ? [] : codeBlocks(source)
  const card = { goal: '', done: [] as string[], now: '', running: [] as string[] }
  const closed: Update['closed'] = []
  const added: Update['added'] = []
  const helped: Update['helped'] = []
  const updated: Update['updated'] = []
  const helps: { target: string; help: Help }[] = []
  const asks: { id: string; target: string }[] = []
  const todos: string[] = []
  let seen = 0
  const lines = text.split(NL)
  // The model sometimes writes an answer, then a correction and a whole second answer. Each answer starts with
  // GOAL, so only the lines from the last GOAL on are the answer it settled on.
  const lastGoal = lines.findLastIndex(line => KEY_LINE.exec(line)?.[1] === 'GOAL')
  // The item each NEW line made, by its place among the NEW lines, as HELP's "new N" counts them.
  const newLines: (Update['added'][number] | undefined)[] = []

  for (const raw of lines.slice(Math.max(lastGoal, 0))) {
    const m = KEY_LINE.exec(raw)
    if (!m) continue
    seen += 1
    const key = m[1]
    // The model writes "-" for "nothing", for a whole value ("NOW: -") or one field ("NEW: do | - | - | - | -").
    const value = dash(m[2]) ?? ''
    if (key === 'GOAL') card.goal = value
    else if (key === 'NOW') card.now = value
    else if (key === 'DONE' && value) card.done.push(value)
    else if (key === 'RUNNING' && value) card.running.push(value)
    else if (key === 'CLOSED' || key === 'FIXED') {
      // CLOSED closes items and FIXED closes findings, so a finding the person only put off stays open.
      const [id, outcome] = value.split('|').map(s => s.trim())
      if (id && /^f\d/.test(id) === (key === 'FIXED')) closed.push({ id, outcome: outcome ?? '' })
    } else if (key === 'ASKED') {
      const [id, target] = value.split('|').map(s => s.trim())
      if (id && /^f\d+$/.test(id) && target) asks.push({ id, target })
    } else if (key === 'NEW') {
      // The recommendation is the last field. The model sometimes writes one answer after "|" instead of " / ".
      const fields = value.split('|')
      // The model sometimes leaves out the label, as in "NEW: do | Run the migration | - | - | -". A label
      // field holding a phrase, with no ask after it, is the ask.
      const isLabelSkipped = !dash(fields[2]) && /\s/.test((fields[1] ?? '').trim())
      const [kind, label, ask, ...rest] = (isLabelSkipped ? [fields[0], '-', ...fields.slice(1)] : fields).map(dash)
      const rec = rest.length > 1 ? rest.pop() : null
      if (!ask) {
        newLines.push(undefined)
        continue
      }
      const options = rest.flatMap(o => o?.split(/\s+\/\s+/) ?? []).filter(Boolean)
      const item = {
        kind: readKind(kind),
        label: label ?? null,
        ask,
        options,
        rec: recommendedOption(options, rec ?? null),
        helps: [],
      }
      added.push(item)
      newLines.push(item)
    } else if (key === 'TODO' && value && !isTakenUp(value, source)) {
      todos.push(value)
    } else if (key === 'UPDATE') {
      const [target, options, rec] = value.split('|').map(dash)
      const id = target?.match(/\b(i\d+)\b/)?.[1]
      if (id)
        updated.push({ id, options: options ? options.split(/\s+\/\s+/).filter(Boolean) : null, rec: rec ?? null })
    } else if (key === 'HELP') {
      const [target, kind, ...tail] = value.split('|')
      const { help, name } = helpFields(tail, source)
      const parsed = readHelp((kind ?? '').trim(), help, name, blocks, source)
      if (parsed && target) helps.push({ target: target.trim(), help: parsed })
    }
  }
  // HELP lines name their item, and may come before or after its NEW line.
  for (const { target, help } of helps) {
    // Lenient about extra words: the model sometimes writes "open i9" for "i9".
    const n = target.match(/\bnew\s*(\d+)\b/i)
    const id = target.match(/\b(i\d+)\b/)?.[1]
    const item = n ? newLines[Number(n[1]) - 1] : undefined
    if (item) item.helps = withHelp(item.helps, help)
    else if (!n && id) helped.push({ id, help })
  }
  const asked: Update['asked'] = []
  for (const { id, target } of asks) {
    const n = target.match(/\bnew\s*(\d+)\b/i)
    const item = n ? added.indexOf(newLines[Number(n[1]) - 1]!) : target.match(/\b(i\d+)\b/)?.[1]
    if (item !== undefined && item !== -1) asked.push({ id, item })
  }

  return seen === 0
    ? null
    : { card: { ...card, done: card.done.slice(-4) }, closed, added, helped, updated, asked, todos }
}

/**
 * Whether the reply already names most of a todo's key words, as "Added --verbose" does for "add a --verbose flag".
 * The model writes TODO lines for work the reply just did.
 */
function isTakenUp(work: string, reply: string | null): boolean {
  const key = [...keyWords(work)]
  const said = new Set(words(reply ?? ''))

  return key.length > 0 && key.filter(w => said.has(w)).length * 2 >= key.length
}

/** The question a todo the person set aside becomes. */
export function todoAsk(work: string): string {
  return `Ready to start on ${work.replace(/[.?!\s]+$/, '')}?`
}

const FILLER = new Set([
  'the',
  'and',
  'for',
  'with',
  'use',
  'into',
  'from',
  'that',
  'this',
  'your',
  'you',
  'should',
  'make',
  'add',
  'all',
])

/** The words that carry an ask's meaning. Numbers stay whatever their length, since "PR #41" is not "PR #42". */
function keyWords(text: string): Set<string> {
  return new Set(words(text).filter(w => /\p{N}/u.test(w) || (w.length > 2 && !FILLER.has(w))))
}

/**
 * Whether one ask rewords the other: most of the shorter one's key words
 * appear in the longer. Asks with one key word only match exactly, since
 * "Deploy?" and "Deploy now?" can be different questions.
 */
function restates(a: string, b: string): boolean {
  const x = keyWords(a)
  const y = keyWords(b)
  const fewer = Math.min(x.size, y.size)
  const shared = [...x].filter(w => y.has(w)).length
  const numbers = (words: Set<string>) =>
    [...words]
      .filter(w => /\p{N}/u.test(w))
      .sort()
      .join(' ')
  // Asks that name different numbers, such as two PRs, are different questions however alike their words.
  if (numbers(x) !== '' && numbers(y) !== '' && numbers(x) !== numbers(y)) return false

  return fewer >= 2 ? shared / fewer >= 0.7 : sameAsk(a, b)
}

function sameAsk(a: string, b: string): boolean {
  const norm = (s: string) => words(s).join(' ')

  return norm(a) !== '' && norm(a) === norm(b)
}

/**
 * The open item a NEW line repeats, if any. The summary model often restates
 * an open item, labelled with its id or reworded, instead of leaving it alone.
 */
function matchOpen(items: Pick<Item, 'id' | 'kind' | 'ask'>[], a: Update['added'][number]): number {
  return items.findIndex(
    i => i.id === a.label || sameAsk(i.ask, a.ask) || (i.kind === a.kind && restates(i.ask, a.ask)),
  )
}

/** Whether a NEW line repeats an item that closed at or after `since`, by matchOpen's rule or its label. */
function repeatsRecentlyClosed(closed: Closed[], a: Update['added'][number], since: number): boolean {
  const recent = closed.filter(c => c.at >= since)

  return matchOpen(recent, a) >= 0 || (a.label !== null && recent.some(c => c.label === a.label))
}

function closedRecord(item: Item, closing: Closing, now: number): Closed {
  const { id, kind, ask, label } = item

  return { id, kind, ask, ...(label ? { label } : {}), ...closing, at: now, item }
}

function closedFindingRecord(finding: Finding, closing: Closing, now: number): ClosedFinding {
  return { ...finding, ...closing, closedAt: now }
}

/** How an outcome the mod saved before `how` existed marks an item Claude closed. */
const CLOSED_BY_CLAUDE = 'closed by Claude'

/**
 * Closes an open item or finding for the agent: one the user answered in their
 * own message, with that answer as its outcome, or one that is done or no
 * longer applies, with the agent's reason. A finding moves to
 * `closedFindings` the same way. `closed` is null when no open one has the id.
 * Its `how` is the stored value 'claude' for either agent.
 */
export function closeByAgent(
  host: Host,
  ledger: Ledger,
  id: string,
  how: { answer: string } | { reason: string },
  now: number,
): { ledger: Ledger; closed: 'item' | 'finding' | null } {
  const closing: Closing =
    'answer' in how
      ? { how: 'answered', outcome: how.answer }
      : { how: 'claude', outcome: `closed by ${host.agent}: ${how.reason}` }
  if (ledger.items.some(i => i.id === id)) return { ledger: closeItem(ledger, id, closing, now), closed: 'item' }
  if (ledger.findings.some(f => f.id === id))
    return { ledger: closeFinding(ledger, id, closing, now), closed: 'finding' }

  return { ledger, closed: null }
}

/** How an item is closing: what the pane shows, and how it closed. */
export type Closing = Pick<Closed, 'how' | 'outcome'>

/** Closes one item, recording how it closed. */
export function closeItem(ledger: Ledger, id: string, closing: Closing, now: number): Ledger {
  return {
    ...ledger,
    items: ledger.items.filter(i => i.id !== id),
    closed: [...ledger.closed, ...ledger.items.filter(i => i.id === id).map(i => closedRecord(i, closing, now))].slice(
      -MAX_CLOSED,
    ),
  }
}

/** Closes one finding, recording how it closed. */
export function closeFinding(ledger: Ledger, id: string, closing: Closing, now: number): Ledger {
  const finding = ledger.findings.find(f => f.id === id)
  if (!finding) return ledger

  return {
    ...ledger,
    findings: ledger.findings.filter(f => f.id !== id),
    closedFindings: [...ledger.closedFindings, closedFindingRecord(finding, closing, now)].slice(-MAX_CLOSED),
  }
}

/** The number in an id, as 10 in "i10"; NaN for an id with none. */
function idNumber(id: string): number {
  return Number(id.match(/\d+/)?.[0] ?? Number.NaN)
}

/**
 * Puts an entry back among open ones by its id's number, so "i2" goes before
 * "i10". Order matters: answerNote reads the batch by position, and expiry
 * keeps the last MAX_OPEN items.
 */
function inIdOrder<T extends { id: string }>(open: T[], entry: T): T[] {
  const at = open.findIndex(x => idNumber(x.id) > idNumber(entry.id))

  return at < 0 ? [...open, entry] : [...open.slice(0, at), entry, ...open.slice(at)]
}

/**
 * Reopens a closed item from the item its close record kept, and removes the
 * record. Unchanged when the item is open, or no record of it kept the item.
 */
export function reopenItem(ledger: Ledger, id: string): Ledger {
  const item = ledger.closed.findLast(c => c.id === id)?.item
  if (!item || ledger.items.some(i => i.id === id)) return ledger

  return { ...ledger, items: inIdOrder(ledger.items, item), closed: ledger.closed.filter(c => c.id !== id) }
}

/** Reopens a closed finding and removes its close record. Unchanged when it is open or has no record. */
export function reopenFinding(ledger: Ledger, id: string): Ledger {
  const record = ledger.closedFindings.findLast(f => f.id === id)
  if (!record || ledger.findings.some(f => f.id === id)) return ledger
  const { how: _how, outcome: _outcome, closedAt: _closedAt, ...finding } = record

  return {
    ...ledger,
    findings: inIdOrder(ledger.findings, finding),
    closedFindings: ledger.closedFindings.filter(f => f.id !== id),
  }
}

export function applyExchangeUpdate(
  ledger: Ledger,
  update: Update,
  exchange: Exchange,
  now: number,
  promptAt: number,
): Ledger {
  const explainedId = exchange.press?.action === 'explain' ? exchange.press.id : null

  return applyUpdate(
    ledger,
    { ...update, closed: update.closed.filter(c => c.id !== explainedId) },
    now,
    exchange.turn,
    promptAt,
  )
}

/**
 * `promptAt` is when the update's prompt was built. A NEW line that repeats an
 * item closed since then is dropped: the person answered it while the model ran.
 */
export function applyUpdate(ledger: Ledger, u: Update, now: number, turn: number, promptAt = now): Ledger {
  const prev = ledger.card
  const card: Card = {
    goal: u.card.goal || prev?.goal || '',
    done: u.card.done.length > 0 ? u.card.done : (prev?.done ?? []),
    now: u.card.now || prev?.now || '',
    running: u.card.running,
  }
  // An UPDATE says its question still waits, so it outweighs a CLOSED line for the same question.
  const stillAsked = new Set(u.updated.filter(c => c.options || c.rec).map(c => c.id))
  const closing = new Map(u.closed.filter(c => !stillAsked.has(c.id)).map(c => [c.id, c.outcome]))
  const closed = [...ledger.closed]
  const items: Item[] = []
  for (const item of ledger.items) {
    const outcome = closing.get(item.id)
    const helps = u.helped.filter(h => h.id === item.id).reduce((all, h) => withHelp(all, h.help), item.helps)
    if (outcome === undefined) items.push(withUpdate({ ...item, helps }, u.updated))
    else closed.push(closedRecord(item, { outcome, how: 'update' }, now))
  }

  let nextId = ledger.nextId
  let added = 0
  // The open item each NEW line became, by its place in u.added; null for one dropped as recently closed.
  const addedIds: (string | null)[] = []
  const created = new Set<string>()
  for (const a of u.added) {
    if (repeatsRecentlyClosed(ledger.closed, a, promptAt)) {
      addedIds.push(null)
      continue
    }
    const at = matchOpen(items, a)
    const restated = items[at]
    if (restated) {
      items[at] = { ...restated, helps: a.helps.reduce((all, h) => withHelp(all, h), restated.helps) }
      addedIds.push(restated.id)
      continue
    }
    items.push({ ...a, id: `i${nextId}`, turn, at: now })
    addedIds.push(`i${nextId}`)
    created.add(`i${nextId}`)
    nextId += 1
    added += 1
  }
  // Every todo asks the same question, built here. The model sometimes reads work the person puts off as a todo,
  // so a todo that rewords an open item or finding, or one closed while the model ran, adds nothing.
  for (const work of u.todos) {
    const todo = {
      kind: 'question' as const,
      label: null,
      ask: todoAsk(work),
      options: ['Proceed', 'Not yet'],
      rec: null,
    }
    const isKnown =
      items.some(i => restates(i.ask, work)) ||
      ledger.findings.some(f => restates(f.title, work)) ||
      repeatsRecentlyClosed(ledger.closed, { ...todo, helps: [] }, promptAt)
    if (isKnown) continue
    items.push({ ...todo, helps: [], id: `i${nextId}`, turn, at: now })
    nextId += 1
    added += 1
  }

  // An item left unanswered too long, or pushed out by newer ones, closes as expired.
  const kept = items.filter(i => turn - i.turn <= STALE_AFTER).slice(-MAX_OPEN)
  for (const i of items) if (!kept.includes(i)) closed.push(closedRecord(i, { outcome: EXPIRED, how: 'expired' }, now))

  // A finding an open item asks about closes into that item, so one thing shows in one list. The model names
  // the pairs in ASKED lines; a new item that rewords a finding's title closes it without one.
  const askedBy = new Map<string, string>()
  for (const a of u.asked) {
    const id = typeof a.item === 'number' ? addedIds[a.item] : a.item
    if (id && kept.some(i => i.id === id)) askedBy.set(a.id, id)
  }
  for (const i of kept.filter(i => created.has(i.id)))
    for (const f of ledger.findings) if (!askedBy.has(f.id) && restates(f.title, i.ask)) askedBy.set(f.id, i.id)
  const { findings, closedFindings } = ledger.findings.reduce((l, f) => {
    const asker = askedBy.get(f.id)
    const outcome = closing.get(f.id) ?? (asker ? `asked as ${asker}` : undefined)

    return outcome === undefined ? l : closeFinding(l, f.id, { outcome, how: 'update' }, now)
  }, ledger)

  return {
    ...ledger,
    card,
    items: kept,
    closed: closed.slice(-MAX_CLOSED),
    findings,
    closedFindings,
    nextId,
    batchTurn: added > 0 ? turn : ledger.batchTurn,
  }
}

/**
 * A question with the options and recommendation an UPDATE line gives it. A recommendation is kept only while it
 * is one of the options, so new options without a new recommendation drop one that no longer fits.
 */
function withUpdate(item: Item, updated: Update['updated']): Item {
  const change = updated.findLast(c => c.id === item.id)
  if (!change || item.kind !== 'question') return item
  const options = change.options ?? item.options

  return { ...item, options, rec: recommendedOption(options, change.rec ?? item.rec) }
}

/**
 * Adds a finding Claude recorded. One whose title matches an open finding, or
 * rewords an open item's ask, is skipped, so one thing shows in one list. When
 * the list is full, the oldest finding closes as expired to make room.
 */
export function addFinding(
  ledger: Ledger,
  finding: Omit<Finding, 'id'>,
): { ledger: Ledger; id: string; isAdded: boolean; expired: Finding | null } {
  const same =
    ledger.findings.find(f => sameAsk(f.title, finding.title)) ?? ledger.items.find(i => restates(i.ask, finding.title))
  if (same) return { ledger, id: same.id, isAdded: false, expired: null }
  const id = `f${ledger.nextId}`
  const expired = ledger.findings.length >= MAX_FINDINGS ? ledger.findings[0]! : null
  const room = expired ? closeFinding(ledger, expired.id, { how: 'expired', outcome: 'list full' }, finding.at) : ledger

  return {
    ledger: { ...room, findings: [...room.findings, { ...finding, id }], nextId: ledger.nextId + 1 },
    id,
    isAdded: true,
    expired,
  }
}

/** How an item or finding ended: handled, set aside by the person, or overtaken without anyone deciding it. */
export type ClosedState = 'handled' | 'dismissed' | 'lapsed'

export function closedState(d: Pick<Closed, 'how' | 'outcome'>): ClosedState {
  if (d.how === 'dismissed') return 'dismissed'
  if (d.how === 'expired') return 'lapsed'
  // The agent's close and the per-reply update write their own outcome, so only its wording says the work
  // overtook the item. An agent's close reads "closed by <agent>: <reason>".
  const isOvertaken = /^(?:closed by \w+: )?(?:no longer applies|replaced|superseded|moot)/i.test(d.outcome)

  return (d.how === 'claude' || d.how === 'update') && isOvertaken ? 'lapsed' : 'handled'
}

/** An item that closed without being handled: dismissed, expired, or overtaken by the work. */
export function isLapsed(d: Pick<Closed, 'how' | 'outcome'>): boolean {
  return closedState(d) !== 'handled'
}
