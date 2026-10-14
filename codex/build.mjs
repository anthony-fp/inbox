// Bundles the plugin's entry points, with the mod's shared modules, into
// plugin/dist. The bundles are committed, since a Git marketplace install
// copies the plugin folder and runs no build. The tab's script is bundled for
// the browser first and inlined into tab.html, which the server carries as text.
//
// Usage:
//   node build.mjs          writes plugin/dist
//   node build.mjs --check  exits 1 when plugin/dist differs from a fresh build
//   node build.mjs --tests  bundles tests/*.spec.ts into test-dist for `node --test`. They aren't
//                          *.test.ts, which `claude plugin test` would run as the mod's.
//   node build.mjs --dev    rebuilds the tab's page and the server's handler into .dev on each save, and points
//                          the installed plugin's server at them, so an open Inbox tab swaps to the page and the
//                          server runs the handler, with no restart.
//
// The tab shows its Show demo button only in --dev builds, or when INBOX_DEMO_BUTTON=1 is set for a build to try in
// another install. INBOX_DEMO_RECORDING=1 shows the button too, and the demo then leaves out the notices that mark its
// entries as samples, for recording a video, as `/inbox demo recording` does in Claude Code. Don't commit plugin/dist
// from either build: --check would fail it.

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2] ?? ''

/**
 * A fingerprint of the sources the server's handler is built from, leaving out the tab page it carries. The server
 * sends it with each view and the tab page holds its own, so a page built from newer server sources than the
 * handler running can say so.
 */
