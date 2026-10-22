/** A session's plan: the outline Claude writes for multi-step work, and what the Now tab reads from it. */

export type StepMark = 'waiting' | 'current' | 'done'

export type PlanStep = { text: string; mark: StepMark }

/** A heading and its steps. A task is open while one of its steps is current. */
export type PlanTask = { title: string; steps: PlanStep[]; isOpen: boolean }

export type PlanView = { tasks: PlanTask[]; done: number; total: number; current: PlanStep[] }

const HEADING = /^#{1,6}\s+(.*)$/
const STEP = /^\s*[-*]\s\[( |~|x|X)\]\s+(.*)$/

const MARKS: Record<string, StepMark> = { ' ': 'waiting', '~': 'current', x: 'done', X: 'done' }

/** Reads a plan file's tasks and steps, or null when it holds no checkbox step. */
export function parsePlan(text: string): PlanView | null {
  const tasks: { title: string; steps: PlanStep[] }[] = []
  let task: { title: string; steps: PlanStep[] } | null = null

  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      task = { title: heading[1]!.trim(), steps: [] }
      tasks.push(task)
      continue
    }
    const step = STEP.exec(line)
    if (!step) continue
    if (!task) {
      task = { title: '', steps: [] }
      tasks.push(task)
    }
    task.steps.push({ text: step[2]!.trim(), mark: MARKS[step[1]!]! })
  }

  const withSteps = tasks.filter(t => t.steps.length > 0)
  if (withSteps.length === 0) return null
  const steps = withSteps.flatMap(t => t.steps)

  return {
    tasks: withSteps.map(t => ({ ...t, isOpen: t.steps.some(s => s.mark === 'current') })),
    done: steps.filter(s => s.mark === 'done').length,
    total: steps.length,
    current: steps.filter(s => s.mark === 'current'),
  }
}

/** Where a session's plan lives: one file per session, so sessions in one worktree never share a plan. */
export function planPath(worktree: string, sessionId: string): string {
  return `${worktree}/.claude/plans/${sessionId}.md`
}
