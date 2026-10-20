import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HookDeps, HookInput } from '../src/hook'
import type { Run } from '../../hooks/gh'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'inbox-codex-'))
}

export function fakeRunner(answer: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  const calls: string[][] = []
  const exec: Run = args => {
    calls.push(args)
    return Promise.resolve(answer(args))
  }

  return { exec, calls }
}

export function hookDeps(dir: string, now = () => 1000): HookDeps & { updates: string[] } {
  const updates: string[] = []

  return {
    dir,
    env: { CODEX_CLI_PATH: '/apps/codex' },
    now,
    startUpdate: id => updates.push(id),
    updates,
  }
}

export function input(event: string, fields: Partial<HookInput> = {}): HookInput {
  return { hook_event_name: event, session_id: 's1', transcript_path: join(tmpdir(), 'rollout.jsonl'), ...fields }
}

export const ROLLOUT_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'rollout.jsonl')

export function rolloutCopy(): string {
  const path = join(tempDir(), 'rollout.jsonl')
  copyFileSync(ROLLOUT_FIXTURE, path)

  return path
}
