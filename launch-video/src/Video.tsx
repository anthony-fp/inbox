import {
  AbsoluteFill,
  Easing,
  getStaticFiles,
  Html5Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion'

import { Pointer } from './Pointer'
import TAKES from './takes.json'
import type { ThreadStarts } from './thread'
import { ThreadView } from './ThreadView'
import {
  clickAt,
  END_CARD,
  FPS,
  frames,
  HEIGHT,
  LOOK_NAMES,
  LOOKS,
  MUSIC,
  stateAt,
  takeClip,
  timeline,
  totalFrames,
  WIDTH,
  WINDOWS,
} from './timeline'
import type { Look, Placed, Point, Rect, Segment, SideBySideBeat, SoloBeat, State, Variant } from './timeline'

type TakeInfo = { width: number; height: number; window?: number[]; beatStartsAt?: number }
const TAKE_INFO = TAKES as Record<string, TakeInfo | undefined>

/** The app window's place on the VM's screen in every take so far, in points, for a take that doesn't record its own. */
const USUAL_WINDOW = [0, 25, 1024]

const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif'
const MONO = '"SF Mono", Menlo, monospace'
const BACKGROUND = '#0c0c0e'
const LOOK_COLORS: Record<Look, string> = { terminal: '#16241a', desktop: '#2a1f16', codex: '#161e2c' }
/** The band above recorded footage that names its app, in pixels. */
const BAND = 72
/** The space around each window in beat 11's wide shot, as a share of the window's width. */
const WIDE_MARGIN = 0.05

export function Video({ variant }: { variant: Variant }) {
  const placed = timeline(variant)
  const starts = Object.fromEntries(placed.filter(b => b.kind === 'thread').map(b => [b.id, b.start])) as ThreadStarts
  const length = totalFrames(placed)
  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND, fontFamily: SANS, color: 'white' }}>
      {isCaptured(MUSIC.src) && (
        <Html5Audio
          src={staticFile(MUSIC.src)}
          trimBefore={frames(MUSIC.trimBefore)}
          volume={f =>
            interpolate(f, [length - frames(MUSIC.fadeOut), length], [1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          }
        />
      )}
      {placed.map(beat => (
        <Sequence
          key={beat.id}
          name={`${beat.number} ${beat.id}`}
          from={frames(beat.start)}
          durationInFrames={frames(beat.start + beat.length) - frames(beat.start)}
        >
          <BeatView beat={beat} variant={variant} starts={starts} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

function BeatView({ beat, variant, starts }: { beat: Placed; variant: Variant; starts: ThreadStarts }) {
  const t = useCurrentFrame() / FPS
  const hasCaptions = variant !== 'captions-off'
  return (
    <AbsoluteFill>
      {beat.kind === 'thread' && (
        <>
          <ThreadView starts={starts} t={beat.start + t} />
          {hasCaptions && <Caption text={beat.caption} />}
        </>
      )}
      {beat.kind === 'solo' && <SoloView beat={beat} t={t} hasCaptions={hasCaptions} />}
      {beat.kind === 'side-by-side' && <SideBySideView beat={beat} t={t} hasCaptions={hasCaptions} />}
      {beat.kind === 'end' && <EndCardView t={t} />}
      {beat.kind !== 'end' && (
        <div style={{ position: 'absolute', right: 24, bottom: 16, fontFamily: MONO, fontSize: 18, color: '#5e5e66' }}>
          Beat {beat.number} · {(beat.start + t).toFixed(2)} s
        </div>
      )}
    </AbsoluteFill>
  )
}

/** Maps a VM screen point to pixels in a take's clip, or in a still of the same window. */
function toClip(take: string | undefined, clipWidth: number) {
  const [left = 0, top = 0, width = 1024] = (take && TAKE_INFO[take]?.window) || USUAL_WINDOW
  const scale = clipWidth / width
  return ([x, y]: Point) => ({ x: (x - left) * scale, y: (y - top) * scale })
}

function AppLabel({ look, left, width }: { look: Look; left: number; width: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        width,
        top: 0,
        height: BAND,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          padding: '6px 18px',
          borderRadius: 999,
          backgroundColor: '#24242a',
          color: '#e4e4ea',
          fontSize: 26,
          fontWeight: 600,
        }}
      >
        {LOOK_NAMES[look]}
      </div>
    </div>
  )
}

function SoloView({ beat, t, hasCaptions }: { beat: SoloBeat; t: number; hasCaptions: boolean }) {
  const footage = beat.footage?.every(s => isCaptured(takeClip(s.take))) ? beat.footage : undefined
  const area = { x: 0, y: BAND, w: WIDTH, h: HEIGHT - BAND }
  const take = footage?.[0]?.take
  const clip = take ? TAKE_INFO[take] : undefined
  const clipSize = { w: clip?.width ?? WINDOWS[beat.look].width, h: clip?.height ?? WINDOWS[beat.look].height }
  const fit = Math.min(area.w / clipSize.w, area.h / clipSize.h)
  const offset = { x: area.x + (area.w - clipSize.w * fit) / 2, y: area.y + (area.h - clipSize.h * fit) / 2 }
  const map = toClip(take, clipSize.w)
  const onScreen = (p: Point) => {
    const c = map(p)
    return { x: offset.x + c.x * fit, y: offset.y + c.y * fit }
  }
  const clicks = beat.states.flatMap(s => (s.click ? [{ at: clickAt(s), ...onScreen(s.click) }] : []))
  return (
    <AbsoluteFill>
      <AppLabel look={beat.look} left={0} width={WIDTH} />
      <div
        style={{
          position: 'absolute',
          left: offset.x,
          top: offset.y,
          width: clipSize.w * fit,
          height: clipSize.h * fit,
          overflow: 'hidden',
        }}
      >
        {footage ? (
          <Footage segments={footage} length={beat.length} width={clipSize.w * fit} height={clipSize.h * fit} />
        ) : (
          <Picture
            look={beat.look}
            state={stateAt(beat.states, t)}
            t={t}
            width={clipSize.w * fit}
            height={clipSize.h * fit}
          />
        )}
      </div>
      <Pointer from={onScreen(beat.pointerFrom)} clicks={clicks} t={t} />
      {hasCaptions && <Caption text={beat.caption} />}
    </AbsoluteFill>
  )
}

function SideBySideView({ beat, t, hasCaptions }: { beat: SideBySideBeat; t: number; hasCaptions: boolean }) {
  const width = WIDTH / LOOKS.length
  const height = HEIGHT - BAND
  return (
    <AbsoluteFill>
      {LOOKS.map((look, i) => {
        const window = WINDOWS[look]
        const take = beat.takes?.[look]
        const takeStart = take === undefined ? undefined : TAKE_INFO[take]?.beatStartsAt
        const isRecorded = take !== undefined && takeStart !== undefined && isCaptured(takeClip(take))
        const startsAt = beat.pushInAt + i * beat.stagger
        const progress = interpolate(t, [startsAt, startsAt + beat.pushInLength], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.inOut(Easing.cubic),
        })
        const margin = window.width * WIDE_MARGIN
        const whole = { x: -margin, y: -margin, w: window.width + 2 * margin, h: window.height + 2 * margin }
        const shown = between(whole, window.inbox, progress)
        const scale = Math.min(width / shown.w, height / shown.h)
        const x = width / 2 - (shown.x + shown.w / 2) * scale
        const y = height / 2 - (shown.y + shown.h / 2) * scale
        const map = toClip(isRecorded ? take : undefined, window.width)
        const onScreen = (p: Point) => {
          const c = map(p)
          return { x: x + c.x * scale, y: y + c.y * scale }
        }
        const states = beat.states[look]
        const clicks = states.flatMap(s => (s.click ? [{ at: clickAt(s), ...onScreen(s.click) }] : []))
        return (
          <div key={look}>
            <AppLabel look={look} left={i * width} width={width} />
            <div style={{ position: 'absolute', left: i * width, top: BAND, width, height, overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  width: window.width,
                  height: window.height,
                  transformOrigin: '0 0',
                  transform: `translate(${x}px, ${y}px) scale(${scale})`,
                }}
              >
                {isRecorded ? (
                  <OffthreadVideo
                    src={staticFile(takeClip(take))}
                    trimBefore={frames(takeStart)}
                    muted
                    style={{ width: window.width, height: window.height, display: 'block' }}
                  />
                ) : (
                  <Picture
                    look={look}
                    state={stateAt(states, t)}
                    t={t}
                    width={window.width}
                    height={window.height}
                    inbox={window.inbox}
                  />
                )}
              </div>
              {t >= startsAt + beat.pushInLength && (
                <Pointer from={onScreen(beat.pointerFrom[look])} clicks={clicks} t={t} />
              )}
            </div>
          </div>
        )
      })}
      {hasCaptions && t >= beat.captionFrom && <Caption text={beat.caption} />}
    </AbsoluteFill>
  )
}

function between(a: Rect, b: Rect, p: number): Rect {
  const mix = (from: number, to: number) => from + (to - from) * p
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) }
}

