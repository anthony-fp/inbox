import type { ClientModule } from 'claude-code'

/**
 * The click area over a desktop Undo button. The button itself is an Svg the hooks module draws, with a fill
 * that drains on its own, and the mod gets no clicks from an Svg. So this Client lies over it, draws a
 * translucent rounded highlight while the pointer is on it, and posts its key on a click.
 */

export type UndoProps = {
  /** The key the hooks module presses when this is clicked. */
  pressKey: string
  /** The highlight drawn while the pointer is over the button. */
  hover: string
}

type State = { hover: boolean }

const Undo: ClientModule<UndoProps, State> = (props, surface) => {
  const { Box } = surface.elements
  const hover = surface.state?.hover ?? false
  // Set on every call, so the listener reads this call's props.
  surface.onPointer(e => {
    const inside =
      e.type !== 'leave' && e.x >= 0 && e.x < surface.columns && e.y >= 0 && e.y < Math.max(1, surface.rows)
    if (inside !== hover) surface.setState({ hover: inside })
    if (e.type === 'down' && e.button === 'left' && inside) surface.post({ key: props.pressKey })
  })

  return Box({
    width: '100%',
    height: '100%',
    ...(hover ? { backgroundColor: props.hover, borderStyle: 'single', borderColor: '#0000' } : {}),
  })
}

export default Undo
