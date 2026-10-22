/** The Files tab: what a session made for the person to look at, as documents, artifacts and links. */

import type { FileKind, FileRow, PressKind } from '../types'

export type { FileKind, FileRow }

/**
 * Claude Code only: Codex and omp have no Files tab, so this is not among the shared `agentTools`. The agent eval's
 * probe offers it to Claude Code with this text.
 */
export const SHOW = {
  name: 'show',
  description:
    'Add a link or file you made for the person to the Files tab, when the inbox did not add it: a server URL, or a file a shell command wrote. Files you create with Write are added for you.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'The URL, or the absolute path of the file.' },
      name: { type: 'string', description: 'A short name for the row. Leave it out to use the file name or the URL.' },
    },
    required: ['target'],
  },
}

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

/** Whether the target names a scheme, as `vnc://host` does. A row saved by an earlier build may hold any scheme. */
export function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
}

/**
 * The links Files opens: http and https only. `open` starts a program for other schemes, such as `vnc:`, `smb:` or
 * `file:` on an app, which would skip the guard that shows an executable in Finder.
 */
export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target)
}

export function isParsedUrl(text: string): boolean {
  try {
    new URL(text)
    return true
  } catch {
    return false
  }
}

/** The local path of a `file://` URL on this machine, or null for any other URL. */
export function fileUrlPath(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) return null
    const path = decodeURIComponent(url.pathname)
    return path.startsWith('/') ? path : null
  } catch {
    return null
  }
}

/**
 * What the `show` tool adds for the target Claude names: a local path, made absolute under `root` with a leading `~/`
 * under `home`, or an http or https link. A `file://` URL on this machine becomes its path. Null for a target the
 * inbox does not open, such as `vnc://host`, or `~/x` with no home known.
 */
export function showTarget(raw: string, root: string, home: string): { target: string; isLink: boolean } | null {
  if (hasScheme(raw)) {
    const local = fileUrlPath(raw)
    if (local !== null) return { target: local, isLink: false }
    return isUrl(raw) && isParsedUrl(raw) ? { target: raw, isLink: true } : null
  }
  if (raw.startsWith('~/'))
    return home === '' ? null : { target: `${home.replace(/\/$/, '')}${raw.slice(1)}`, isLink: false }

  return { target: raw.startsWith('/') ? raw : `${root}/${raw}`, isLink: false }
}

/** What `show` answers for a target `showTarget` refused. */
export function notShownText(raw: string): string {
  return `Not added: ${raw} is not a link the inbox opens. Give an http or https URL, or a file path.`
}

/** A new file of one of these kinds goes into Files on its own. A new source file does not. */
export function isDocument(path: string): boolean {
  return extension(path) in DOCUMENT_KINDS
}

export function fileKind(target: string, isPlan: boolean): FileKind {
  if (isPlan) return 'plan'
  if (hasScheme(target)) return 'link'
  return DOCUMENT_KINDS[extension(target)] ?? 'file'
}

export function whereLabel(target: string, worktree: string): string {
  if (hasScheme(target)) {
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

export type FileAction = 'open' | 'finder' | 'copy' | 'dismiss' | 'restore'

export type FileEffect =
  { kind: 'open'; target: string } | { kind: 'reveal'; path: string } | { kind: 'copy'; text: string } | null

/** The row's buttons, in the order each look draws them. A link or an artifact has no file to show in Finder. */
export function fileActions(row: FileRow): { id: FileAction; label: string; kind: PressKind }[] {
  if (row.isDismissed) return [{ id: 'restore', label: 'Restore', kind: 'mark' }]
  const isLink = hasScheme(row.target)

  return [
    { id: 'open', label: 'Open', kind: 'local' },
    ...(isLink ? [] : [{ id: 'finder' as const, label: 'Finder', kind: 'local' as const }]),
    { id: 'copy', label: isLink ? 'Copy link' : 'Copy path', kind: 'local' },
    { id: 'dismiss', label: 'Dismiss', kind: 'mark' },
  ]
}

/**
 * A press on a Files row. Dismiss and Restore change the rows and never touch the file; the other actions leave the
 * rows and return what the host runs. A press on a row that is gone, or with an action the row does not offer, does
 * nothing.
 */
export function applyFilePress(
  rows: FileRow[],
  id: string,
  action: FileAction,
): { rows: FileRow[]; effect: FileEffect } {
  const row = rows.find(r => r.id === id)
  if (!row || !fileActions(row).some(a => a.id === action)) return { rows, effect: null }
  switch (action) {
    case 'dismiss':
      return { rows: setDismissed(rows, id, true), effect: null }
    case 'restore':
      return { rows: setDismissed(rows, id, false), effect: null }
    case 'open':
      return { rows, effect: { kind: 'open', target: row.target } }
    case 'finder':
      return { rows, effect: { kind: 'reveal', path: row.target } }
    case 'copy':
      return { rows, effect: { kind: 'copy', text: row.target } }
  }
}