/** Each segment of a take, played from its point in the take until the next segment or the beat's end. */
function Footage(props: { segments: Segment[]; length: number; width: number; height: number }) {
  const { segments, length, width, height } = props
  return (
    <>
      {segments.map((segment, i) => {
        const end = segments[i + 1]?.at ?? length
        return (
          <Sequence
            key={`${segment.take}-${segment.at}`}
            from={frames(segment.at)}
            durationInFrames={frames(end) - frames(segment.at)}
          >
            <OffthreadVideo
              src={staticFile(takeClip(segment.take))}
              trimBefore={frames(segment.from)}
              muted
              style={{ width, height, display: 'block' }}
            />
          </Sequence>
        )
      })}
    </>
  )
}

let captured: Set<string> | undefined
/** Git ignores public/stills/ and public/takes/, so a checkout without the captures draws placeholders instead of failing to load. */
const isCaptured = (still: string) => (captured ??= new Set(getStaticFiles().map(f => f.name))).has(still)

/** A captured still when the state has one, else a placeholder that names the app and what it shows. */
function Picture(props: {
  look: Look
  state: State | undefined
  t: number
  width: number
  height: number
  inbox?: Rect
}) {
  const { look, state, t, width, height, inbox } = props
  if (state?.still && isCaptured(state.still))
    return <Img src={staticFile(state.still)} style={{ width, height, objectFit: 'contain', display: 'block' }} />

  const label = state?.label ?? ''
  if (!inbox && state?.pane)
    return (
      <div style={{ width, height, backgroundColor: LOOK_COLORS[look], position: 'relative', display: 'flex' }}>
        <div style={{ flex: 3, padding: '120px 80px 0 120px' }}>
          <div style={{ fontSize: 32, color: '#b9b9c0' }}>{LOOK_NAMES[look]} · conversation</div>
          <div style={{ marginTop: 200, fontSize: 56, fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
        </div>
        <div style={{ flex: 2, padding: '120px 80px 0 64px', borderLeft: '3px solid #3a3a42' }}>
          <div style={{ fontSize: 32, color: '#b9b9c0' }}>Inbox, docked</div>
          <div style={{ marginTop: 200, fontSize: 48, fontWeight: 600, lineHeight: 1.2 }}>{state.pane}</div>
          <Drain state={state} t={t} />
        </div>
      </div>
    )

  if (!inbox)
    return (
      <div style={{ width, height, backgroundColor: LOOK_COLORS[look], position: 'relative' }}>
        <div style={{ position: 'absolute', left: 120, top: 120, fontSize: 32, color: '#b9b9c0' }}>
          {LOOK_NAMES[look]}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 120,
            right: 120,
            top: 360,
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1.2,
          }}
        >
          {label}
          {state && <Drain state={state} t={t} />}
        </div>
      </div>
    )

  return (
    <div
      style={{ width, height, backgroundColor: '#18181c', borderRadius: 24, overflow: 'hidden', position: 'relative' }}
    >
      <div
        style={{
          height: 72,
          backgroundColor: '#25252b',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 40,
          gap: 16,
          fontSize: 30,
          color: '#c9c9d0',
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map(color => (
          <div key={color} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color }} />
        ))}
        <div style={{ marginLeft: 24 }}>{LOOK_NAMES[look]}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: inbox.x,
          top: inbox.y,
          width: inbox.w,
          height: inbox.h,
          backgroundColor: LOOK_COLORS[look],
          border: '3px solid #3a3a42',
          borderRadius: 16,
          padding: 40,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 28, color: '#9a9aa2', marginBottom: 24 }}>Inbox · {LOOK_NAMES[look]}</div>
        <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
        {state && <Drain state={state} t={t} />}
      </div>
    </div>
  )
}

