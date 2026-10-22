import { describe, expect, test } from 'claude-code/testing'

import {
  addFile,
  applyFilePress,
  fileActions,
  fileKind,
  isDocument,
  mergeFiles,
  setDismissed,
  shownFiles,
  whereLabel,
  type FileRow,
} from '../hooks/files'

const row = (target: string, at: number, isDismissed = false): FileRow => ({
  id: target,
  kind: 'md',
  name: target.split('/').pop() ?? target,
  target,
  where: 'repo',
  at,
  isDismissed,
})

describe('isDocument', () => {
  test('takes the document extensions in any case', () => {
    for (const ext of ['md', 'html', 'pdf', 'png', 'jpg', 'svg', 'csv']) {
      expect(isDocument(`/w/a.${ext}`)).toBe(true)
      expect(isDocument(`/w/a.${ext.toUpperCase()}`)).toBe(true)
    }
  })

  test('leaves out source files and names with no extension', () => {
    expect(isDocument('/w/a.ts')).toBe(false)
    expect(isDocument('/w/a.json')).toBe(false)
    expect(isDocument('/w/Makefile')).toBe(false)
  })
})

describe('addFile', () => {
  test('adds a target once', () => {
    const { id: _id, isDismissed: _d, ...fresh } = row('/w/a.md', 1)
    expect(addFile(addFile([], fresh), fresh)).toHaveLength(1)
  })

  test('leaves a dismissed row dismissed', () => {
    const { id: _id, isDismissed: _d, ...fresh } = row('/w/a.md', 1)
    const rows = addFile(setDismissed(addFile([], fresh), '/w/a.md', true), fresh)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.isDismissed).toBe(true)
  })
})

describe('mergeFiles', () => {
  test('keeps saved dismissals and rows added meanwhile', () => {
    const merged = mergeFiles([row('/w/a.md', 1, true)], [row('/w/a.md', 2), row('/w/b.md', 3)])
    expect(merged.map(r => [r.target, r.isDismissed])).toEqual([
      ['/w/a.md', true],
      ['/w/b.md', false],
    ])
  })
})

describe('shownFiles', () => {
  test('sorts newest first and splits off dismissed rows', () => {
    const { open, dismissed } = shownFiles([row('/w/a.md', 1), row('/w/b.md', 3), row('/w/c.md', 2, true)])
    expect(open.map(r => r.target)).toEqual(['/w/b.md', '/w/a.md'])
    expect(dismissed.map(r => r.target)).toEqual(['/w/c.md'])
  })
})

describe('whereLabel', () => {
  test('names where a target lives', () => {
    expect(whereLabel('/w/docs/a.md', '/w')).toBe('repo')
    expect(whereLabel('/w/.claude/plans/a.md', '/w')).toBe('.claude')
    expect(whereLabel('/w/.inbox/plans/a.md', '/w')).toBe('.inbox')
    expect(whereLabel('/tmp/x/a.html', '/w')).toBe('scratch')
    expect(whereLabel('http://localhost:5/x', '/w')).toBe('localhost')
    expect(whereLabel('https://claude.ai/artifact/1', '/w')).toBe('claude.ai')
  })

  test('does not take a sibling folder for the repo', () => {
    expect(whereLabel('/w2/a.md', '/w')).toBe('scratch')
  })
})

describe('fileKind', () => {
  test('names the kind from the target', () => {
    expect(fileKind('http://localhost:5/x', false)).toBe('link')
    expect(fileKind('/w/.inbox/plans/a.md', true)).toBe('plan')
    expect(fileKind('/w/a.md', false)).toBe('md')
    expect(fileKind('/w/a.png', false)).toBe('image')
    expect(fileKind('/w/a.svg', false)).toBe('image')
  })
})

describe('fileKind for other files', () => {
  test('names a file with no document extension a file', () => {
    expect(fileKind('/w/out.log', false)).toBe('file')
    expect(fileKind('/w/Makefile', false)).toBe('file')
  })
})

describe('fileActions', () => {
  const kinds = (r: FileRow) => fileActions(r).map(a => [a.id, a.label, a.kind])

  test('a file opens, shows in Finder, copies its path and dismisses', () => {
    expect(kinds(row('/w/a.md', 1))).toEqual([
      ['open', 'Open', 'local'],
      ['finder', 'Finder', 'local'],
      ['copy', 'Copy path', 'local'],
      ['dismiss', 'Dismiss', 'mark'],
    ])
  })

  test('a link or artifact opens, copies its link and dismisses', () => {
    for (const kind of ['link', 'artifact'] as const)
      expect(kinds({ ...row('https://claude.ai/code/artifact/1', 1), kind })).toEqual([
        ['open', 'Open', 'local'],
        ['copy', 'Copy link', 'local'],
        ['dismiss', 'Dismiss', 'mark'],
      ])
  })

  test('a dismissed row only restores', () => {
    expect(kinds(row('/w/a.md', 1, true))).toEqual([['restore', 'Restore', 'mark']])
  })
})

describe('applyFilePress', () => {
  const rows = [row('/w/a.md', 1), row('https://x.dev/p', 2), row('/w/c.md', 3, true)]

  test('dismiss and restore change the row and have no effect', () => {
    const dismissed = applyFilePress(rows, '/w/a.md', 'dismiss')
    expect(dismissed.effect).toBeNull()
    expect(dismissed.rows.find(r => r.id === '/w/a.md')?.isDismissed).toBe(true)
    const restored = applyFilePress(rows, '/w/c.md', 'restore')
    expect(restored.effect).toBeNull()
    expect(restored.rows.find(r => r.id === '/w/c.md')?.isDismissed).toBe(false)
  })

  test('open, finder and copy leave the rows and return their effect', () => {
    expect(applyFilePress(rows, '/w/a.md', 'open')).toEqual({ rows, effect: { kind: 'open', target: '/w/a.md' } })
    expect(applyFilePress(rows, '/w/a.md', 'finder')).toEqual({ rows, effect: { kind: 'reveal', path: '/w/a.md' } })
    expect(applyFilePress(rows, '/w/a.md', 'copy')).toEqual({ rows, effect: { kind: 'copy', text: '/w/a.md' } })
    expect(applyFilePress(rows, 'https://x.dev/p', 'copy').effect).toEqual({ kind: 'copy', text: 'https://x.dev/p' })
  })

  test('a press on a row that is gone, or an action the row does not offer, does nothing', () => {
    expect(applyFilePress(rows, '/w/gone.md', 'open')).toEqual({ rows, effect: null })
    expect(applyFilePress(rows, 'https://x.dev/p', 'finder')).toEqual({ rows, effect: null })
    expect(applyFilePress(rows, '/w/c.md', 'open')).toEqual({ rows, effect: null })
  })
})
