import { statePath, readState, tryWithLock, updateState } from './state'
import type { SessionState } from './state'
import type { SessionHost } from '../../hooks/session-host'

/** The members that read and change one session's file. The update lock is a `.updating` file beside it. */
export function codexStore(
  dir: string,
  sessionId: string,
  now: () => number,
): Pick<SessionHost<SessionState>, 'now' | 'read' | 'update' | 'exclusive'> {
  return {
    now,
    read: () => readState(dir, sessionId),
    update: change => updateState(dir, sessionId, change),
    exclusive: fn => tryWithLock(`${statePath(dir, sessionId)}.updating`, fn),
  }
}
