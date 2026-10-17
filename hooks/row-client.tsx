import type { ClientModule } from 'claude-code'

/**
 * A closed row in the desktop pane. A Button takes a click only on its label,
 * so the row is drawn here instead: this region gets the pointer over every
 * cell of the row, draws the hover and the press, and posts to the hooks
 * module, which opens the row. The hooks module reads the row from this
 * Client's key, so a post carries nothing.
 *
 * It draws the pane's row frame: a rounded Box with a transparent border, then
 * the mark, the text and the side columns, as the hooks module's own frames do.
 */

export type RowProps = {
  /** The mark column's width, in columns. It stays empty: the hooks module draws the mark. */
  markCells: number
  /** The side column's width, in columns. */
  sideCells: number
  /** Muted, before the title, such as a review thread's path. */
  before: string
  title: string
  /** The row's last action, muted on its own line under the title. */
  after: string
  /** The age, at the side. */
  side: string
  /** Lines of padding above and below the text. The hover covers it. */
  padY: number
  /** How many lines the title and `after` may take before they are cut. */
  maxLines: number
  /** How many characters fit in a cell, counted low, so a clipped line does not wrap. */
  charsPerCell: number
  /** The region's width before its first layout, when `surface.columns` is still 0. */
  fallbackColumns: number
  /** A null color is the theme's own. */
  colors: {
    muted: string | null
    after: string | null
    /** `after` on a row under the pointer or pressed. */
    afterHover: string | null
    /** The age at the side. */
    side: string | null
    hover: string | null
    hoverText: string | null
    pressed: string | null
  }
}

type State = { hover: boolean; pressed: boolean }

/** A title clipped shorter than this reads as nothing, so `after` is cut instead. */
const MIN_TITLE = 12
/** The columns a frame's border takes from its content, both sides together. */
const FRAME_CELLS = 4

/** `text` cut to `max` characters at a space, ending "…". */
function clipAtSpace(text: string, max: number): string {
  if (text.length <= max) return text
  const space = text.lastIndexOf(' ', max - 1)
  const head = space >= Math.min(MIN_TITLE, max) - 1 ? text.slice(0, space) : text.slice(0, max - 1)

  return `${head.trimEnd()}…`
}

/** The title cut to what fits in `budget` characters beside `before`. */
function fitTitle(budget: number, before: string, title: string): string {
  return clipAtSpace(title, Math.max(MIN_TITLE, budget - before.length - 1))
}

const Row: ClientModule<RowProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hover = surface.state?.hover ?? false
  const pressed = surface.state?.pressed ?? false
  // Reads the state when an event arrives: a down and an up can both arrive before the next call.
  const set = (next: State) => {
    if (next.hover !== (surface.state?.hover ?? false) || next.pressed !== (surface.state?.pressed ?? false))
      surface.setState(next)
  }
  surface.onPointer(e => {
    if (e.type === 'leave') return set({ hover: false, pressed: false })
    // While a button is held, moves arrive past the region's edges too. `surface.rows` rounds the
    // padded height down, as 1 for 1.5 lines, so the padding is added back.
    const inside = e.x >= 0 && e.x < surface.columns && e.y >= 0 && e.y < surface.rows + 2 * props.padY
    if (e.type === 'down' && e.button === 'left') {
      set({ hover: true, pressed: true })
      surface.post({})
    } else if (e.type === 'up') set({ hover: inside, pressed: false })
    else if (e.type === 'move' || e.type === 'enter') set({ hover: inside, pressed: surface.state?.pressed ?? false })
  })

  const columns = surface.columns || props.fallbackColumns
  const textCells = columns - FRAME_CELLS - props.markCells - props.sideCells
  const perLine = Math.floor(textCells * props.charsPerCell)
  const title = fitTitle(perLine * props.maxLines, props.before, props.title)
  const after = clipAtSpace(props.after, perLine)
  const background = pressed ? props.colors.pressed : hover ? props.colors.hover : null
  // A raised background can share its color with muted text, so on it all text takes the palette's text for it.
  const isRaised = background !== null && background === props.colors.hover
  const color = (own: string | null) => (isRaised && props.colors.hoverText ? props.colors.hoverText : own)
  const ageColor = background ? props.colors.afterHover : props.colors.after
  const colored = (own: string | null) => {
    const c = color(own)
    return c ? { color: c } : {}
  }

  return Box({
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderStyle: 'single',
    borderColor: '#0000',
    paddingY: props.padY,
    ...(background ? { backgroundColor: background } : {}),
    children: [
      // The hooks module draws the row's mark over this region, hung into the frame's inset, which a Client clips.
      Box({ width: props.markCells, flexShrink: 0 }),
      Box({
        flexDirection: 'column',
        flexShrink: 1,
        flexGrow: 1,
        children: [
          Text({
            wrap: 'wrap',
            ...colored(null),
            children: [
              ...(props.before ? [Text({ ...colored(props.colors.muted), children: props.before })] : []),
              title,
            ],
          }),
          ...(after ? [Text({ wrap: 'truncate-end', ...colored(ageColor), children: after })] : []),
        ],
      }),
      Box({
        width: props.sideCells,
        flexShrink: 0,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        children: Text({ ...colored(props.colors.side), children: props.side }),
      }),
    ],
  })
}

export default Row
