import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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

/**
 * Prints each case's result and returns whether every case passed. A case with a run that could not be graded is
 * reported as not run: its failed calls say nothing about the text under test.
 */
export function report<C extends { name: string; min?: Partial<Record<string, number>> }>(
  agents: string[],
  cases: C[],
  results: Run[],
  min: number,
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
      const isPass = passed / mine.length >= (c.min?.[agent] ?? min)
      isPassing &&= isPass
      console.log(`${isPass ? '  ok' : '  x '} ${agent} ${c.name}: ${passed} of ${mine.length} (${models})${note}`)
      if (!isPass) for (const r of mine) if (r.failed.length > 0) console.log(`       ${r.failed.join('; ')}`)
    }

  return isPassing
}
