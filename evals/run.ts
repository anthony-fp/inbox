import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { applyExchangeUpdate, EMPTY, parseReply } from '../hooks/ledger'
import { buildPrompt, CLAUDE_CODE, systemText, transcriptCatchUpPrompt } from '../hooks/model-text'
import type { Exchange } from '../hooks/ledger'
import type { Ledger } from '../types'
import { run } from '../codex/src/run'
import { codexAsk, MODEL } from '../codex/src/update'
import { codexCli } from './codex-cli'
import { provenance, report, runCount, runJobs, selectCases, writeResults } from './harness'
import type { Run } from './harness'

type Agent = 'claude' | 'codex'

/** Patterns are case-insensitive regular expressions. */
type Check =
  | { open: string }
  | { closed: string; outcome?: string }
  | { added: number }
  | { done: string }
  | { new: string; kind?: 'question' | 'task'; rec?: string | null; help?: string }
  | { notNew: string }
  | { noHelp: string }
  | { item: string; rec?: string; options?: string }
  | { waiting: string; options?: string; rec?: string }
  | { openItems: number }

type Case = {
  name: string
  about: string
  ledger: Partial<Ledger>
  exchange: Partial<Exchange> & { reply: string }
  /** A conversation to catch the ledger up on, in place of the exchange's per-reply update. */
  catchUp?: string
  checks: Check[]
  min?: Partial<Record<Agent, number>>
}

const MIN = 0.75
const NOW = 100

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'both' },
    runs: { type: 'string', default: '8' },
    case: { type: 'string' },
    out: { type: 'string' },
    cases: { type: 'string', default: 'evals/cases.json' },
  },
})
const AGENTS: Record<string, Agent[]> = { both: ['claude', 'codex'], claude: ['claude'], codex: ['codex'] }
const selected = AGENTS[values.agent]
if (!selected) throw new Error(`Unknown --agent ${values.agent}. Use claude, codex or both.`)
const agents: Agent[] = selected
const runs = runCount(values.runs)
const cases: Case[] = selectCases(JSON.parse(readFileSync(values.cases, 'utf8')), values.case)

type Answer = { text: string | null; model: string | null }

/**
 * Sonnet as the mod calls it: at low effort, and with no settings, so the runner's own CLAUDE.md never reaches it.
 */
function claude(prompt: string): Promise<Answer> {
  return new Promise(resolve => {
    const child = execFile(
      'claude',
      [
        '-p',
        '--model',
        'sonnet',
        '--effort',
        'low',
        '--setting-sources',
        '',
        '--tools',
        '',
        '--output-format',
        'json',
        '--system-prompt',
        systemText(CLAUDE_CODE),
      ],
      { maxBuffer: 1 << 22, timeout: 300_000, cwd: mkdtempSync(join(tmpdir(), 'inbox-eval-claude-')) },
      (err, out) => {
        if (err) return resolve({ text: null, model: null })
        try {
          const parsed: unknown = JSON.parse(out)
          const events = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, any>[]
          const result = events.find(e => e.type === 'result')
          const model = events.find(e => e.type === 'system' && e.subtype === 'init')?.model ?? null
          resolve({ text: result && !result.is_error ? String(result.result) : null, model })
        } catch {
          resolve({ text: null, model: null })
        }
      },
    )
    child.stdin?.end(prompt)
  })
}

/**
 * A Codex home that holds only the sign-in, so the runner's own AGENTS.md never reaches the model. Codex reads
 * `~/.codex/AGENTS.md` even with `--ignore-user-config` and `project_doc_max_bytes=0`.
 */
function codexHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'inbox-eval-codex-home-'))
  const auth = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json')
  if (existsSync(auth)) symlinkSync(auth, join(home, 'auth.json'))

  return home
}

// The product's codex call inherits this process's environment, so the eval points it at the bare home.
if (agents.includes('codex')) process.env.CODEX_HOME = codexHome()
const askCodex = codexAsk(run, codexCli, mkdtempSync(join(tmpdir(), 'inbox-eval-')))

