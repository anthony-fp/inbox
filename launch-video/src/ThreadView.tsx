import { Easing, interpolate } from 'remotion'

import { floodRange, LINE_IN, promptText, threadLines } from './thread'
import type { Mark, ThreadStarts, TimedLine } from './thread'

const MONO = '"SF Mono", Menlo, monospace'
const FONT = 24
const LINE = 34
const WINDOW = { x: 100, y: 36, w: 1720, h: 860 }
const TITLE = 48
const PAD = 32
const VIEW_W = WINDOW.w - 2 * PAD

const MARKS: Record<Mark, { fill: string; bar: string; label: string }> = {
  question: { fill: 'rgba(245, 180, 40, 0.26)', bar: '#f5b428', label: 'Question' },
  note: { fill: 'rgba(170, 130, 255, 0.28)', bar: '#aa82ff', label: 'Side note' },
  unsaid: { fill: 'rgba(255, 255, 255, 0.09)', bar: '#a0a0a8', label: 'Noticed, never said' },
}

const ease = (p: number) => Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, p)))

/** A camera on the thread: the content's y at the viewport's top, and how many content pixels fill its height. */
type Camera = { top: number; height: number }
const blend = (a: Camera, b: Camera, p: number): Camera => ({
  top: a.top + (b.top - a.top) * ease(p),
  height: a.height + (b.height - a.height) * ease(p),
})

/** The drawn thread at second `t` of the video, for beats 1 to 6. */
export function ThreadView({ starts, t }: { starts: ThreadStarts; t: number }) {
  const lines = threadLines(starts)
  const shown = lines.reduce((sum, l) => sum + Math.min(1, Math.max(0, (t - l.appear) / LINE_IN)), 0)
  const prompt = promptText(starts, t)
  const promptRows = Math.max(1, prompt.split('\n').length)
  const promptHeight = promptRows * LINE + 40
  const viewHeight = WINDOW.h - TITLE - promptHeight - 16

  const follow: Camera = { top: Math.max(0, shown * LINE - viewHeight), height: viewHeight }
  const flood = floodRange()
  const whole: Camera = { top: -LINE, height: flood.to * LINE + 2 * LINE }
  const unsaid = lines.findIndex(l => l.mark === 'unsaid')
  const unsaidCenter = (unsaid + 1) * LINE
  const pushedIn: Camera = { top: unsaidCenter - viewHeight / 2.5, height: viewHeight / 1.25 }
  const followAtBuried: Camera = {
    top: Math.max(0, lines.filter(l => l.appear <= starts.buried).length * LINE - viewHeight),
    height: viewHeight,
  }
  const camera =
    t < starts.buried
      ? follow
      : t < starts['never-said']
        ? blend(followAtBuried, whole, (t - starts.buried) / 1.4)
        : t < starts['by-hand']
          ? blend(whole, pushedIn, (t - starts['never-said']) / 1.0)
          : blend(pushedIn, follow, (t - starts['by-hand']) / 0.8)
  const scale = viewHeight / camera.height
  const x = scale < 1 ? (VIEW_W - VIEW_W * scale) / 2 : 0

  const labelsIn = interpolate(t, [starts.buried + 1.2, starts.buried + 1.7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const labelsOut = interpolate(t, [starts['by-hand'], starts['by-hand'] + 0.3], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        position: 'absolute',
        left: WINDOW.x,
        top: WINDOW.y,
        width: WINDOW.w,
        height: WINDOW.h,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: '#1d1d1f',
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.55)',
        fontFamily: MONO,
        fontSize: FONT,
        color: '#e8e8ea',
      }}
    >
      <TitleBar />
      <div
        style={{
          position: 'absolute',
          left: PAD,
          top: TITLE + 8,
          width: VIEW_W,
          height: viewHeight,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: VIEW_W,
            transformOrigin: '0 0',
            transform: `translate(${x}px, ${-camera.top * scale}px) scale(${scale})`,
          }}
        >
          {lines.map((l, i) => (
            <LineView key={i} line={l} previous={lines[i - 1]} t={t} />
          ))}
        </div>
        <MarkLabels
          lines={lines}
          opacity={labelsIn * labelsOut}
          place={i => ({ x: x + VIEW_W * Math.min(scale, 1) + 16, y: (i * LINE - camera.top) * scale })}
          scale={scale}
          only={t >= starts['never-said'] ? 'unsaid' : undefined}
        />
      </div>
      <Prompt text={prompt} rows={promptRows} height={promptHeight} t={t} />
    </div>
  )
}

function TitleBar() {
  return (
    <div
      style={{
        height: TITLE,
        backgroundColor: '#2a2a2d',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 22,
        gap: 10,
        fontFamily: '-apple-system, "SF Pro Display", sans-serif',
        fontSize: 20,
        color: '#b9b9c0',
      }}
    >
      {['#ff5f57', '#febc2e', '#28c840'].map(color => (
        <div key={color} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color }} />
      ))}
      <div style={{ flex: 1, textAlign: 'center', marginRight: 90 }}>storefront — claude</div>
    </div>
  )
}

