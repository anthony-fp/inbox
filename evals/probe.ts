import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

import { notShownText, SHOW, showTarget } from '../hooks/files'
import { EMPTY } from '../hooks/ledger'
import { CLAUDE_CODE, guidedCloseDescription } from '../hooks/model-text'
import { agentTools, recordClose, recordItem } from '../hooks/tools'
import { CODEX } from '../codex/src/texts'
import type { Ledger } from '../types'

const { values } = parseArgs({ options: { state: { type: 'string' }, log: { type: 'string' } } })
const state: { agent: 'claude' | 'codex'; isGuided: boolean; ledger: Partial<Ledger> } = JSON.parse(
  readFileSync(values.state!, 'utf8'),
)
const host = state.agent === 'codex' ? CODEX : CLAUDE_CODE
let ledger = { ...EMPTY, ...state.ledger } as Ledger

/**
 * Claude Code reads the guidance in `close`'s description, as in the mod; the other agents get it another way. The mod
 * registers `show` in Claude Code only.
 */
const TOOLS: { name: string }[] = agentTools(host).map(tool =>
  state.agent === 'claude' && state.isGuided && tool.name === 'close'
    ? {
        ...tool,
        description: guidedCloseDescription(host, tool.description).replaceAll('mcp__inbox__', 'mcp__probe__'),
      }
    : tool,
)
if (state.agent === 'claude') TOOLS.push(SHOW)
const shown = new Set<string>()

/** Answers as the mod's `showFile` does, without its Files store. */
function show(args: Record<string, unknown>): string {
  const target = typeof args.target === 'string' ? args.target.trim() : ''
  if (target === '') return 'Not added: show needs a target, a URL or a file path.'
  // The same decision as the mod's: a `file://` URL becomes its path, and a scheme other than http or https is refused.
  const decided = showTarget(target, process.cwd(), process.env.HOME ?? '')
  if (!decided) return notShownText(target)
  const given = typeof args.name === 'string' ? args.name.trim() : ''
  const name = given || (decided.isLink ? decided.target : (decided.target.split('/').pop() ?? decided.target))
  const isNew = !shown.has(decided.target)
  shown.add(decided.target)

  return `${isNew ? 'Added to' : 'Already in'} Files: ${name}`
}

function send(id: unknown, result: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function call(name: string, args: Record<string, unknown>): { text: string; isError: boolean } {
  if (name === 'show' && state.agent === 'claude') {
    const result = show(args)
    appendFileSync(values.log!, `${JSON.stringify({ tool: name, args, result })}\n`)

    return { text: result, isError: false }
  }
  const tool = name === 'record' ? recordItem : name === 'close' ? recordClose : null
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true }
  const r = tool(host, ledger, args, Date.now())
  ledger = r.ledger
  appendFileSync(values.log!, `${JSON.stringify({ tool: name, args, result: r.result })}\n`)

  return { text: r.result, isError: false }
}

createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line)
  if (msg.id === undefined) return
  switch (msg.method) {
    case 'initialize':
      return send(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '0.0.0' },
      })
    case 'tools/list':
      return send(msg.id, { tools: TOOLS })
    case 'tools/call': {
      const r = call(msg.params?.name, msg.params?.arguments ?? {})
      return send(msg.id, { content: [{ type: 'text', text: r.text }], isError: r.isError })
    }
    default:
      return send(msg.id, {})
  }
})