function Drain({ state, t }: { state: State; t: number }) {
  if (!state.drain) return null

  const left = Math.max(0, state.drain.seconds - (t - state.at))
  return (
    <div style={{ marginTop: 40, fontSize: 32, fontWeight: 400, color: '#c9c9d0' }}>
      {state.drain.label} · {left.toFixed(1)} s
      <div style={{ marginTop: 12, height: 16, borderRadius: 8, backgroundColor: '#3a3a42' }}>
        <div
          style={{
            width: `${(left / state.drain.seconds) * 100}%`,
            height: '100%',
            borderRadius: 8,
            backgroundColor: '#e8e8ee',
          }}
        />
      </div>
    </div>
  )
}

function Caption({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        right: 120,
        bottom: 72,
        fontSize: 48,
        lineHeight: 1.6,
        fontWeight: 600,
        textAlign: 'center',
        textWrap: 'balance',
      }}
    >
      {/* A wrapped caption's box would keep the full width, so each line draws its own background. */}
      <span
        style={{
          padding: '10px 30px',
          borderRadius: 999,
          backgroundColor: 'rgba(0, 0, 0, 0.72)',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {text}
      </span>
    </div>
  )
}

function EndCardView({ t }: { t: number }) {
  const name = interpolate(t, [0, 0.6], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const repo = interpolate(t, [0.5, 1.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 28 }}>
      <div
        style={{
          fontSize: 220,
          fontWeight: 700,
          letterSpacing: -6,
          opacity: name,
          transform: `translateY(${(1 - name) * 24}px)`,
        }}
      >
        {END_CARD.name}
      </div>
      <div style={{ fontSize: 44, color: '#a4a4ac', opacity: repo }}>{END_CARD.repo}</div>
    </AbsoluteFill>
  )
}
