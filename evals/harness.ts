import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The repo: `scripts/eval.sh` names it, since the runners run as bundles in a temporary folder. */
const ROOT = process.env.INBOX_EVAL_ROOT ?? process.cwd()
/** Calls that fail before a model answers are tried this many more times. */
const RETRIES = 2
const PARALLEL = 6

export type Run = {
  agent: string
  name: string
  run: number
  /** The model that answered, as the agent reported it. */
  model: string | null
  /** Why the run could not be graded: the call failed, timed out, or answered with nothing. */
  error: string | null
  failed: string[]
  attempts: number
}

/** Throws for a case name the file lacks, and for a selection with no cases. */
export function selectCases<C extends { name: string }>(all: C[], names: string | undefined): C[] {
  if (!names) return all
  const wanted = names.split(',')
  const unknown = wanted.filter(n => !all.some(c => c.name === n))
  if (unknown.length > 0) throw new Error(`Unknown --case ${unknown.join(', ')}`)

  return all.filter(c => wanted.includes(c.name))
}

export function runCount(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`--runs must be a positive whole number, not ${value}`)

  return n
}

function git(args: string[]): string {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim()
}

function version(cli: string): string | null {
  try {
    return execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim()
  } catch {
    return null
  }
}

export type Provenance = {
  commit: string
  isDirty: boolean
  date: string
  suite: string
  args: string[]
  clis: Record<string, string | null>
}

export function provenance(suite: string, clis: Record<string, string>): Provenance {
  return {
    commit: git(['rev-parse', 'HEAD']),
    isDirty: git(['status', '--porcelain']) !== '',
    date: new Date().toISOString(),
    suite,
    args: process.argv.slice(2),
    clis: Object.fromEntries(Object.entries(clis).map(([name, cli]) => [name, version(cli)])),
  }
}

/** Runs each job, retrying one whose call failed, `PARALLEL` at a time. */
export async function runJobs(jobs: (() => Promise<Run>)[]): Promise<Run[]> {
  const results: Run[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!
        let r = await job()
        for (let tries = 1; r.error && tries <= RETRIES; tries++) r = { ...(await job()), attempts: tries + 1 }
        results.push(r)
      }
    }),
  )

  return results
}

/** Where a run's results go: `--out`, or a new file in `evals/results/`, which Git ignores. */
export function writeResults(out: string | undefined, about: Provenance, results: unknown[]): string {
  const path = out ?? join(ROOT, 'evals', 'results', `${about.suite}-${about.date.replaceAll(':', '-')}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ ...about, results }, null, 1))

  return path
}

/** A case's pass count from a run long enough to judge later runs by, keyed `<agent> <case>`. */
export type Baseline = { passed: number; runs: number; commit: string; date: string; models: string[] }
export type Baselines = Record<string, Baseline>

const BASELINES = join(ROOT, 'evals', 'baselines.json')
/** A later run is below a baseline when a pass count that low would happen less often than this by chance. */
const BELOW = 0.05

export function readBaselines(suite: string): Baselines {
  if (!existsSync(BASELINES)) return {}
  const all: Record<string, Baselines> = JSON.parse(readFileSync(BASELINES, 'utf8'))

  return all[suite] ?? {}
}

/** Saves each case's counts from these results as its baseline, replacing the case's earlier one. */
export function writeBaselines(suite: string, about: Provenance, results: Run[]) {
  const all: Record<string, Baselines> = existsSync(BASELINES) ? JSON.parse(readFileSync(BASELINES, 'utf8')) : {}
  const mine = { ...all[suite] }
  for (const key of new Set(results.map(r => `${r.agent} ${r.name}`))) {
    const runs = results.filter(r => `${r.agent} ${r.name}` === key)
    mine[key] = {
      passed: runs.filter(r => !r.error && r.failed.length === 0).length,
      runs: runs.length,
      commit: about.commit,
      date: about.date,
      models: [...new Set(runs.map(r => r.model).filter((m): m is string => m !== null))],
    }
  }
  writeFileSync(BASELINES, `${JSON.stringify({ ...all, [suite]: mine }, null, 2)}\n`)
}

/** P(X <= passed) for X ~ Binomial(runs, rate). */
function chanceOfAtMost(passed: number, runs: number, rate: number): number {
  let sum = 0
  let term = (1 - rate) ** runs
  for (let k = 0; k <= passed; k++) {
    sum += term
    term *= ((runs - k) / (k + 1)) * (rate / (1 - rate))
  }

  return Math.min(1, sum)
}

/**
 * Whether a pass count is unlikely under the baseline's rate. The rate is smoothed, (passed + 1) / (runs + 2), so a
 * baseline of 20 of 20 does not flag every later miss.
 */
export function isBelowBaseline(passed: number, runs: number, b: Baseline): boolean {
  const rate = (b.passed + 1) / (b.runs + 2)

  return chanceOfAtMost(passed, runs, rate) < BELOW
}

/**
 * Prints each case's result and returns whether every case passed. A case with a run that could not be graded is
 * reported as not run: its failed calls say nothing about the text under test.
 */
export function report<C extends { name: string; min?: Partial<Record<string, number>> }>(
  agents: string[],
  cases: C[],
  results: Run[],
  min: number,
  baselines: Baselines,
  extra: (agent: string, c: C, mine: Run[]) => string = () => '',
): boolean {
  let isPassing = true
  for (const agent of agents)
    for (const c of cases) {
      const mine = results.filter(r => r.agent === agent && r.name === c.name)
      const unrun = mine.filter(r => r.error)
      const passed = mine.filter(r => !r.error && r.failed.length === 0).length
      const models = [...new Set(mine.map(r => r.model).filter(Boolean))].join(', ') || 'unknown model'
      const note = extra(agent, c, mine)
      if (unrun.length > 0) {
        isPassing = false
        console.log(`  ? ${agent} ${c.name}: not run, ${unrun.length} of ${mine.length} calls failed (${models})`)
        for (const r of unrun) console.log(`       ${r.error}`)
        continue
      }
      const baseline = baselines[`${agent} ${c.name}`]
      const isBelow = baseline !== undefined && isBelowBaseline(passed, mine.length, baseline)
      const isPass = passed / mine.length >= (c.min?.[agent] ?? min) && !isBelow
      isPassing &&= isPass
      const against = baseline ? `, baseline ${baseline.passed} of ${baseline.runs}${isBelow ? ': below it' : ''}` : ''
      console.log(
        `${isPass ? '  ok' : '  x '} ${agent} ${c.name}: ${passed} of ${mine.length} (${models})${against}${note}`,
      )
      if (!isPass) for (const r of mine) if (r.failed.length > 0) console.log(`       ${r.failed.join('; ')}`)
    }

  return isPassing
}
