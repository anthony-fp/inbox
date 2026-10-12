// The PRs tab's rules both hosts share: fetching each tracked PR with gh, which PRs the tab draws, the ids of
// their rows, and what each press on them does. Each host stores the PRs and runs gh its own way.

import type { LastAction, Ledger, PressKind, PrCheck, PrThread, PrView, PrViews } from '../types'
import { localLast, pendingResult, recordPress, withQueued } from './presses'
import type { Effect, PrActionId } from './presses'
import {
  inPrOrder,
  parseRef,
  prNeedsYou,
  prompts,
  prRefs,
  readiness,
  readThreads,
  readView,
  threadsOnYou,
  THREADS_QUERY,
  VIEW_FIELDS,
} from './prs'
import type { IsThreadSent, PrStatus } from './prs'
import { SETTLED_MS } from './view'

/** How many linked PRs a conversation keeps, newest last. */
export const MAX_PRS = 6

/** Runs gh with these arguments in the session's folder. */
export type GhRun = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

/** The linked PRs after a reply or command links `refs`: each moves to the end, and the oldest past MAX_PRS leave. */
export function linkedPrs(prs: string[], refs: string[]): string[] {
  return [...prs.filter(r => !refs.includes(r)), ...refs].slice(-MAX_PRS)
}

/**
 * Fetches every PR the tab shows: the linked ones and the current branch's. Only `findsBranchPr` asks gh which PR
 * the branch has; otherwise the last one found is refreshed by its ref. Returns the views fetched and the branch's PR.
 */
export async function fetchTracked(
  gh: GhRun,
  now: () => number,
  state: PrViews,
  linked: string[],
  findsBranchPr: boolean,
): Promise<{ views: Record<string, PrView>; branchRef: string | null }> {
  const branchTarget = findsBranchPr ? null : state.branchRef
  // The branch's PR, when it is also linked, is fetched once, with the linked ones.
  const isBranchLinked = branchTarget !== null && linked.includes(branchTarget)
  const [branch, ...rest] = await Promise.all([
    findsBranchPr || (branchTarget && !isBranchLinked)
      ? fetchPr(gh, now, branchTarget, state.views, state.branchRef)
      : null,
    ...linked.map(ref => fetchPr(gh, now, ref, state.views, null)),
  ])
  const views: Record<string, PrView> = {}
  for (const v of [...rest, branch]) if (v) views[v.ref] = v

  return { views, branchRef: findsBranchPr ? (branch?.ref ?? null) : state.branchRef }
}

/**
 * One PR's view and open threads. `target` is "owner/repo#123", or null for
 * the current branch's PR, whose ref is known only from gh's answer.
 * `knownBranchRef` is the branch's PR as of the last fetch: it stays the
 * branch's PR when the lookup fails for any reason but "no pull requests found".
 */
export async function fetchPr(
  gh: GhRun,
  now: () => number,
  target: string | null,
  views: Record<string, PrView>,
  knownBranchRef: string | null,
): Promise<PrView | null> {
  const threadsOf = (ref: string) => {
    const r = parseRef(ref)
    return gh([
      'api',
      'graphql',
      '-f',
      `query=${THREADS_QUERY}`,
      '-F',
      `owner=${r.owner}`,
      '-F',
      `repo=${r.name}`,
      '-F',
      `number=${r.number}`,
    ])
  }
  const t = target ? parseRef(target) : null
  // A linked PR's two calls are independent; the branch PR's threads wait for its ref.
  const [view, early] = await Promise.all([
    gh(['pr', 'view', ...(t ? [t.number, '-R', t.repo] : []), '--json', VIEW_FIELDS]),
    target ? threadsOf(target) : null,
  ])
  const hasNoPr = view.exitCode !== 0 && /no pull requests found/i.test(view.stderr)
  const ref = target ?? (view.exitCode === 0 ? urlRef(view.stdout) : hasNoPr ? null : knownBranchRef)
  if (!ref) return null
  const previous = views[ref]
  const base = view.exitCode === 0 ? readView(ref, view.stdout) : null
  if (!base)
    return previous ? { ...previous, error: view.stderr.trim().split('\n')[0] || 'gh could not read the PR' } : null
  const threads = early ?? (await threadsOf(ref))

  return {
    ...base,
    threads: threads.exitCode === 0 ? readThreads(threads.stdout) : (previous?.threads ?? []),
    fetchedAt: now(),
    error: threads.exitCode === 0 ? null : 'could not read review threads',
  }
}

/** The ref of the PR whose `gh pr view --json` output this is. */
export function urlRef(json: string): string | null {
  try {
    return prRefs(String((JSON.parse(json) as { url?: unknown }).url ?? ''))[0] ?? null
  } catch {
    return null
  }
}

