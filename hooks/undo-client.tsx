import type { ClientModule } from 'claude-code'

/**
 * Undo on a just-closed desktop row, with a fill that drains while its time lasts, as the Codex tab's Undo does. A
 * desktop Button is the app's native button and draws no fill, so Undo is drawn here. The fill ticks inside this
 * region, since redrawing the pane every fraction of a second breaks clicks on its Buttons
 * (anthropics/claude-code#100924). A click anywhere on it posts its key to the hooks module, which presses Undo.
 */

export type UndoProps = {
  /** The key the hooks module presses when this is clicked. */
  pressKey: string
  label: string
  /** When the row closed, on the hooks module's clock. */
  startedAt: number
  /** How long the row stays in place. */
  totalMs: number
  /** A null color is the theme's own. */
  colors: { rest: string | null; fill: string | null; hover: string | null; text: string | null }
}

type State = { now: number; hover: boolean }

const TICK_MS = 100

const Undo: ClientModule<UndoProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const leftAt = (now: number) => Math.max(0, props.totalMs - (now - props.startedAt))
  const state = (): State => surface.state ?? { now: Date.now(), hover: false }
  // Started once, while the state is still undefined; the timer stops when the fill is empty.
  if (surface.state === undefined) {
    surface.setState({ now: Date.now(), hover: false })
    const stop = surface.every(TICK_MS, () => {
      const now = Date.now()
      surface.setState({ ...state(), now })
      if (leftAt(now) === 0) stop()
    })
  }
  // Set on every call, so the listener reads this call's props.
  surface.onPointer(e => {
    const inside =
      e.type !== 'leave' && e.x >= 0 && e.x < surface.columns && e.y >= 0 && e.y < Math.max(1, surface.rows)
    if (inside !== state().hover) surface.setState({ ...state(), hover: inside })
    if (e.type === 'down' && e.button === 'left' && inside) surface.post({ key: props.pressKey })
  })

  const cells = [...props.label]
  const filled = Math.ceil((leftAt(state().now) / props.totalMs) * cells.length)
  const rest = state().hover ? props.colors.hover : props.colors.rest
  const fill = props.colors.fill
  const text = props.colors.text ? { color: props.colors.text } : {}

  return Box({
    flexDirection: 'row',
    ...(rest ? { backgroundColor: rest } : {}),
    children: Text({
      ...text,
      children: [
        Text({ ...text, ...(fill ? { backgroundColor: fill } : {}), children: cells.slice(0, filled).join('') }),
        cells.slice(filled).join(''),
      ],
    }),
  })
}

export default Undo
