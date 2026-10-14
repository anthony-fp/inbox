// The launch video's beats, from the shot list in docs/plans/launch-video.md: each beat's length, its caption,
// and what the screen shows from which second.

import { EXIT_MS } from '../../codex/src/rows'
import { SETTLED_MS } from '../../hooks/view'

export const FPS = 60
export const WIDTH = 1920
export const HEIGHT = 1080

/** How long a closed row stays in place, and Undo drains, in all three apps, in seconds. */
const SETTLE = SETTLED_MS / 1000
/** How long a settled row then takes to leave in Codex, in seconds. */
const CODEX_EXIT = EXIT_MS / 1000

/** `captions-off` is `draft` with no captions, to check that the pictures carry the story. */
export const VARIANTS = ['draft', 'captions-off'] as const
export type Variant = (typeof VARIANTS)[number]

export type Look = 'terminal' | 'desktop' | 'codex'
export const LOOKS: Look[] = ['terminal', 'desktop', 'codex']
export const LOOK_NAMES: Record<Look, string> = {
  terminal: 'Claude Code in Terminal',
  desktop: 'Claude app',
  codex: 'Codex in the ChatGPT app',
}

export type Rect = { x: number; y: number; w: number; h: number }

/** A point on the VM's screen, in points from its top left. */
export type Point = [number, number]

/**
 * Each app's window still, in pixels, and where its inbox sits in it. Beat 11 pushes in from the whole window to
 * the inbox. The sizes are those of the stills in public/stills/, measured from their pixels.
 */
export const WINDOWS: Record<Look, { width: number; height: number; inbox: Rect }> = {
  terminal: { width: 2620, height: 1740, inbox: { x: 1440, y: 62, w: 1180, h: 1510 } },
  desktop: { width: 2620, height: 1760, inbox: { x: 1747, y: 21, w: 853, h: 1718 } },
  codex: { width: 2620, height: 1754, inbox: { x: 1688, y: 0, w: 932, h: 1754 } },
}

/** A still captured from the app's demo, in public/. */
const still = (look: Look, state: string) => `stills/${look}/${state}.png`

/** What the screen shows from `at` seconds into its beat until the next state. */
export type State = {
  at: number
  /** What the screen shows, which a placeholder draws as its label. */
  label: string
  /** What the inbox docked beside the conversation shows. A placeholder then draws `label` as the conversation. */
  pane?: string
  /** Where the pointer clicks, in VM screen points. */
  click?: Point
  /**
   * Seconds from the click until its result shows, measured from takes. The click happens this much before `at`,
   * so its result shows at `at`.
   */
  lead?: number
  /** A captured still in public/, which replaces the placeholder. */
  still?: string
  /** A row that stays in place while this bar drains, such as Undo's. A placeholder draws the bar. */
  drain?: { label: string; seconds: number }
}

/** When a state's click happens, in seconds into its beat. */
export const clickAt = (s: State) => s.at - (s.lead ?? 0)

/** From `at` seconds into its beat, the beat plays take `take` from `from` seconds into it. */
export type Segment = { at: number; take: string; from: number }

/** A recorded take's clip in public/, which cut.py writes. */
export const takeClip = (take: string) => `takes/${take}.mp4`

/** Beats 1 to 6: the drawn thread, which src/thread.ts holds. */
export type ThreadBeat = { kind: 'thread'; id: ThreadBeatId; number: number; length: number; caption: string }
export type ThreadBeatId = 'starts-simple' | 'replies-pile-up' | 'buried' | 'never-said' | 'by-hand' | 'again'

/** A beat that shows one app across the whole frame. */
export type SoloBeat = {
  kind: 'solo'
  id: string
  number: number
  look: Look
  length: number
  caption: string
  states: State[]
  /** Recorded footage, which replaces the states' placeholders. The states then name the clicks. */
  footage?: Segment[]
  /** Where the pointer rests before its first click, in VM screen points. */
  pointerFrom: Point
}

/** Beat 11: the three apps side by side, each click on the same frame in all three. */
export type SideBySideBeat = {
  kind: 'side-by-side'
  id: string
  number: number
  length: number
  caption: string
  /** When the caption appears: the hold on the three settled lists. */
  captionFrom: number
  /** When the first column starts to push in from its whole window to its inbox. */
  pushInAt: number
  pushInLength: number
  /** How far apart, left to right, the columns start to push in. */
  stagger: number
  states: Record<Look, State[]>
  /** Each app's recorded take of this beat, which replaces its stills. drive.py records it on these states' times. */
  takes?: Record<Look, string>
  /** Where each app's pointer rests before its first click, in VM screen points. */
  pointerFrom: Record<Look, Point>
}

export type EndCard = { kind: 'end'; id: string; number: number; length: number }