/** The id of a review thread's row, which also keys its last action. */
export function prThreadId(pr: PrView, t: PrThread): string {
  return threadRowId(pr.ref, t.id)
}

/** The id of a failing PR check's row. */
export function prCheckId(pr: PrView, check: PrCheck): string {
  return checkRowId(pr.ref, check.name)
}

export function threadRowId(ref: string, thread: string): string {
  return `${ref} thread ${thread}`
}

export function checkRowId(ref: string, check: string): string {
  return `${ref} check ${check}`
}

/** The id of a PR block's own row, which keys its last action. */
export function prMarkId(ref: string): string {
  return `pr:${ref}`
}

/**
 * Which PR rows the person handed to Claude. A thread stays sent until a
 * comment newer than the press, and one whose message failed to send never was.
 */
export function threadSentIn(lastActions: Record<string, LastAction>): IsThreadSent {
  return (pr, t) => {
    const last = lastActions[prThreadId(pr, t)]

    return last?.kind === 'handoff' && last.delivery?.state !== 'failed' && last.at > ((t.reply ?? t).at ?? 0)
  }
}

/** A PR the session still tracks: one it linked, or the current branch's. */
export function isTracked(prState: PrViews, linked: string[], ref: string): boolean {
  return linked.includes(ref) || prState.branchRef === ref
}

/** A PR the person dismissed less than SETTLED_MS ago, whose block stays in place, settled, with Undo. */
export function isDismissing(lastActions: Record<string, LastAction>, ref: string, now: number): boolean {
  const mark = lastActions[prMarkId(ref)]

  return mark?.action === 'pr-dismiss' && now - mark.at < SETTLED_MS
}

/** The PRs the tab draws: each one tracked, and each one just dismissed, which draws settled. */
export function drawnPrs(
  prState: PrViews,
  linked: string[],
  lastActions: Record<string, LastAction>,
  now: number,
): { pr: PrView; isSettled: boolean }[] {
  return inPrOrder(Object.values(prState.views)).flatMap((pr): { pr: PrView; isSettled: boolean }[] =>
    isTracked(prState, linked, pr.ref)
      ? [{ pr, isSettled: false }]
      : isDismissing(lastActions, pr.ref, now)
        ? [{ pr, isSettled: true }]
        : [],
  )
}

/** The tone each status word draws in: Blocked waits on the person, Ready is done, and Waiting has none. */
export const PR_TONES: Record<PrStatus, 'needsYou' | 'done' | 'findings' | 'error' | null> = {
  ready: 'done',
  blocked: 'needsYou',
  waiting: null,
  draft: null,
  merged: 'findings',
  closed: 'error',
}

/** A press on a PR block, one of its review threads, or a failing check's row. Only the mod has PRs. */
export type PrPress =
  | { action: 'thread-address' | 'thread-draft' | 'thread-discuss' | 'thread-open'; ref: string; thread: string }
  | { action: 'pr-conflicts' | 'pr-address-all' | 'pr-merge' | 'pr-open' | 'pr-dismiss' | 'pr-undo'; ref: string }
  | { action: 'log'; ref: string; check: string }

/**
 * A press's outcome as the runner applies it: the ledger after it, the last
 * action of each row it records on, the rows whose last action it removes, and
 * the effects to perform. `stale` when its row is gone or changed.
 */
export type Applied =
  { ledger: Ledger; lasts: Record<string, LastAction>; drop: string[]; effects: Effect[] } | { stale: true }

/** The row a PR press was drawn on, which keys its last action and its note. */
export function prRowId(p: PrPress): string {
  if (p.action === 'log') return checkRowId(p.ref, p.check)
  if ('thread' in p) return threadRowId(p.ref, p.thread)

  return prMarkId(p.ref)
}

/**
 * The PR press [Try again] repeats on a thread or PR block whose message failed
 * to send, with its kind, or null. As `retryOf` does a row press.
 */
export function prRetryOf(
  last: LastAction | undefined,
  ref: string,
  thread: string | null,
): { press: PrPress; kind: PressKind } | null {
  if (last?.delivery?.state !== 'failed') return null
  const a = last.action
  if (thread !== null && (a === 'thread-address' || a === 'thread-draft' || a === 'thread-discuss'))
    return { press: { action: a, ref, thread }, kind: last.kind }
  if (thread === null && (a === 'pr-conflicts' || a === 'pr-address-all' || a === 'pr-merge'))
    return { press: { action: a, ref }, kind: last.kind }

  return null
}

/**
 * Applies a PR press, as `applyPress` does a row press. Pure. Stale when the PR
 * is no longer tracked or drawn, its thread or check is gone, or what the
 * press acts on is over: the PR no longer conflicts, or no thread waits on the
 * person. Undo is stale unless the PR's block still holds its Dismiss.
 */
