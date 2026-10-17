import type { RowView } from './view'

export type RowRecord<T extends string> = Partial<Record<T, ReadonlySet<string>>>

/**
 * Records each tab's listed row ids, and returns by tab the ids its last record did not have. A tab listed as
 * null is loading: it keeps its record and adds nothing. A tab with no record adds nothing, so the first view
 * does not count its rows as new.
 */
export function recordRows<T extends string>(
  seen: RowRecord<T>,
  listed: Record<T, string[] | null>,
): { seen: RowRecord<T>; added: Record<T, string[]> } {
  const next: RowRecord<T> = { ...seen }
  const added = {} as Record<T, string[]>
  for (const tab of Object.keys(listed) as T[]) {
    const ids = listed[tab]
    const before = seen[tab]
    added[tab] = ids && before ? ids.filter(id => !before.has(id)) : []
    if (ids) next[tab] = new Set(ids)
  }

  return { seen: next, added }
}

export function isTabEmpty({
  rows,
  settled,
  closed,
  hasBlocker,
}: {
  rows: readonly Pick<RowView, 'id' | 'state'>[]
  settled: ReadonlySet<string>
  closed: readonly { isUnfolded: boolean; rows: readonly { id: string }[] }[]
  hasBlocker: boolean
}): boolean {
  return (
    !hasBlocker &&
    !rows.some(r => r.state.is !== 'settled' || settled.has(r.id)) &&
    !closed.some(g => g.isUnfolded && g.rows.some(r => !settled.has(r.id)))
  )
}

/**
 * The tab to move to for `rows`, the rows that just appeared, or as a look opens, the rows each tab lists: while the
 * shown tab shows only its empty text, the first other tab in `tabs` with rows. Null when the look stays.
 */
export function followTo<T extends string>(
  tabs: readonly T[],
  shown: T,
  isShownEmpty: boolean,
  rows: Record<T, string[]>,
): T | null {
  return isShownEmpty ? (tabs.find(t => t !== shown && rows[t].length > 0) ?? null) : null
}