export type Beat = ThreadBeat | SoloBeat | SideBySideBeat | EndCard

/** A beat and where it starts in the video, in seconds. */
export type Placed = Beat & { start: number }

export const END_CARD = { name: 'Inbox', repo: 'github.com/petekp/inbox' }

/**
 * The music, made in Suno, about 123 BPM. Started `trimBefore` seconds into the track, its full groove comes in at
 * 31 s, as the inbox first appears, and comes back from its breakdown at 62.2 s, as beat 11 pushes in. It fades out
 * over the video's last `fadeOut` seconds.
 */
export const MUSIC = { src: 'music/focus-flow.mp3', trimBefore: 0.4, fadeOut: 4 }

export const frames = (seconds: number) => Math.round(seconds * FPS)

/** The beats of one variant, each placed after the one before. */
export function timeline(_variant: Variant): Placed[] {
  let start = 0
  return beats().map(beat => {
    const placed = { ...beat, start }
    start += beat.length
    return placed
  })
}

export function totalFrames(placed: Placed[]): number {
  const last = placed[placed.length - 1]
  return last ? frames(last.start + last.length) : 0
}

/** The state shown `t` seconds into a beat: the last one that has started. */
export function stateAt(states: State[], t: number): State | undefined {
  return states.filter(s => s.at <= t).pop()
}

const thread = (number: number, id: ThreadBeatId, length: number, caption: string): ThreadBeat => ({
  kind: 'thread',
  id,
  number,
  length,
  caption,
})

/**
 * Beats 7 to 10 come from one take of a real Claude Code session in a sample checkout project. Each click's time and
 * point are the ones act.py logged as it clicked in the take. The recording leaves out the VM's pointer, so the video
 * draws one.
 */
function beats(): Beat[] {
  const session = (at: number, from: number): Segment => ({ at, take: 'session', from })
  const asked = 'Keep the chargeCard alias for one release?'
  const receipt = 'Should the receipt email show the tax line on its own?'
  const conversation: Point = [400, 420]
  return [
    thread(1, 'starts-simple', 4, 'A chat session starts simple enough.'),
    thread(2, 'replies-pile-up', 7, 'Then things begin to pile up.'),
    thread(3, 'buried', 5, 'Questions and ideas get buried.'),
    thread(4, 'never-said', 4, "Some aren't even surfaced."),
    thread(5, 'by-hand', 6, 'You diligently respond, point by point.'),
    thread(6, 'again', 5, 'Then again, and again...'),
    {
      kind: 'solo',
      id: 'question-arrives',
      number: 7,
      look: 'terminal',
      length: 5.5,
      caption: 'Inbox gives the agent one place to ask you.',
      footage: [session(0, 22.1)],
      pointerFrom: conversation,
      states: [
        { at: 0, label: `The reply ends by asking "${asked}"`, pane: `Needs you: "${receipt}"` },
        { at: 3, label: 'The line above the prompt reads "Needs you 2"', pane: `A new row arrives: "${asked}"` },
      ],
    },
    {
      kind: 'solo',
      id: 'one-click',
      number: 8,
      look: 'terminal',
      length: 8,
      caption: 'The agent anticipates your answers, as it should.',
      footage: [session(0, 148.51), session(4, 246.3)],
      pointerFrom: conversation,
      states: [
        { at: 0, label: 'Needs you, with two questions' },
        { at: 2.9, click: [777, 183], label: `"${asked}" opens with its answers` },
        {
          at: 4.3,
          click: [712, 251],
          label: 'The row reads ✓ Keep alias, the receipt question opens, and Claude replies to the answer',
        },
      ],
    },
    {
      kind: 'solo',
      id: 'findings',
      number: 9,
      look: 'terminal',
      length: 9,
      caption: 'Your agent has somewhere it can surface issues and opportunities, with next steps.',
      footage: [session(0, 341.61), session(3, 432.83), session(6.7, 516.06)],
      pointerFrom: [712, 251],
      states: [
        { at: 0, label: 'Needs you, after the answer' },
        {
          at: 0.8,
          click: [764, 97],
          label:
            'Findings: the issue "Order totals are float sums with no rounding to cents" is open, with an opportunity below it',
        },
        {
          at: 4,
          click: [680, 471],
          label:
            'Fix hands the issue to Claude, and the opportunity "Subtotal is recomputed inline instead of using cart.js subtotalOf" opens',
        },
        { at: 7.7, click: [640, 97], label: `Back on Needs you, with "${receipt}" open` },
      ],
    },
    {
      kind: 'solo',
      id: 'answer-in-chat',
      number: 10,
      look: 'terminal',
      length: 6,
      caption: "Your agent keeps track of what's been completed so it doesn't hang around.",
      footage: [session(0, 598.38)],
      pointerFrom: [640, 97],
      states: [
        { at: 0, label: 'The prompt', pane: `"${receipt}" open` },
        { at: 0.6, click: [154, 659], label: 'A click in the prompt' },
        { at: 1.53, label: 'You type your answer at the prompt instead' },
        { at: 1.55, label: 'Your answer is sent' },
        { at: 4.1, label: 'Claude closes the row with your answer', pane: '✓ and your answer' },
      ],
    },
    sideBySide(),
    { kind: 'end', id: 'end-card', number: 12, length: 6 },
  ]
}

