// The MCP server's request handler, bundled as dist/server-handler.mjs. The loader in server-main.ts imports it,
// and imports it again when its file changes, so everything here takes effect without restarting Codex.

import { readFile, stat } from 'node:fs/promises'

import { makeServer } from './server'
import { devBuild } from './state'
import TAB_HTML from './tab.html'
import { run } from './run'

/** The desktop app's codex binary: from CODEX_CLI_PATH, which .mcp.json passes on, else the binary that started this server. */
async function appCli(): Promise<string> {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH
  const r = await run(['ps', '-o', 'comm=', '-p', String(process.ppid)], { cwd: '/', timeoutMs: 5000 })
  const path = r.stdout.trim()

  return r.code === 0 && /(^|\/)codex$/.test(path) ? path : 'codex'
}

/** Reads the page that `npm --prefix codex run dev` keeps built, while it runs. The page is read again only when its file changes. */
function devPageIn(dir: string): () => Promise<string | null> {
  let cached: { path: string; mtimeMs: number; html: string } | null = null
  return async () => {
    try {
      const dev = await devBuild(dir)
      if (!dev) return null
      const { tab } = dev
      const { mtimeMs } = await stat(tab)
      if (cached?.path !== tab || cached.mtimeMs !== mtimeMs)
        cached = { path: tab, mtimeMs, html: await readFile(tab, 'utf8') }
      return cached.html
    } catch {
      return null
    }
  }
}

/**
 * The handler for one JSON-RPC message, for the plugin's data folder `dir`. `loadError` says why the loader could not
 * load a newer build of this module, while this one keeps running. A loader that is already running calls this
 * signature, so a change to it needs Codex restarted.
 */
export function createHandler(dir: string, loadError: () => string | null = () => null): ReturnType<typeof makeServer> {
  return makeServer({
    dir,
    now: Date.now,
    exec: run,
    tabHtml: TAB_HTML,
    fallbackCli: appCli,
    devPage: devPageIn(dir),
    build: SERVER_BUILD,
    loadError,
  })
}