function failures(before: Ledger, after: Ledger, checks: Check[]): string[] {
  const has = (pattern: string, text: string | null) => text !== null && new RegExp(pattern, 'i').test(text)
  const added = after.items.filter(i => !before.items.some(b => b.id === i.id))
  const isOpen = (id: string) => after.items.some(i => i.id === id) || after.findings.some(f => f.id === id)
  const closedOutcome = (id: string) =>
    after.closed.find(c => c.id === id)?.outcome ?? after.closedFindings.find(f => f.id === id)?.outcome ?? null
  const finished = (after.card?.done ?? []).filter(line => !(before.card?.done ?? []).includes(line))
  const out: string[] = []
  for (const c of checks) {
    if ('open' in c && !isOpen(c.open)) out.push(`${c.open} closed`)
    else if ('closed' in c) {
      const outcome = closedOutcome(c.closed)
      if (outcome === null) out.push(`${c.closed} still open`)
      else if (c.outcome && !has(c.outcome, outcome)) out.push(`${c.closed} closed as "${outcome}"`)
    } else if ('added' in c && added.length !== c.added) out.push(`${added.length} items added`)
    else if ('done' in c && !finished.some(line => has(c.done, line)))
      out.push(`no done line like /${c.done}/: ${finished.map(line => `"${line}"`).join(', ')}`)
    else if ('new' in c) {
      const match = added.find(
        i =>
          has(c.new, i.ask) &&
          (!c.kind || i.kind === c.kind) &&
          (c.rec === undefined || (c.rec === null ? i.rec === null : has(c.rec, i.rec))) &&
          (!c.help || i.helps.some(h => h.kind === c.help)),
      )
      if (!match)
        out.push(
          `no new item like /${c.new}/: ${added.map(i => `"${i.ask}" kind=${i.kind} rec=${i.rec} helps=${i.helps.map(h => h.kind).join('+') || '-'}`).join(', ')}`,
        )
    } else if ('notNew' in c && added.some(i => has(c.notNew, i.ask))) out.push(`added an item like /${c.notNew}/`)
    else if ('noHelp' in c && added.some(i => i.helps.some(h => h.kind === c.noHelp))) out.push(`a ${c.noHelp} step`)
    else if ('waiting' in c) {
      const match = after.items.find(
        i =>
          has(c.waiting, i.ask) &&
          (!c.options || has(c.options, i.options.join(' / '))) &&
          (!c.rec || has(c.rec, i.rec)),
      )
      if (!match)
        out.push(
          `no open item like /${c.waiting}/: ${after.items.map(i => `"${i.ask}" options=${i.options.join(' / ')} rec=${i.rec}`).join(', ')}`,
        )
    } else if ('openItems' in c && after.items.length !== c.openItems)
      out.push(`${after.items.length} open items: ${after.items.map(i => `"${i.ask}"`).join(', ')}`)
    else if ('item' in c) {
      const item = after.items.find(i => i.id === c.item)
      if (!item) out.push(`${c.item} closed`)
      else if (c.rec && !has(c.rec, item.rec)) out.push(`${c.item} rec=${item.rec}`)
      else if (c.options && !has(c.options, item.options.join(' / ')))
        out.push(`${c.item} options ${item.options.join(' / ')}`)
    }
  }

  return out
}

/** `masked`: NEW lines in the answer that the code dropped before the checks, for reading only. */
type Result = Run & { answer: string | null; masked: number }

/** NEW lines the answer wrote, against the items its update added. */
function maskedCount(answer: string, before: Ledger, after: Ledger): number {
  const written = answer.split('\n').filter(l => /^\s*[-*]?\s*NEW\s*:/.test(l)).length
  const added = after.items.filter(i => !before.items.some(b => b.id === i.id)).length

  return Math.max(0, written - added)
}

async function once(agent: Agent, c: Case, n: number): Promise<Result> {
  const ledger = { ...EMPTY, ...c.ledger } as Ledger
  const ex: Exchange = {
    person: null,
    trigger: null,
    activity: [],
    turn: ledger.turn,
    press: null,
    screen: agent === 'codex' ? 'The Inbox tab is closed.' : 'The /inbox pane is closed.',
    ...c.exchange,
  }
  const prompt =
    c.catchUp === undefined ? buildPrompt(ledger, ex) : transcriptCatchUpPrompt(ledger, ex.screen, c.catchUp)
  const { text: answer, model } =
    agent === 'codex' ? { text: await askCodex(prompt), model: MODEL } : await claude(prompt)
  const base = { agent, name: c.name, run: n, model, answer, attempts: 1 }
  if (answer === null) return { ...base, error: `${agent} gave no answer`, failed: [], masked: 0 }
  const update = parseReply(answer, c.catchUp ?? `${ex.reply}\n${ex.activity.join('\n')}`)
  if (update === null) return { ...base, error: null, failed: ['no answer the mod can read'], masked: 0 }
  const after = applyExchangeUpdate(ledger, update, ex, NOW, NOW)

  return { ...base, error: null, failed: failures(ledger, after, c.checks), masked: maskedCount(answer, ledger, after) }
}

const about = provenance('model', { claude: 'claude', codex: codexCli })
const jobs = agents.flatMap(a => cases.flatMap(c => Array.from({ length: runs }, (_, n) => () => once(a, c, n))))
const results = (await runJobs(jobs)) as Result[]
const path = writeResults(values.out, about, results)
const isPassing = report(agents, cases, results, MIN, (_agent, _c, mine) => {
  const masked = (mine as Result[]).reduce((sum, r) => sum + r.masked, 0)

  return masked > 0 ? `, ${masked} NEW lines dropped by the code` : ''
})
console.log(`Results: ${path}${about.isDirty ? ' (the tree had uncommitted changes)' : ''}`)
process.exit(isPassing ? 0 : 1)
