import { useMemo } from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion'

import { END_CARD, FPS, HEIGHT, WIDTH } from './timeline'

export const OUTRO_VARIANTS = ['through', 'woven', 'braid'] as const
export type OutroVariant = (typeof OUTRO_VARIANTS)[number]
export const OUTRO_SECONDS = 6

const COLORS = ['#ff5a5f', '#ffb000', '#ffe14d', '#3ddc97', '#2ec4f1', '#7b61ff', '#ff4fd8']
const STREAMS = 14
const STRANDS = 3
const STEP = 10
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif'
const WORD_SIZE = 240

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

type Stream = { color: string; base: number; arc: number; span: number; start: number; f: number; phase: number }

/** Each stream's own wandering path: a wide arc plus a slower wave, different for every stream. */
function streams(): Stream[] {
  return Array.from({ length: STREAMS }, (_, i) => {
    const r = (n: number) => {
      const s = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453
      return s - Math.floor(s)
    }
    return {
      color: COLORS[i % COLORS.length]!,
      base: 160 + r(1) * (HEIGHT - 320),
      arc: (r(2) - 0.5) * 700,
      span: 900 + r(3) * 1100,
      start: -300 + r(4) * 500,
      f: 0.002 + r(5) * 0.004,
      phase: r(6) * Math.PI * 2,
    }
  })
}

type Layout = { braidY: number; wordY: number; repoY: number; edgeEnd: number }

const LAYOUTS: Record<OutroVariant, Layout> = {
  // Noise on the left becomes a braid on the right, through the word, which sits in front.
  through: { braidY: 520, wordY: 520, repoY: 760, edgeEnd: WIDTH / 2 },
  // The same flow, weaving in front of some letters and behind others.
  woven: { braidY: 520, wordY: 520, repoY: 760, edgeEnd: WIDTH / 2 - 380 },
  // Every stream ends in one braid that underlines the word.
  braid: { braidY: 680, wordY: 470, repoY: 820, edgeEnd: -400 },
}

type Segment = { x1: number; y1: number; x2: number; y2: number; color: string; depth: number }

function segments(t: number, layout: Layout, all: Stream[]): Segment[] {
  const head = interpolate(t, [0, 1.6], [-200, WIDTH + 200], { ...clamp, easing: Easing.out(Easing.cubic) })
  // Where the noise turns into braid: off the right edge at first, then sweeping left.
  const edge = interpolate(t, [1, 3.6], [WIDTH + 600, layout.edgeEnd], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  const out: Segment[] = []
  all.forEach((s, i) => {
    const strand = i % STRANDS
    const offset = (Math.floor(i / STRANDS) - (STREAMS / STRANDS - 1) / 2) * 4
    let prev: { x: number; y: number } | null = null
    for (let x = -200; x <= Math.min(head, WIDTH + 200); x += STEP) {
      const along = (x - s.start) / s.span
      const noise =
        s.base + s.arc * Math.sin(Math.PI * smoothstep(0, 1, along)) + 90 * Math.sin(x * s.f + s.phase + t * 1.6)
      const angle = x * 0.011 - t * 3.2 + (strand * 2 * Math.PI) / STRANDS
      const braid = layout.braidY + 30 * Math.sin(angle) + offset
      const k = smoothstep(edge - 350, edge + 350, x)
      const y = noise + (braid - noise) * k
      const depth = (i / STREAMS - 0.5) * (1 - k) + Math.cos(angle) * k
      if (prev) out.push({ x1: prev.x, y1: prev.y, x2: x, y2: y, color: s.color, depth })
      prev = { x, y }
    }
  })
  return out.sort((a, b) => a.depth - b.depth)
}

function Lines({ segs, width, opacity }: { segs: Segment[]; width: number; opacity: number }) {
  return (
    <g opacity={opacity} strokeLinecap="round">
      {segs.map((s, n) => (
        <line key={n} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={width} />
      ))}
    </g>
  )
}

/** Each letter's left edge and width, measured with the font the word draws in. */
function letterBoxes(word: string): { x: number; w: number }[] {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `700 ${WORD_SIZE}px ${FONT}`
  const total = ctx.measureText(word).width
  let x = WIDTH / 2 - total / 2
  return [...word].map(ch => {
    const w = ctx.measureText(ch).width
    const box = { x, w }
    x += w
    return box
  })
}

export function Outro({ variant }: { variant: OutroVariant }) {
  const t = useCurrentFrame() / FPS
  const layout = LAYOUTS[variant]
  const all = useMemo(streams, [])
  const boxes = useMemo(() => letterBoxes(END_CARD.name), [])
  const segs = segments(t, layout, all)
  const word = interpolate(t, [0.6, 1.3], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const repo = interpolate(t, [3.8, 4.4], [0, 1], clamp)
  const text = (
    <text
      x={WIDTH / 2}
      y={layout.wordY}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={FONT}
      fontWeight={700}
      fontSize={WORD_SIZE}
      fill="white"
      opacity={word}
    >
      {END_CARD.name}
    </text>
  )
  // In the woven variant, the streams pass in front of every other letter.
  const front = boxes.filter((_, n) => n % 2 === 1)
  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0c0e' }}>
      <svg width={WIDTH} height={HEIGHT}>
        <defs>
          <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="#0c0c0e" floodOpacity="0.9" />
          </filter>
          <clipPath id="front">
            {front.map((b, n) => (
              <rect key={n} x={b.x} y={0} width={b.w} height={HEIGHT} />
            ))}
          </clipPath>
        </defs>
        <g filter="url(#glow)">
          <Lines segs={segs} width={12} opacity={0.55} />
        </g>
        <Lines segs={segs} width={5} opacity={1} />
        <g filter="url(#shadow)">{text}</g>
        {variant === 'woven' && (
          <g clipPath="url(#front)">
            <Lines segs={segs} width={5} opacity={word} />
          </g>
        )}
        <text
          x={WIDTH / 2}
          y={layout.repoY}
          textAnchor="middle"
          fontFamily={FONT}
          fontSize={44}
          fill="#c4c4cc"
          opacity={repo}
        >
          {END_CARD.repo}
        </text>
      </svg>
    </AbsoluteFill>
  )
}
