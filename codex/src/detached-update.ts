import { spawn } from 'node:child_process'

/** Starts the update in a detached process, so a model call longer than the hook's limit still finishes. */
export function detachedUpdate(dir: string, env: NodeJS.ProcessEnv, script: string): (sessionId: string) => void {
  return sessionId => {
    const child = spawn(process.execPath, [script, sessionId], {
      detached: true,
      stdio: 'ignore',
      env: { ...env, INBOX_DATA: dir },
    })
    child.unref()
  }
}
