import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The plugin's data folder. Hooks get it as PLUGIN_DATA. MCP server
 * processes get no PLUGIN_DATA, so they take the folder Codex gives
 * hooks for the installed copy they run from: the cache path
 * `<codex home>/plugins/cache/<market>/<plugin>/<version>` maps to
 * `<codex home>/plugins/data/<plugin>-<market>`.
 */
export function dataDir(env: NodeJS.ProcessEnv, pluginRoot: string): string {
  const fromEnv = env.INBOX_DATA || env.PLUGIN_DATA
  if (fromEnv) return fromEnv
  const m = pluginRoot.match(/^(.*)\/plugins\/cache\/([^/]+)\/([^/]+)\/[^/]+$/)
  if (m) return `${m[1]}/plugins/data/${m[3]}-${m[2]}`

  return join(homedir(), '.codex', 'inbox-dev')
}

/**
 * What `npm --prefix codex run dev` builds, from the dev.json it writes into the data folder while it runs: the tab's
 * page and the server's handler. Null when no dev build runs, including once the process that wrote the file is
 * gone, as one killed before it could delete it.
 */
export async function devBuild(dir: string): Promise<{ tab: string; server?: string } | null> {
  try {
    const d = JSON.parse(await readFile(join(dir, 'dev.json'), 'utf8')) as {
      tab: string
      server?: string
      pid?: number
    }
    if (typeof d.pid !== 'number') return null
    // Signal 0 checks that the process exists and sends nothing.
    process.kill(d.pid, 0)
    return d
  } catch {
    return null
  }
}
