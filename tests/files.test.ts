import { describe, expect, test } from 'claude-code/testing'

import {
  addFile,
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
