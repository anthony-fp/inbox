// The Inbox tab's side of the arrival rules in hooks/arrivals.ts: its tabs, the
// rows each lists, and when a tab shows only its empty text. Pure, so tests can
// run them without the tab's page.

import { recordRows } from '../../hooks/arrivals'
import type { RowRecord } from '../../hooks/arrivals'
import { closedShown } from '../../hooks/view'
import type { InboxView, RowView } from '../../hooks/view'
import type { HeardState } from './core'

export type Tab = 'needsYou' | 'findings'

/** A Closed fold, which the person unfolds by its group. */
export type Group = 'question' | 'task' | 'finding'
/** A list with its own Closed fold: each Needs you group and each kind of finding. */
export type FoldGroup = 'question' | 'task' | 'issue' | 'opportunity'

/** The tab that lists each group. */
export const TAB_OF: Record<Group, Tab> = { question: 'needsYou', task: 'needsYou', finding: 'findings' }

export const TAB_IDS: Tab[] = ['needsYou', 'findings']

/** The row ids the tab has seen in each tab. */
export type SeenRows = RowRecord<Tab>

/** Each tab's row ids in a view, settled rows included, so a row Undo brings back is not new. */
function listedIds(v: InboxView): Record<Tab, string[]> {
  return {
    needsYou: [...v.needsYou.questions, ...v.needsYou.tasks].map(r => r.id),
    findings: v.findings.rows.map(r => r.id),
  }
}

/** Records a view's rows, and returns by tab the ids the tab had not seen. The first view adds none. */
export function newRows(seen: SeenRows, v: InboxView): { seen: SeenRows; added: Record<Tab, string[]> } {
  return recordRows(seen, listedIds(v))
}

/**
 * Whether a tab shows only its empty text: no open rows, no rows drawn settled,
 * and no unfolded Closed fold. Needs you is not empty while it shows the
 * not-heard text, so a new finding does not move the tab away from that warning.
 */
export function isShownEmpty(
  v: InboxView & { heard: HeardState },
  t: Tab,
  drawn: ReadonlySet<string>,
  unfolded: ReadonlySet<FoldGroup>,
): boolean {
  const isListed = (rows: RowView[]) => rows.some(r => r.state.is !== 'settled' || drawn.has(r.id))
  const isClosedShown = (g: FoldGroup, closed: { id: string }[]) =>
    unfolded.has(g) && closedShown(closed, drawn).length > 0
  if (t === 'findings')
    return (
      !isListed(v.findings.rows) &&
      !isClosedShown(
        'issue',
        v.findings.closed.filter(f => f.kind === 'issue'),
      ) &&
      !isClosedShown(
        'opportunity',
        v.findings.closed.filter(f => f.kind === 'opportunity'),
      )
    )

  return (
    v.heard === 'heard' &&
    !isListed(v.needsYou.questions) &&
    !isListed(v.needsYou.tasks) &&
    !isClosedShown('question', v.needsYou.closed.questions) &&
    !isClosedShown('task', v.needsYou.closed.tasks)
  )
}
