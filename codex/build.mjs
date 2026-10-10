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
//   node build.mjs --dev    rebuilds the tab's page into .dev/tab.html on each save, and points the
//                          installed plugin's server at it, so an open Inbox tab swaps to it.

import { mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const mode = process.argv[2] ?? ''

/** The tab's script, bundled for the browser. */
async function buildTabScript() {
  const tab = await esbuild.build({
    absWorkingDir: here,
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

/** tab.html with its script inlined. */
const tabPage = (html, script) => html.replace('/*TAB_SCRIPT*/', () => script)

const tabScript = mode === '--dev' ? '' : await buildTabScript()

/** Loads tab.html with the tab's script inlined. */
const inlineTab = {
  name: 'inline-tab',
  setup(build) {
    build.onLoad({ filter: /[/\\]tab\.html$/ }, args => ({
      contents: tabPage(readFileSync(args.path, 'utf8'), tabScript),
      loader: 'text',
    }))
  },
}

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  loader: { '.html': 'text' },
  plugins: [inlineTab],
  legalComments: 'none',
  logLevel: 'warning',
}

const entries = {
  hook: 'src/hook-main.ts',
  server: 'src/server-main.ts',
  update: 'src/update-main.ts',
}

if (mode === '--dev') {
  const page = join(here, '.dev', 'tab.html')
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
      writeFileSync(page, tabPage(readFileSync(join(here, 'src', 'tab.html'), 'utf8'), await buildTabScript()))
      console.log(`${new Date().toLocaleTimeString()} Built the tab page`)
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
    }
  }
  mkdirSync(dirname(page), { recursive: true })
  mkdirSync(dirname(pointer), { recursive: true })
  await write()
  writeFileSync(pointer, JSON.stringify({ tab: page }))
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
  console.log('Watching codex/src and hooks. Open Inbox tabs update after each save. Ctrl-C stops.')
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
