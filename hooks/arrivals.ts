// Which rows are new to a client, and where it moves for them. The pane and the
// Codex tab both follow these rules, each with its own tabs and its own rule
// for when a tab shows only its empty text. Pure, and imports nothing from the engine.

/** Each tab's row ids as last recorded. A tab with no record yet has none. */
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

/**
 * Where to move for rows that just appeared: while the shown tab shows only its empty text, to the first other
 * tab in `tabs` with new rows, and the first new row there that `selectable` lists, or null when it lists none.
 * Null when the client stays.
 */
export function followTo<T extends string>(
  tabs: readonly T[],
  shown: T,
  isShownEmpty: boolean,
  added: Record<T, string[]>,
  selectable: Record<T, string[]>,
): { tab: T; id: string | null } | null {
  const to = isShownEmpty ? tabs.find(t => t !== shown && added[t].length > 0) : undefined
  if (to === undefined) return null

  return { tab: to, id: selectable[to].find(id => added[to].includes(id)) ?? null }
}
