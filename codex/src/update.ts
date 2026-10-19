import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { systemText } from '../../hooks/model-text'
import { reconcileUpdateStatus as reconcileStatus, runUpdates as runSessionUpdates } from '../../hooks/session-host'
import type { Ask } from '../../hooks/session-host'
import { codexStore } from './host'
import type { SessionState } from './state'
import { CODEX } from './texts'
import type { Run } from './run'

/** The inbox model, at low reasoning effort. gpt-6-luna is faster but closed a finding the reply only mentioned. */
export const MODEL = 'gpt-6.1-sol'
const TIMEOUT_MS = 120_000

/** A release that drops one of these rejects it by name, so askModel drops any name rejected and tries again. */
const OFF = [
  'shell_tool',
  'unified_exec',
  'code_mode_host',
  'apps',
  'plugins',
  'memories',
  'multi_agent',
  'image_generation',
  'browser_use',
  'computer_use',
  'tool_suggest',
  'skill_search',
  'view_image',
  'goals',
  'sleep_tool',
  'personality',
]

/** Null when it fails. */
export function codexAsk(exec: Run, cli: string, dir: string): Ask {
  return async prompt => {
    const work = join(dir, 'exec')
    const system = join(dir, 'inbox-system.md')
    const out = join(work, `reply-${randomUUID()}.txt`)
    await mkdir(work, { recursive: true })
    const instructions = systemText(CODEX)
    if ((await readFile(system, 'utf8').catch(() => '')) !== instructions) await writeFile(system, instructions)
    let off = [...OFF]
    for (let tries = 0; tries <= OFF.length; tries += 1) {
      await rm(out, { force: true })
      const r = await exec(
        [
          cli,
          'exec',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '-C',
          work,
          '-m',
          MODEL,
          '-c',
          'model_reasoning_effort="low"',
          '-c',
          `model_instructions_file=${JSON.stringify(system)}`,
          '-c',
          'project_doc_max_bytes=0',
          ...off.flatMap(f => ['--disable', f]),
          '-o',
          out,
          prompt,
        ],
        { cwd: work, timeoutMs: TIMEOUT_MS },
      )
      const unknown = r.stderr.match(/Unknown feature flag: (\S+)/)?.[1]
      if (r.code !== 0 && unknown && off.includes(unknown)) {
        off = off.filter(f => f !== unknown)
        continue
      }
      if (r.code !== 0) return null
      const text = await readFile(out, 'utf8').catch(() => null)
      await rm(out, { force: true })

      return text
    }

    return null
  }
}

export const reconcileUpdateStatus = (dir: string, sessionId: string): Promise<SessionState> =>
  reconcileStatus(codexStore(dir, sessionId, Date.now))

export const runUpdates = (dir: string, sessionId: string, ask: Ask, now: () => number): Promise<void> =>
  runSessionUpdates({ ...codexStore(dir, sessionId, now), ask })
