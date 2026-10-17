import { isTabEmpty, recordRows } from '../../hooks/arrivals'
import type { RowRecord } from '../../hooks/arrivals'
import type { InboxView, RowView } from '../../hooks/view'
import type { HeardState } from './core'

export type Tab = 'needsYou' | 'findings'

export type Group = 'question' | 'task' | 'finding'
export type FoldGroup = 'question' | 'task' | 'issue' | 'opportunity'

export const TAB_OF: Record<Group, Tab> = { question: 'needsYou', task: 'needsYou', finding: 'findings' }

export const TAB_IDS: Tab[] = ['needsYou', 'findings']

export type SeenRows = RowRecord<Tab>

/** Each tab's row ids in a view, settled rows included, so a row Undo brings back is not new. */
function listedIds(v: InboxView): Record<Tab, string[]> {
  return {
    needsYou: [...v.needsYou.questions, ...v.needsYou.tasks].map(r => r.id),
    findings: v.findings.rows.map(r => r.id),
  }
}

export function openRows(v: InboxView): Record<Tab, string[]> {
  const open = (rows: RowView[]) => rows.filter(r => r.state.is !== 'settled').map(r => r.id)

  return { needsYou: open([...v.needsYou.questions, ...v.needsYou.tasks]), findings: open(v.findings.rows) }
}

export function newRows(seen: SeenRows, v: InboxView): { seen: SeenRows; added: Record<Tab, string[]> } {
  return recordRows(seen, listedIds(v))
}

export function isShownEmpty(
  v: InboxView & { heard: HeardState },
  t: Tab,
  drawn: ReadonlySet<string>,
  unfolded: ReadonlySet<FoldGroup>,
): boolean {
  const groups =
    t === 'findings'
      ? [
          { isUnfolded: unfolded.has('issue'), rows: v.findings.closed.filter(f => f.kind === 'issue') },
          { isUnfolded: unfolded.has('opportunity'), rows: v.findings.closed.filter(f => f.kind === 'opportunity') },
        ]
      : [
          { isUnfolded: unfolded.has('question'), rows: v.needsYou.closed.questions },
          { isUnfolded: unfolded.has('task'), rows: v.needsYou.closed.tasks },
        ]
  return isTabEmpty({
    rows: t === 'findings' ? v.findings.rows : [...v.needsYou.questions, ...v.needsYou.tasks],
    settled: drawn,
    closed: groups,
    hasBlocker: t === 'needsYou' && v.heard !== 'heard',
  })
}
