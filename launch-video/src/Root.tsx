import { Composition } from 'remotion'

import { FPS, HEIGHT, timeline, totalFrames, VARIANTS, WIDTH } from './timeline'
import { Video } from './Video'

export function Root() {
  return (
    <>
      {VARIANTS.map(variant => (
        <Composition
          key={variant}
          id={variant}
          component={Video}
          durationInFrames={totalFrames(timeline(variant))}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ variant }}
        />
      ))}
    </>
  )
}
