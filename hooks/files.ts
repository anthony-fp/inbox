/** The Files tab: what a session made for the person to look at, as documents, artifacts and links. */

import type { FileKind, FileRow } from '../types'

export type { FileKind, FileRow }

const DOCUMENT_KINDS: Record<string, FileKind> = {
  md: 'md',
  html: 'html',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  svg: 'image',
  csv: 'csv',
}

function extension(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
}

/** A new file of one of these kinds goes into Files on its own. A new source file does not. */
export function isDocument(path: string): boolean {
  return extension(path) in DOCUMENT_KINDS
}

export function fileKind(target: string, isPlan: boolean): FileKind {
  if (isPlan) return 'plan'
  if (isUrl(target)) return 'link'
  return DOCUMENT_KINDS[extension(target)] ?? 'md'
}

export function whereLabel(target: string, worktree: string): string {
  if (isUrl(target)) {
    const host = new URL(target).hostname
    return host === '127.0.0.1' ? 'localhost' : host
  }
  if (target.startsWith(`${worktree}/.claude/`)) return '.claude'
  if (target.startsWith(`${worktree}/.inbox/`)) return '.inbox'
  if (target.startsWith(`${worktree}/`)) return 'repo'
  return 'scratch'
}

/** Adds a row, unless one with the same target is there already, dismissed or not. */
export function addFile(rows: FileRow[], row: Omit<FileRow, 'id' | 'isDismissed'>): FileRow[] {
  if (rows.some(r => r.target === row.target)) return rows
  return [...rows, { ...row, id: row.target, isDismissed: false }]
}

export function setDismissed(rows: FileRow[], id: string, isDismissed: boolean): FileRow[] {
  return rows.map(r => (r.id === id ? { ...r, isDismissed } : r))
}

/** A late store read's rows over those added meanwhile. For a target in both, the saved row wins, dismissal and all. */
export function mergeFiles(saved: FileRow[], current: FileRow[]): FileRow[] {
  const savedTargets = new Set(saved.map(r => r.target))
  return [...saved, ...current.filter(r => !savedTargets.has(r.target))]
}

export function shownFiles(rows: FileRow[]): { open: FileRow[]; dismissed: FileRow[] } {
  const newest = [...rows].sort((a, b) => b.at - a.at)
  return { open: newest.filter(r => !r.isDismissed), dismissed: newest.filter(r => r.isDismissed) }
}