/** Where each app's click lands in beat 11, in VM screen points, by the still the click leads to. */
const CLICKS: Record<Look, Record<string, Point>> = {
  terminal: { answered: [683, 250], findings: [764, 97], back: [640, 97], 'task-open': [789, 523], done: [851, 488] },
  desktop: { answered: [803, 226], findings: [842, 93], back: [751, 93], 'task-open': [800, 536], done: [749, 478] },
  codex: { answered: [786, 228], findings: [825, 97], back: [725, 97], 'task-open': [809, 500], done: [894, 472] },
}

/** Seconds from a click until each app shows its result in the VM, by the still it leads to, measured from takes. */
const LEADS: Record<Look, Record<string, number>> = {
  terminal: { answered: 0.24, findings: 0.21, back: 0.22, 'task-open': 0.24, done: 0.16 },
  desktop: { answered: 0.29, findings: 0.17, back: 0.19, 'task-open': 0.17, done: 0.3 },
  codex: { answered: 0.2, findings: 0.35, back: 0.2, 'task-open': 0.2, done: 0.2 },
}
const DEFAULT_LEAD = 0.1

/**
 * drive.py clicks each app at these times. Done comes a second after the task opens, because an open row ignores
 * presses for PRESS_GUARD_MS in hooks/view.ts.
 */
function sideBySide(): SideBySideBeat {
  const [answer, findings, back, task, done] = [4.5, 7.5, 9.2, 10, 11]
  const leave = done + SETTLE
  const holdFrom = 13
  const drawn: Record<Look, { answered: string; undo: string; leaving: State[] }> = {
    terminal: {
      answered: 'The row reads ✓ in monospace, and the next row opens',
      undo: 'Undo drains, in cells',
      leaving: [{ at: leave, label: 'The row leaves', still: still('terminal', 'gone') }],
    },
    desktop: {
      answered: 'The row reads ✓ beside native buttons, and the next row opens',
      undo: "Undo's fill drains",
      leaving: [{ at: leave, label: 'The row leaves', still: still('desktop', 'gone') }],
    },
    codex: {
      answered: 'The row animates closed to ✓, and the next row opens',
      undo: "Undo's fill drains",
      leaving: [
        { at: leave, label: 'The row fades and collapses', still: still('codex', 'done') },
        { at: leave + CODEX_EXIT, label: 'The row is gone', still: still('codex', 'gone') },
      ],
    },
  }
  const clicked = (look: Look, name: string, at: number) => ({
    at,
    click: CLICKS[look][name] as Point,
    lead: LEADS[look][name] ?? DEFAULT_LEAD,
    still: still(look, name),
  })
  const states = (look: Look): State[] => [
    {
      at: 0,
      label: 'Needs you, with "Show Apple Pay above the card form, or beside it?" open',
      still: still(look, 'question'),
    },
    { ...clicked(look, 'answered', answer), label: drawn[look].answered },
    { ...clicked(look, 'findings', findings), label: 'Findings, which opens "Orders to Canada are taxed at US rates"' },
    {
      ...clicked(look, 'back', back),
      label: 'Back on Needs you, where the question opened after the answer is open again',
    },
    { ...clicked(look, 'task-open', task), label: 'The task "Sign in to the Stripe CLI to forward webhooks" opens' },
    {
      ...clicked(look, 'done', done),
      label: `The task settles. ${drawn[look].undo}.`,
      drain: { label: 'Undo', seconds: SETTLE },
    },
    ...drawn[look].leaving,
  ]
  return {
    kind: 'side-by-side',
    id: 'side-by-side',
    number: 11,
    length: 16,
    caption: 'Same inbox. At home in each app.',
    captionFrom: holdFrom,
    pushInAt: 2,
    pushInLength: 1.4,
    stagger: 0.3,
    states: { terminal: states('terminal'), desktop: states('desktop'), codex: states('codex') },
    takes: { terminal: 'side-by-side-terminal', desktop: 'side-by-side-desktop', codex: 'side-by-side-codex' },
    pointerFrom: { terminal: [800, 620], desktop: [800, 640], codex: [850, 640] },
  }
}
