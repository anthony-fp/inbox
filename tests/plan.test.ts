import { describe, expect, test } from 'claude-code/testing'

import { parsePlan, planNote, planPath } from '../hooks/plan'

describe('parsePlan', () => {
  test('reads tasks, marks and counts', () => {
    const plan = parsePlan('## A\n- [x] one\n- [~] two\n## B\n- [ ] three')
    expect(plan?.tasks.map(t => t.title)).toEqual(['A', 'B'])
    expect(plan?.done).toBe(1)
    expect(plan?.total).toBe(3)
    expect(plan?.current).toEqual([{ text: 'two', mark: 'current' }])
    expect(plan?.tasks.map(t => t.isOpen)).toEqual([true, false])
  })

  test('keeps every task with a current step open', () => {
    const plan = parsePlan('## A\n- [~] one\n## B\n- [~] two\n## C\n- [ ] three')
    expect(plan?.tasks.map(t => t.isOpen)).toEqual([true, true, false])
    expect(plan?.current.map(s => s.text)).toEqual(['one', 'two'])
  })

  test('puts steps before any heading in an untitled task', () => {
    expect(parsePlan('- [ ] first\n## A\n- [ ] second')?.tasks.map(t => t.title)).toEqual(['', 'A'])
  })

  test('reads upper-case x, indented steps and star bullets, and skips other lines', () => {
    const plan = parsePlan('## A\nprose\n- [X] up\n  - [ ] nested\n* [~] star\n- plain')
    expect(plan?.tasks[0]?.steps).toEqual([
      { text: 'up', mark: 'done' },
      { text: 'nested', mark: 'waiting' },
      { text: 'star', mark: 'current' },
    ])
  })

  test('returns null when the text holds no step', () => {
    expect(parsePlan('')).toBeNull()
    expect(parsePlan('# Title\nprose')).toBeNull()
  })

  test('drops a heading with no steps', () => {
    expect(parsePlan('# Plan\n## A\n- [ ] one')?.tasks.map(t => t.title)).toEqual(['A'])
  })
})

describe('planPath', () => {
  test('puts the plan under .claude/plans by session id', () => {
    expect(planPath('/w', 'abc')).toBe('/w/.claude/plans/abc.md')
  })
})

describe('planNote', () => {
  const path = '/w/.claude/plans/abc.md'

  test('names the path, the three-step rule, the marks and when to change them', () => {
    const note = planNote(path, null)
    expect(note).toContain(path)
    expect(note).toContain('three or more steps')
    expect(note).toContain('`- [ ]`')
    expect(note).toContain('`- [~]`')
    expect(note).toContain('`- [x]`')
    expect(note).toMatch(/`\[~\]` when you start/)
    expect(note).toMatch(/`\[x\]` when you finish/)
  })

  test("lists each current step's text", () => {
    const note = planNote(path, parsePlan('## A\n- [x] one\n- [~] two\n## B\n- [~] three\n- [ ] four'))
    expect(note).toContain('two')
    expect(note).toContain('three')
    expect(note).not.toContain('four')
  })
})
