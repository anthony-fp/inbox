// The MCP server's entry point, bundled as dist/server.mjs. One JSON-RPC
// message per line on stdin and stdout.

import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { makeServer } from './server'
import { dataDir } from './state'
import TAB_HTML from './tab.html'
import { run } from './run'

/** The desktop app's codex binary: from CODEX_CLI_PATH, which .mcp.json passes on, else the binary that started this server. */
async function appCli(): Promise<string> {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH
  const r = await run(['ps', '-o', 'comm=', '-p', String(process.ppid)], { cwd: '/', timeoutMs: 5000 })
  const path = r.stdout.trim()

  return r.code === 0 && /(^|\/)codex$/.test(path) ? path : 'codex'
}

/**
 * Reads the page that `npm --prefix codex run dev` keeps built. It writes dev.json, naming the page, into
 * this data folder while it runs. The page is read again only when its file changes.
 */
function devPageIn(dir: string): () => Promise<string | null> {
  let cached: { path: string; mtimeMs: number; html: string } | null = null
  return async () => {
    try {
      const { tab } = JSON.parse(await readFile(join(dir, 'dev.json'), 'utf8')) as { tab: string }
      const { mtimeMs } = await stat(tab)
      if (cached?.path !== tab || cached.mtimeMs !== mtimeMs)
        cached = { path: tab, mtimeMs, html: await readFile(tab, 'utf8') }
      return cached.html
    } catch {
      return null
    }
  }
}

const dir = dataDir(process.env, dirname(dirname(fileURLToPath(import.meta.url))))
const handle = makeServer({
  dir,
  now: Date.now,
  exec: run,
  tabHtml: TAB_HTML,
  fallbackCli: appCli,
  devPage: devPageIn(dir),
})

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  void handle(message).then(reply => {
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
  })
})
