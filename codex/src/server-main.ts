// The MCP server's entry point, bundled as dist/server.mjs. One JSON-RPC message per line on stdin and stdout.
//
// Codex starts this process once per app launch and keeps it. So it only reads lines and passes each to the
// handler module, which it imports again whenever that module's file changes: a reinstalled plugin, or the build
// `npm --prefix codex run dev` keeps while it runs. A change to this file itself still needs Codex restarted.

import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { createHandler } from './server-handler'
import { dataDir, devBuild } from './state'

type Handler = ReturnType<typeof createHandler>

const here = dirname(fileURLToPath(import.meta.url))
const dir = dataDir(process.env, dirname(here))

/** The handler module to run: the dev build's while one runs, else the installed one. */
async function handlerPath(): Promise<string> {
  const server = (await devBuild(dir))?.server
  const isBuilt = server
    ? await stat(server).then(
        () => true,
        () => false,
      )
    : false

  return server && isBuilt ? server : join(here, 'server-handler.mjs')
}

let current: { key: string; handle: Promise<Handler> } | null = null
let lastLoaded: Handler | null = null
// Why the newest handler file did not import, while an older handler keeps answering. Each view carries it.
let loadError: string | null = null

/** Imports a handler file, and records why it failed, if it did. */
function load(url: string, path: string): Promise<Handler> {
  const handle = import(url).then((m: { createHandler: typeof createHandler }) => m.createHandler(dir, () => loadError))
  handle.then(
    h => {
      lastLoaded = h
      loadError = null
    },
    err => {
      loadError = `${path}: ${err instanceof Error ? err.message : String(err)}`
      process.stderr.write(`inbox: could not load ${loadError}\n`)
    },
  )

  return handle
}

/**
 * The handler for the module's current file. A file that changed is imported again under a new URL, since Node
 * keeps a module by its URL. Each import stays in memory until the process ends, which a reload per save allows.
 * A file that fails to import, as one caught mid-write, leaves the last handler in place. Node keeps the failure
 * under its URL too, so the import is tried again only once the file changes.
 */
async function currentHandler(): Promise<Handler> {
  const path = await handlerPath()
  const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: -1 }))
  const key = `${pathToFileURL(path).href}?v=${mtimeMs}`
  if (current?.key !== key) current = { key, handle: load(key, path) }
  const { handle } = current
  try {
    return await handle
  } catch (err) {
    if (lastLoaded) return lastLoaded
    throw err
  }
}

const reply = (r: unknown) => process.stdout.write(`${JSON.stringify(r)}\n`)
// Each message waits for the handler of the one before it, so handlers start in arrival order. Their replies still finish in any order.
let ready: Promise<unknown> = Promise.resolve()

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  let message: { id?: unknown }
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  const handler = ready.then(currentHandler)
  ready = handler.catch(() => undefined)
  void handler.then(
    handle =>
      handle(message as Parameters<Handler>[0]).then(r => {
        if (r) reply(r)
      }),
    // With no handler loaded at all, a request gets an error instead of no answer.
    err => {
      if (message.id === undefined) return
      const why = err instanceof Error ? err.message : String(err)
      reply({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: `The inbox server could not load: ${why}` },
      })
    },
  )
})
