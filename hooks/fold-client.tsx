import type { ClientModule } from 'claude-code'

/**
 * A list's "N closed" line in the desktop pane. A Button takes a click only
 * on its label, so the line is drawn here instead: this region gets the
 * pointer over every cell of the line, draws the hover, and posts the fold
 * state the click asks for to the hooks module, which sets it. It also posts
 * the hover, since the hooks module draws the chevron, an Svg a Client cannot.
 */

export type FoldProps = {
  /** The mark column's width, in columns: the label starts where the rows' text does. The hooks module draws the
   * chevron there. */
  markCells: number
  count: number
  isUnfolded: boolean
  /** Lines of padding above and below the text. The hover covers it. */
  padY: number
  /** A null color is the theme's own. */
  colors: { rest: string | null; text: string | null; hoverText: string | null }
}

type State = { hover: boolean }

const Fold: ClientModule<FoldProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hover = surface.state?.hover ?? false
  // Reads the state when an event arrives: two events can both arrive before the next call.
  const set = (next: State) => {
    if (next.hover === (surface.state?.hover ?? false)) return
    surface.setState(next)
    surface.post({ hover: next.hover })
  }
  surface.onPointer(e => {
    if (e.type === 'leave') return set({ hover: false })
    // While a button is held, moves arrive past the region's edges too. `surface.rows` rounds the
    // padded height down, so the padding is added back.
    const inside = e.x >= 0 && e.x < surface.columns && e.y >= 0 && e.y < surface.rows + 2 * props.padY
    if (e.type === 'down' && e.button === 'left') {
      // The target comes from the drawn props, so a second click before the redraw asks for the same state.
      set({ hover: true })
      surface.post({ isUnfolded: !props.isUnfolded })
    } else if (e.type === 'up' || e.type === 'move' || e.type === 'enter') set({ hover: inside })
  })

  const background = props.colors.rest
  const color = hover && props.colors.hoverText ? props.colors.hoverText : props.colors.text

  // The pane's row frame: a rounded Box with a transparent border, as the hooks module's own lines draw.
  return Box({
    flexDirection: 'row',
    borderStyle: 'single',
    borderColor: '#0000',
    paddingY: props.padY,
    ...(background ? { backgroundColor: background } : {}),
    children: [
      Box({ width: props.markCells, flexShrink: 0 }),
      Text({ ...(color ? { color } : {}), children: `${props.count} closed` }),
    ],
  })
}

export default Fold
