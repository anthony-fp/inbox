import { allRows, SETTLED_MS, settledRowIds } from '../../hooks/view'
import type { InboxView } from '../../hooks/view'

export const POLL_MS = 3000

export const PRESS_TIMEOUT_MS = 60_000

export const SETTLE_WINDOW_MS = SETTLED_MS + 2 * POLL_MS

export function settledIds(v: InboxView): string[] {
  return settledRowIds(allRows(v))
}

export function settledSeen(seen: ReadonlyMap<string, number>, listed: string[], now: number): Map<string, number> {
  return new Map(listed.map(id => [id, seen.get(id) ?? now]))
}

export function drawnSettled(
  seen: ReadonlyMap<string, number>,
  now: number,
  held: ReadonlySet<string> = new Set(),
): Set<string> {
  return new Set([...seen].filter(([id, at]) => held.has(id) || now - at < SETTLED_MS).map(([id]) => id))
}
