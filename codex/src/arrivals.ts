import { closedGroups, isTabEmpty, listedRowIds, openRowIds, recordRows } from '../../hooks/arrivals'
import type { RowRecord } from '../../hooks/arrivals'
import type { InboxView } from '../../hooks/view'
import type { HeardState } from './core'

export type Tab = 'needsYou' | 'findings'

export type Group = 'question' | 'task' | 'finding'
export type FoldGroup = 'question' | 'task' | 'issue' | 'opportunity'

export const TAB_OF: Record<Group, Tab> = { question: 'needsYou', task: 'needsYou', finding: 'findings' }

export const TAB_IDS: Tab[] = ['needsYou', 'findings']

export type SeenRows = RowRecord<Tab>

export const openRows = openRowIds

export function newRows(seen: SeenRows, v: InboxView): { seen: SeenRows; added: Record<Tab, string[]> } {
  return recordRows(seen, listedRowIds(v))
}

export function isShownEmpty(
  v: InboxView & { heard: HeardState },
  t: Tab,
  drawn: ReadonlySet<string>,
  unfolded: ReadonlySet<FoldGroup>,
): boolean {
  return isTabEmpty({
    rows: t === 'findings' ? v.findings.rows : [...v.needsYou.questions, ...v.needsYou.tasks],
    settled: drawn,
    closed: closedGroups(v, t, kind => unfolded.has(kind)),
    hasBlocker: t === 'needsYou' && v.heard !== 'heard',
  })
}
