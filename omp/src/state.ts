import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { KEPT_SESSIONS, pruneClosed, upgradeLedger } from '../../hooks/ledger'
import { upgradeLastActions } from '../../hooks/presses'
import { emptySession, NO_PRS } from '../../hooks/session'
import type { Session } from '../../hooks/session'

export type OmpState = Session & {
  version: 1
  sessionId: string
}

export function emptyState(sessionId: string): OmpState {
  return { version: 1, sessionId, ...emptySession() }
}

function fileName(sessionId: string): string {
  if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error(`Not a session id: ${sessionId}`)

  return sessionId
}

export function statePath(dir: string, sessionId: string): string {
  return join(dir, 'sessions', `${fileName(sessionId)}.json`)
}

type Saved = Partial<Omit<OmpState, 'sent' | 'pending'>> & {
  sent?: (Omit<OmpState['sent'][number], 'row' | 'queuedId' | 'pressedAt' | 'deliveryId'> &
    Partial<OmpState['sent'][number]>)[]
  pending?: OmpState['pending']
}

/** State saved by an earlier build, with any field it lacks filled in. */
function upgraded(saved: Saved, sessionId: string): OmpState {
  if (saved.version !== undefined && saved.version !== 1)
    throw new Error(`Unsupported inbox state version: ${saved.version}`)
  const base = emptyState(sessionId)

  return {
    ...base,
    ...saved,
    version: 1,
    sessionId,
    ledger: saved.ledger
      ? { ...base.ledger, ...upgradeLedger({ ...saved.ledger, items: saved.ledger.items ?? [] }) }
      : base.ledger,
    turn: { ...base.turn, ...saved.turn },
    told: { ...base.told, ...saved.told },
    presence: { ...base.presence, ...saved.presence },
    pending: saved.pending ?? [],
    sent: (saved.sent ?? []).map(x => ({
      ...x,
      row: x.row ?? null,
      queuedId: x.queuedId ?? null,
      pressedAt: x.pressedAt ?? null,
      deliveryId: x.deliveryId ?? null,
      phase: x.phase ?? 'accepted',
    })),
    lastActions: upgradeLastActions(saved.lastActions ?? {}),
    heldRows: saved.heldRows ?? [],
    prViews: { ...NO_PRS, ...saved.prViews, isFetching: false },
    stop: saved.stop ?? null,
  }
}

/** A session's saved state. A missing file is a new session; a file that cannot be read or converted throws. */
export async function readState(dir: string, sessionId: string): Promise<OmpState> {
  const saved = await readFile(statePath(dir, sessionId), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })

  return saved === null ? emptyState(sessionId) : upgraded(JSON.parse(saved), sessionId)
}

const updateTails = new Map<string, Promise<void>>()
const exclusiveRuns = new Set<string>()
let tmpCount = 0

/** Runs `fn` after every earlier call with the same key has settled. A failure does not block later calls. */
function inTurn<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (updateTails.get(key) ?? Promise.resolve()).then(fn)
  const tail = run.then(
    () => {},
    () => {},
  )
  updateTails.set(key, tail)
  void tail.then(() => {
    if (updateTails.get(key) === tail) updateTails.delete(key)
  })

  return run
}

/**
 * Changes a session in turn with every other change to it in this process. Every save prunes the closed lists and
 * keeps the records of `heldRows`.
 */
export async function updateState(
  dir: string,
  sessionId: string,
  change: (s: OmpState) => OmpState | Promise<OmpState>,
): Promise<OmpState> {
  const path = statePath(dir, sessionId)

  return inTurn(path, async () => {
    const current = await readState(dir, sessionId)
    const changed = await change(current)
    const next = { ...changed, ledger: pruneClosed(changed.ledger, new Set(changed.heldRows)) }
    await mkdir(join(dir, 'sessions'), { recursive: true })
    const tmp = `${path}.${process.pid}-${++tmpCount}.tmp`
    await writeFile(tmp, JSON.stringify(next))
    await rename(tmp, path)

    return next
  })
}

/** Runs `fn` unless another run already holds the session's per-reply update in this process. */
export async function exclusiveRun<T>(
  dir: string,
  sessionId: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const key = statePath(dir, sessionId)
  if (exclusiveRuns.has(key)) return { acquired: false }
  exclusiveRuns.add(key)
  try {
    return { acquired: true, value: await fn() }
  } finally {
    exclusiveRuns.delete(key)
  }
}

/**
 * Deletes the oldest saved sessions beyond the newest `KEPT_SESSIONS`, ranked by when the file was last saved.
 * Only readable files of a version this build supports count and can go, and the `keep` session never does. A file
 * that is changing or updating in this process, or that was saved again since the ranking, stays.
 */
export async function pruneSessions(dir: string, keep: string): Promise<void> {
  const folder = join(dir, 'sessions')
  const names = (await readdir(folder).catch(() => [])).filter(name => /^[\w-]{1,100}\.json$/.test(name))
  if (names.length <= KEPT_SESSIONS) return
  const saved = await Promise.all(
    names.map(async name => {
      const path = join(folder, name)
      try {
        const { mtimeMs } = await stat(path)
        upgraded(JSON.parse(await readFile(path, 'utf8')), name.slice(0, -'.json'.length))
        return { name, path, mtimeMs }
      } catch {
        return null
      }
    }),
  )
  const readable = saved.filter(s => s !== null).sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
  const stale = readable.filter(s => s.name !== `${keep}.json`).slice(0, Math.max(0, readable.length - KEPT_SESSIONS))
  for (const { path, mtimeMs } of stale) {
    if (updateTails.has(path) || exclusiveRuns.has(path)) continue
    try {
      if ((await stat(path)).mtimeMs === mtimeMs) await unlink(path)
    } catch {
      continue
    }
  }
}
