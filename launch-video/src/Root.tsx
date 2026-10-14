import { Composition } from 'remotion'

import { Outro, OUTRO_SECONDS, OUTRO_VARIANTS } from './Outro'

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
      {OUTRO_VARIANTS.map(variant => (
        <Composition
          key={`outro-${variant}`}
          id={`outro-${variant}`}
          component={Outro}
          durationInFrames={OUTRO_SECONDS * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ variant }}
        />
      ))}
    </>
  )
}