export function applyPrPress(
  ledger: Ledger,
  prState: PrViews,
  lastActions: Record<string, LastAction>,
  p: PrPress,
  ctx: { now: number; turnsStarted: number },
): Applied {
  const stale = { stale: true as const }
  const pr = prState.views[p.ref]
  const markId = prMarkId(p.ref)
  // Every row a sending press records on waits for the message to arrive.
  const applied = (a: Partial<Exclude<Applied, { stale: true }>>): Applied => {
    const effects = a.effects ?? []
    const lasts = Object.fromEntries(Object.entries(a.lasts ?? {}).map(([id, l]) => [id, withQueued(l, effects)]))

    return { ledger, drop: [], ...a, lasts, effects }
  }
  if (p.action === 'pr-undo') {
    // Like an item's Undo, it does not check the settle window, so a press just after it ends still lands.
    if (!pr || isTracked(prState, ledger.prs, p.ref) || lastActions[markId]?.action !== 'pr-dismiss') return stale
    return applied({ ledger: { ...ledger, prs: [...ledger.prs, p.ref].slice(-MAX_PRS) }, drop: [markId] })
  }
  if (!pr || !isTracked(prState, ledger.prs, p.ref)) return stale
  const record = (kind: 'talk' | 'handoff' | 'mark', action: PrActionId, text: string) =>
    recordPress(kind, action, text, ctx)
  const send = (text: string): Effect => ({ kind: 'send', text, by: null })
  // An open is Local: its row keeps its last action, with the open's result on it.
  const open = (rowId: string, text: string, url: string, name: string): Applied => {
    const effects: Effect[] = [{ kind: 'open', target: url, name }]
    const result = pendingResult(effects, ctx.now)

    return applied({ lasts: { [rowId]: localLast(lastActions[rowId], { action: p.action, text }, result) }, effects })
  }
  switch (p.action) {
    case 'thread-address':
    case 'thread-draft':
    case 'thread-discuss':
    case 'thread-open': {
      const t = pr.threads.find(x => x.id === p.thread)
      if (!t) return stale
      const id = prThreadId(pr, t)
      if (p.action === 'thread-open') return open(id, 'Open', t.reply?.url || t.url || pr.url, 'the comment')
      if (p.action === 'thread-address')
        return applied({
          lasts: { [id]: record('handoff', p.action, 'Address') },
          effects: [send(prompts.address(pr, [t]))],
        })
      if (p.action === 'thread-draft')
        return applied({
          lasts: { [id]: record('talk', p.action, 'Draft reply') },
          effects: [send(prompts.draft(pr, t))],
        })
      return applied({ lasts: { [id]: record('talk', p.action, 'Discuss') }, effects: [send(prompts.discuss(pr, t))] })
    }
    case 'pr-conflicts':
      if (pr.state !== 'OPEN' || pr.mergeable !== 'CONFLICTING') return stale
      return applied({
        lasts: { [markId]: record('handoff', p.action, 'Resolve conflicts') },
        effects: [send(prompts.resolve(pr))],
      })
    case 'pr-address-all': {
      const waiting = threadsOnYou(pr, threadSentIn(lastActions))
      if (waiting.length === 0) return stale
      // Each thread it sends reads as if its own Address were pressed, so it folds too.
      const threads = waiting.map(t => [prThreadId(pr, t), record('handoff', 'thread-address', 'Address')])
      return applied({
        lasts: {
          [markId]: record('handoff', p.action, `Address all ${waiting.length} threads`),
          ...Object.fromEntries(threads),
        },
        effects: [send(prompts.address(pr, waiting))],
      })
    }
    case 'pr-merge':
      if (readiness(pr, threadSentIn(lastActions)).status !== 'ready') return stale
      return applied({ lasts: { [markId]: record('handoff', p.action, 'Merge') }, effects: [send(prompts.merge(pr))] })
    case 'pr-open':
      return open(markId, 'Open PR', pr.url, `PR #${pr.number}`)
    case 'pr-dismiss':
      // The branch's PR has no Dismiss: the tab shows it while the branch has it.
      if (!ledger.prs.includes(p.ref) || prState.branchRef === p.ref) return stale
      // Its view stays, so its block settles in place until it leaves.
      return applied({
        ledger: { ...ledger, prs: ledger.prs.filter(r => r !== p.ref) },
        lasts: { [markId]: record('mark', p.action, 'Dismissed') },
      })
    case 'log': {
      const check = pr.checks.find(c => c.name === p.check)
      if (!check) return stale
      // A check with no log link opens the PR's page instead.
      return open(prCheckId(pr, check), 'Open log', check.url ?? pr.url, check.url ? 'the log' : `PR #${pr.number}`)
    }
  }
}