function LineView({ line, previous, t }: { line: TimedLine; previous: TimedLine | undefined; t: number }) {
  const opacity = Math.min(1, Math.max(0, (t - line.appear) / LINE_IN))
  const continues = previous?.kind === line.kind
  const base = {
    height: LINE,
    lineHeight: `${LINE}px`,
    whiteSpace: 'pre' as const,
    opacity,
    position: 'relative' as const,
  }
  const mark = line.mark ? MARKS[line.mark] : undefined
  const markStyle = mark ? { backgroundColor: mark.fill, boxShadow: `inset 6px 0 0 ${mark.bar}` } : {}
  switch (line.kind) {
    case 'blank':
      return <div style={base} />
    case 'user':
      return (
        <div style={{ ...base, backgroundColor: '#333336', color: '#f2f2f4' }}>
          <span style={{ color: '#9a9aa2' }}>{'❯ '}</span>
          {line.text}
        </div>
      )
    case 'say':
      return (
        <div style={{ ...base, ...markStyle }}>
          {continues ? '  ' : '● '}
          {line.text}
        </div>
      )
    case 'tool':
      return (
        <div style={base}>
          <span style={{ color: '#4ec27a' }}>{'● '}</span>
          <span style={{ fontWeight: 700 }}>{line.text}</span>
        </div>
      )
    case 'out':
      return (
        <div style={{ ...base, color: '#9a9aa2' }}>
          {continues ? '     ' : '  ⎿  '}
          {line.text}
        </div>
      )
    case 'add':
      return (
        <div style={{ ...base, color: '#d4f0da' }}>
          <span style={{ backgroundColor: 'rgba(46, 160, 67, 0.32)' }}>{`    ${line.text}`}</span>
        </div>
      )
    case 'del':
      return (
        <div style={{ ...base, color: '#f4d2d2' }}>
          <span style={{ backgroundColor: 'rgba(218, 54, 51, 0.32)' }}>{`    ${line.text}`}</span>
        </div>
      )
    case 'think':
      return <div style={{ ...base, ...markStyle, color: '#8d8d95', fontStyle: 'italic' }}>{`  ${line.text}`}</div>
  }
}

/** A label beside each run of marked lines, drawn at screen size while the camera is pulled back. */
function MarkLabels(props: {
  lines: TimedLine[]
  opacity: number
  place: (lineIndex: number) => { x: number; y: number }
  scale: number
  only: Mark | undefined
}) {
  const { lines, opacity, place, scale, only } = props
  if (opacity <= 0) return null

  const runs: { mark: Mark; from: number; to: number }[] = []
  lines.forEach((l, i) => {
    if (!l.mark) return
    const last = runs[runs.length - 1]
    if (last && last.mark === l.mark && last.to === i - 1) last.to = i
    else runs.push({ mark: l.mark, from: i, to: i })
  })
  return (
    <>
      {runs
        .filter(r => r.to < floodRange().to && (!only || r.mark === only))
        .map(r => {
          const top = place(r.from)
          const bottom = place(r.to + 1)
          const mark = MARKS[r.mark]
          const isBelow = only !== undefined
          return (
            <div
              key={r.from}
              style={{
                position: 'absolute',
                left: isBelow ? 0 : top.x,
                top: isBelow ? bottom.y + 4 : (top.y + bottom.y) / 2 - 20,
                opacity,
                padding: isBelow ? '1px 10px' : '4px 14px',
                borderRadius: 8,
                backgroundColor: mark.bar,
                color: '#111',
                fontFamily: '-apple-system, "SF Pro Display", sans-serif',
                fontSize: isBelow ? 22 : 26,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {mark.label}
            </div>
          )
        })}
    </>
  )
}

function Prompt({ text, rows, height, t }: { text: string; rows: number; height: number; t: number }) {
  const isBlinkOn = Math.floor(t * 2) % 2 === 0
  const lines = text.split('\n')
  return (
    <div
      style={{
        position: 'absolute',
        left: PAD,
        right: PAD,
        bottom: 0,
        height,
        borderTop: '2px solid #3a3a3e',
        paddingTop: 16,
        boxSizing: 'border-box',
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: LINE, lineHeight: `${LINE}px`, whiteSpace: 'pre' }}>
          <span style={{ color: '#9a9aa2' }}>{i === 0 ? '❯ ' : '  '}</span>
          {lines[i] ?? ''}
          {i === rows - 1 && (
            <span style={{ backgroundColor: isBlinkOn ? '#e8e8ea' : 'transparent', color: 'transparent' }}>_</span>
          )}
        </div>
      ))}
    </div>
  )
}
