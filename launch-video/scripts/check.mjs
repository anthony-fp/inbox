// Checks the animatic's timeline and, with --render, a rendered variant.
//
//   node scripts/check.mjs                      the caption report and the states each beat cuts off, every variant
//   node scripts/check.mjs --render <variant>   also renders the variant to out/<variant>.mp4, checks its size, rate
//                                               and frame count with ffprobe, and writes stills at every state change
//                                               and caption edge, and a contact sheet, to out/<variant>/
//
// Exits 1 when a caption breaks a rule or a render check fails.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'out')
/** Caption rules from docs/plans/launch-video.md: on screen at least 2 s, read at no more than 20 characters a second. */
const CAPTION_MIN_S = 2
const CAPTION_MAX_CPS = 20

let failed = false
const fail = message => {
  failed = true
  console.log(`  x ${message}`)
}

// The timeline imports the mod's TypeScript without file extensions, so Node can't load it directly.
mkdirSync(OUT, { recursive: true })
const bundled = join(OUT, 'timeline.mjs')
await build({
  entryPoints: [join(ROOT, 'src/timeline.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundled,
  logLevel: 'error',
})
const { FPS, HEIGHT, VARIANTS, WIDTH, timeline, totalFrames } = await import(pathToFileURL(bundled).href)

const args = process.argv.slice(2)
const renderIndex = args.indexOf('--render')
const toRender = renderIndex === -1 ? undefined : args[renderIndex + 1]
if (renderIndex !== -1 && !VARIANTS.includes(toRender)) {
  console.log(`--render takes one of: ${VARIANTS.join(', ')}`)
  process.exit(1)
}

for (const variant of VARIANTS) {
  const placed = timeline(variant)
  const end = placed.at(-1).start + placed.at(-1).length
  console.log(`\n${variant}: ${end.toFixed(2)} s, ${totalFrames(placed)} frames`)
  if (variant === 'captions-off') console.log('  - captions hidden')
  else checkCaptions(placed)
  reportCutOff(placed)
  reportMissingStills(placed)
}

if (toRender) checkRender(toRender, timeline(toRender))

process.exit(failed ? 1 : 0)

function captionsOf(placed) {
  return placed.flatMap(beat => {
    if (beat.kind === 'solo' || beat.kind === 'thread')
      return [{ beat, text: beat.caption, from: beat.start, to: beat.start + beat.length }]
    if (beat.kind === 'side-by-side')
      return [{ beat, text: beat.caption, from: beat.start + beat.captionFrom, to: beat.start + beat.length }]
    return []
  })
}

function checkCaptions(placed) {
  let previousEnd = 0
  for (const c of captionsOf(placed)) {
    const seconds = c.to - c.from
    const cps = c.text.length / seconds
    const line = `beat ${c.beat.number}: ${seconds.toFixed(2)} s, ${cps.toFixed(1)} chars/s, "${c.text}"`
    if (seconds < CAPTION_MIN_S) fail(`${line}: shorter than ${CAPTION_MIN_S} s`)
    else if (cps > CAPTION_MAX_CPS) fail(`${line}: faster than ${CAPTION_MAX_CPS} chars/s`)
    else if (c.from < previousEnd) fail(`${line}: overlaps the caption before it`)
    else console.log(`  ok ${line}`)
    previousEnd = c.to
  }
}

/** States that start after their beat ends never reach the screen, such as a settle running past the side-by-side beat. */
function reportCutOff(placed) {
  for (const beat of placed) {
    const lists =
      beat.kind === 'solo'
        ? [['', beat.states]]
        : beat.kind === 'side-by-side'
          ? Object.entries(beat.states).map(([look, states]) => [`${look}: `, states])
          : []
    for (const [prefix, states] of lists)
      for (const s of states.filter(s => s.at >= beat.length))
        console.log(
          `  - beat ${beat.number}, ${prefix}"${s.label}" at ${s.at.toFixed(2)} s is cut off: the beat ends at ${beat.length} s`,
        )
  }
}

/** Stills are captured into public/stills/, which Git ignores. A state whose still is missing draws its placeholder. */
function reportMissingStills(placed) {
  const named = placed.flatMap(beat =>
    beat.kind === 'solo' ? beat.states : beat.kind === 'side-by-side' ? Object.values(beat.states).flat() : [],
  )
  const missing = [...new Set(named.flatMap(s => (s.still ? [s.still] : [])))].filter(
    still => !existsSync(join(ROOT, 'public', still)),
  )
  if (missing.length > 0)
    console.log(`  - ${missing.length} stills missing, drawn as placeholders: ${missing.join(', ')}`)
}

/** Runs a command with its output in a log file, and reports its own exit status. */
function run(command, commandArgs, log) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`)
  return result
}

function checkRender(variant, placed) {
  const video = join(OUT, `${variant}.mp4`)
  const dir = join(OUT, variant)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  console.log(`\nRendering ${variant}`)
  const render = run('npx', ['remotion', 'render', 'src/index.ts', variant, video], join(dir, 'render.log'))
  if (render.status !== 0) {
    fail(`remotion render exited ${render.status}. See ${join(dir, 'render.log')}`)
    return
  }

  const probe = run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=width,height,r_frame_rate,nb_read_frames',
      '-of',
      'json',
      video,
    ],
    join(dir, 'ffprobe.json'),
  )
  const stream = probe.status === 0 ? JSON.parse(probe.stdout).streams?.[0] : undefined
  const expected = {
    width: WIDTH,
    height: HEIGHT,
    r_frame_rate: `${FPS}/1`,
    nb_read_frames: String(totalFrames(placed)),
  }
  for (const [key, value] of Object.entries(expected))
    if (String(stream?.[key]) === String(value)) console.log(`  ok ${key} ${value}`)
    else fail(`${key} is ${stream?.[key]}, expected ${value}`)

  const marks = new Map()
  // Rounded up, so a still lands on or after the frame where its state starts.
  const mark = (seconds, name) => {
    const frame = Math.min(Math.ceil(seconds * FPS - 1e-6), totalFrames(placed) - 1)
    if (!marks.has(frame)) marks.set(frame, name)
  }
  for (const beat of placed) {
    const lists =
      beat.kind === 'solo' ? [beat.states] : beat.kind === 'side-by-side' ? [beat.states.terminal] : [[{ at: 0 }]]
    for (const states of lists)
      for (const s of states.filter(s => s.at < beat.length))
        mark(beat.start + s.at, `b${beat.number}-${s.click ? 'click' : 'state'}`)
  }
  for (const beat of placed.filter(b => b.kind === 'side-by-side')) {
    mark(beat.start + beat.pushInAt + beat.pushInLength / 2, `b${beat.number}-pushing-in`)
    mark(beat.start + beat.pushInAt + 2 * beat.stagger + beat.pushInLength, `b${beat.number}-pushed-in`)
  }
  for (const c of captionsOf(placed)) {
    mark(c.from, `b${c.beat.number}-caption-first`)
    mark(c.to - 1 / FPS, `b${c.beat.number}-caption-last`)
  }

  const ordered = [...marks.entries()].sort((a, b) => a[0] - b[0])
  const select = ordered.map(([frame]) => `eq(n\\,${frame})`).join('+')
  const stills = run(
    'ffmpeg',
    ['-v', 'error', '-i', video, '-vf', `select='${select}'`, '-fps_mode', 'passthrough', join(dir, 'still-%03d.png')],
    join(dir, 'stills.log'),
  )
  if (stills.status !== 0) fail(`ffmpeg stills exited ${stills.status}`)
  else {
    const written = readdirSync(dir)
      .filter(f => f.startsWith('still-'))
      .sort()
    written.forEach((file, i) => {
      const [frame, name] = ordered[i]
      renameSync(join(dir, file), join(dir, `${String(frame).padStart(5, '0')}-${name.replace(/[^\w-]/g, '_')}.png`))
    })
    if (written.length === ordered.length) console.log(`  ok ${written.length} stills`)
    else fail(`${written.length} stills written, expected ${ordered.length}`)
  }

  const sheet = run(
    'ffmpeg',
    ['-v', 'error', '-i', video, '-vf', 'fps=1,scale=192:-1,tile=10x8', '-frames:v', '1', join(dir, 'contact.png')],
    join(dir, 'contact.log'),
  )
  if (sheet.status === 0) console.log(`  ok contact sheet, one frame a second`)
  else fail(`ffmpeg contact sheet exited ${sheet.status}`)
}