async function serverBuild() {
  const result = await esbuild.build({
    absWorkingDir: here,
    entryPoints: ['src/server-handler.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    loader: { '.html': 'text' },
    metafile: true,
    write: false,
    logLevel: 'silent',
  })
  const hash = createHash('sha256')
  for (const path of Object.keys(result.metafile.inputs)
    .filter(p => !p.endsWith('tab.html'))
    .sort())
    hash.update(path).update(readFileSync(join(here, path)))

  return hash.digest('hex').slice(0, 12)
}

const isDemoRecording = process.env.INBOX_DEMO_RECORDING === '1'
const isDemoButton = mode === '--dev' || process.env.INBOX_DEMO_BUTTON === '1' || isDemoRecording

/** The tab's script, bundled for the browser, holding the fingerprint of the server sources it was built with. */
async function buildTabScript(build) {
  const tab = await esbuild.build({
    absWorkingDir: here,
    define: {
      SERVER_BUILD: JSON.stringify(build),
      DEMO_BUTTON: JSON.stringify(isDemoButton),
      DEMO_RECORDING: JSON.stringify(isDemoRecording),
    },
    entryPoints: ['src/tab.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    write: false,
  })
  const script = tab.outputFiles[0].text
  // The script sits inside a <script> element, which the first "</script" in it would end.
  if (/<\/script/i.test(script))
    throw new Error('The tab script contains "</script", which would end its element early.')

  return script
}

/** The CSS variables for each appearance's status colors, read from the mod's hooks/tones.ts. */
async function toneVars() {
  const out = await esbuild.build({
    absWorkingDir: here,
    entryPoints: ['../hooks/tones.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'warning',
  })
  const tones = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  const vars = t =>
    [
      `--key: ${t.key};`,
      `--amber: ${t.needsYou};`,
      `--findings: ${t.findings};`,
      `--prs: ${t.prs};`,
      `--done: ${t.done};`,
      `--error: ${t.error};`,
      `--error-mark: ${t.errorMark};`,
    ].join(' ')

  return { light: vars(tones.LIGHT_TONES), dark: vars(tones.DARK_TONES) }
}

/** tab.html with its status colors and its script inlined. */
const tabPage = (html, script, tones) =>
  html
    .replaceAll('/*TONES:light*/', () => tones.light)
    .replaceAll('/*TONES:dark*/', () => tones.dark)
    .replace('/*TAB_SCRIPT*/', () => script)

const build = await serverBuild()
const tones = await toneVars()
const tabScript = mode === '--dev' ? '' : await buildTabScript(build)

/** Loads tab.html with `script` inlined. */
const inlineTab = (script, pageTones = tones) => ({
  name: 'inline-tab',
  setup(build) {
    build.onLoad({ filter: /[/\\]tab\.html$/ }, args => ({
      contents: tabPage(readFileSync(args.path, 'utf8'), script, pageTones),
      loader: 'text',
    }))
  },
})

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  loader: { '.html': 'text' },
  define: { SERVER_BUILD: JSON.stringify(build) },
  plugins: [inlineTab(tabScript)],
  legalComments: 'none',
  logLevel: 'warning',
}

const entries = {
  hook: 'src/hook-main.ts',
  server: 'src/server-main.ts',
  'server-handler': 'src/server-handler.ts',
  update: 'src/update-main.ts',
}

if (mode === '--dev') {
  const page = join(here, '.dev', 'tab.html')
  const handler = join(here, '.dev', 'server-handler.mjs')
  // The data folder Codex gives the installed plugin, as dataDir in src/state.ts maps it.
  const pointer = join(
    process.env.CODEX_HOME || join(homedir(), '.codex'),
    'plugins',
    'data',
    'inbox-inbox',
    'dev.json',
  )
  const write = async () => {
    try {
      const build = await serverBuild()
      const script = await buildTabScript(build)
      // The server reads the page when its time changes and keeps it, so it must never see it half written either.
      const pageTones = await toneVars()
      writeFileSync(`${page}.tmp`, tabPage(readFileSync(join(here, 'src', 'tab.html'), 'utf8'), script, pageTones))
      renameSync(`${page}.tmp`, page)
      // A tab opened while this runs starts from the handler's own page, so that page carries the script too.
      const server = await esbuild.build({
        ...common,
        absWorkingDir: here,
        entryPoints: ['src/server-handler.ts'],
        define: { SERVER_BUILD: JSON.stringify(build) },
        plugins: [inlineTab(script, pageTones)],
        write: false,
      })
      // The server imports the file once its time changes, so it must never see it half written.
      writeFileSync(`${handler}.tmp`, server.outputFiles[0].text)
      renameSync(`${handler}.tmp`, handler)
      console.log(`${new Date().toLocaleTimeString()} Built the tab page and the server's handler`)
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
    }
  }
  mkdirSync(dirname(page), { recursive: true })
  mkdirSync(dirname(pointer), { recursive: true })
  await write()
  // The server ignores the file once this process is gone, as when it was killed before it could delete it.
  writeFileSync(pointer, JSON.stringify({ tab: page, server: handler, pid: process.pid }))
  const stop = () => {
    rmSync(pointer, { force: true })
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let timer
  for (const dir of [join(here, 'src'), join(here, '..', 'hooks')])
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(write, 100)
    })
  console.log('Watching codex/src and hooks. Open Inbox tabs and the server update after each save. Ctrl-C stops.')
} else if (mode === '--tests') {
  const tests = readdirSync(join(here, 'tests')).filter(f => f.endsWith('.spec.ts'))
  await esbuild.build({
    ...common,
    absWorkingDir: here,
    entryPoints: tests.map(f => `tests/${f}`),
    outdir: 'test-dist',
    outExtension: { '.js': '.mjs' },
  })
} else {
  const result = await esbuild.build({
    ...common,
    absWorkingDir: here,
    entryPoints: entries,
    outdir: 'plugin/dist',
    outExtension: { '.js': '.mjs' },
    banner: { js: '// Built by codex/build.mjs from codex/src and hooks/. Do not edit.' },
    write: mode !== '--check',
  })
  if (mode === '--check') {
    const stale = result.outputFiles.filter(f => {
      try {
        return readFileSync(f.path, 'utf8') !== f.text
      } catch {
        return true
      }
    })
    if (stale.length > 0) {
      console.error(
        `Out of date: ${stale.map(f => f.path.slice(here.length + 1)).join(', ')}. Run: npm --prefix codex run build`,
      )
      process.exit(1)
    }
  }
}
