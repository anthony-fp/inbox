import type { ClientModule } from 'claude-code'

export type ClientLink = { key: string; label: string; width: number }

export type LinksProps = {
  links: ClientLink[]
  gap: number
  /** While the row ignores clicks, as just after it opens, every label stays muted. */
  isGuarded: boolean
  /** A null color is the theme's own. */
  colors: { muted: string | null; hover: string | null }
}

type State = { hover: string | null }

function linkAt(props: LinksProps, x: number): string | null {
  let left = 0
  for (const link of props.links) {
    if (x >= left && x < left + link.width) return link.key
    left += link.width + props.gap
  }

  return null
}

const Links: ClientModule<LinksProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hover = surface.state?.hover ?? null
  // Set on every call, so the listener reads this call's props; a later call replaces it.
  surface.onPointer(e => {
    const at = e.type === 'leave' || e.y < 0 || e.y >= Math.max(1, surface.rows) ? null : linkAt(props, e.x)
    if (at !== (surface.state?.hover ?? null)) surface.setState({ hover: at })
    if (e.type === 'down' && e.button === 'left' && at !== null) surface.post({ key: at })
  })

  return Box({
    flexDirection: 'row',
    gap: props.gap,
    children: props.links.map(link => {
      const color = link.key === hover && !props.isGuarded ? props.colors.hover : props.colors.muted

      return Box({
        key: link.key,
        width: link.width,
        flexShrink: 0,
        children: Text({ ...(color ? { color } : {}), wrap: 'truncate-end', children: link.label }),
      })
    }),
  })
}

export default Links
