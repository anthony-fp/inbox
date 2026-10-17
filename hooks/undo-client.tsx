import type { ClientModule } from 'claude-code'

export type UndoProps = {
  pressKey: string
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
