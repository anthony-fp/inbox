import type { ReplyHolds } from '../../hooks/view'
import { INITIAL_UI, handleKey, holdsOf, isAnimating, noticeFor, render } from './panel'
import type { PanelPress, PanelScreen, PanelUi, Style } from './panel'

const ANIMATION_MS = 200
const PRS_CHECK_MS = 120_000

/** What the panel needs from a session, so the live inbox and the demo can both supply it. */
export type PanelSource = {
  screen(holds: ReplyHolds): Promise<PanelScreen>
  press(p: PanelPress, holds: ReplyHolds): Promise<{ error: string | null; note: 'stale' | 'sample' | null }>
  fetchPrsWhenDue(): void
  /** Calls `listener` after the session's saved state changes. Returns how to stop. */
  onChange(listener: () => void): () => void
}

export type PanelDeps = {
  source: PanelSource
  style: Style
  now(): number
  requestRender(): void
  /** Closes the panel. */
  close(): void
  timers: { every(fn: () => void, ms: number): unknown; stop(handle: unknown): void }
  /** The rows the terminal has, or undefined when the panel may grow. */
  height(): number | undefined
}

export type Panel = {
  render(width: number): string[]
  /** `key` is the parsed key name and `text` the printable text the key types. */
  handleInput(key: string, text?: string): void
  start(): Promise<void>
  dispose(): void
}

/**
 * The open panel: the cached screen, the person's ui state, and the work a key starts. A redraw timer runs only while
 * something on the screen moves by itself.
 */
export function createPanel(deps: PanelDeps): Panel {
  const { source, style, timers } = deps
  let ui: PanelUi = INITIAL_UI
  let screen: PanelScreen | null = null
  let animation: unknown = null
  let version = 0
  const stops: (() => void)[] = []

  const syncAnimation = () => {
    const isMoving = screen !== null && isAnimating(screen, ui, deps.now())
    if (isMoving && animation === null) animation = timers.every(() => void refresh(), ANIMATION_MS)
    if (!isMoving && animation !== null) {
      timers.stop(animation)
      animation = null
    }
  }

  async function refresh(): Promise<void> {
    const mine = ++version
    const next = await source.screen(holdsOf(ui)).catch(() => null)
    if (mine !== version || next === null) return
    screen = next
    syncAnimation()
    deps.requestRender()
  }

  async function press(p: PanelPress): Promise<void> {
    const outcome = await source.press(p, holdsOf(ui)).catch((err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
      note: null,
    }))
    const now = deps.now()
    if (!('ref' in p) && p.action === 'type' && outcome.note === 'stale')
      ui = { ...ui, drafts: { ...ui.drafts, [p.id]: { text: p.text, since: now } } }
    const notice = noticeFor(outcome, now)
    if (notice) ui = { ...ui, notice }
    await refresh()
  }

  return {
    render: width => (screen ? render(screen, ui, width, deps.now(), style, deps.height()) : [' Loading…']),
    handleInput(key, text) {
      if (screen === null) return
      const result = handleKey(screen, ui, key, deps.now(), text)
      ui = result.ui
      if (result.close) deps.close()
      if (result.press) void press(result.press)
      else void refresh()
      deps.requestRender()
    },
    async start() {
      stops.push(source.onChange(() => void refresh()))
      const prs = timers.every(() => source.fetchPrsWhenDue(), PRS_CHECK_MS)
      stops.push(() => timers.stop(prs))
      await refresh()
    },
    dispose() {
      version++
      for (const stop of stops.splice(0)) stop()
      if (animation !== null) timers.stop(animation)
      animation = null
    },
  }
}
