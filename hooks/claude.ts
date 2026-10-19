import type { SessionMessage } from 'claude-code'
import type { Dialog, Ledger, Stop } from '../types'
import { dialogActivity, dialogQuestions, toolActivity } from './model-text'
import type { DialogOutcome } from './model-text'
import { clip } from './text'

const NL = '\n'

export function dialogOutcome(ran: { text?: string; isError?: true; deny?: string; result?: unknown }): DialogOutcome {
  if (ran.isError || typeof ran.deny === 'string') return { kind: 'dismissed' }
  const answer = ran.text ?? ''
  const fields = ran.result && typeof ran.result === 'object' ? (ran.result as { afkTimeoutMs?: unknown }) : {}

  return typeof fields.afkTimeoutMs === 'number' ? { kind: 'timed-out', answer } : { kind: 'answered', answer }
}

/**
 * The tool the Claude desktop app gives the agent to end a turn. With a question, the app draws a box under the
 * reply: the recap, the question, and up to two buttons. The agent writes nothing after it, so the question is
 * often in the box alone.
 */
export const TURN_BOX_TOOL = 'mcp__ccd_turn__wrap_up'

const BOX_BUTTONS = 2

/**
 * What the app's box shows the person, as text that ends the reply, or null when it shows no question. It reads the
 * fields the app reads: `recap`, `ask` and `actions`, or their `next_` forms. An action names an app button, such as
 * `create_pr`, or has its own `label`.
 */
export function turnBoxText(input: Record<string, unknown>): string | null {
  const field = (...keys: string[]) =>
    keys
      .map(k => input[k])
      .find((v): v is string => typeof v === 'string' && v.trim() !== '')
      ?.trim()
  const ask = field('ask', 'next_ask', 'next_brief')
  if (!ask) return null
  const actions = input.actions ?? input.next_actions
  const buttons = (Array.isArray(actions) ? actions : [])
    .map(a => {
      const action = (a ?? {}) as Record<string, unknown>
      if (typeof action.action === 'string') return action.action.replaceAll('_', ' ')

      return typeof action.label === 'string' ? action.label.trim() : ''
    })
    .filter(Boolean)
    .slice(0, BOX_BUTTONS)
  const recap = field('recap', 'next_recap', 'outcome')

  return [recap, buttons.length > 0 ? `${ask}${NL}Options: ${buttons.join(' / ')}` : ask].filter(Boolean).join(NL + NL)
}

const TRANSCRIPT_MAX = 80_000

const MESSAGE_MAX = 6000

export function transcriptText(messages: SessionMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const text = m.text.trim()
    if (m.role === 'user') {
      if (!text || text.startsWith('inbox:')) continue
      const row = readCommandRow(text)
      const line = row ? commandRowLine(row) : clip(text, MESSAGE_MAX)
      if (line) lines.push(`Person: ${line}`)
      continue
    }
    if (text) lines.push(`Agent: ${clip(text, MESSAGE_MAX)}`)
    for (const use of m.toolUses) {
      const line =
        use.tool === 'AskUserQuestion'
          ? dialogActivity(dialogQuestions(use.input.questions), dialogOutcome(use))
          : toolActivity(use.tool, use.input)
      if (line) lines.push(`Agent ${line}`)
    }
  }
  const kept: string[] = []
  let size = 0
  for (const line of lines.reverse()) {
    size += line.length + 1
    if (size > TRANSCRIPT_MAX) {
      kept.push('(earlier conversation left out)')
      break
    }
    kept.push(line)
  }

  return kept.reverse().join(NL)
}

export type CommandRow =
  | { kind: 'shell'; command: string }
  | { kind: 'output'; stdout: string; stderr: string }
  | { kind: 'slash'; name: string; args: string }

export function readCommandRow(text: string): CommandRow | null {
  const input = text.match(/^<bash-input>([\s\S]*)<\/bash-input>$/)
  if (input) return { kind: 'shell', command: (input[1] ?? '').trim() }
  const output = text.match(/<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>/)
  if (output) return { kind: 'output', stdout: (output[1] ?? '').trim(), stderr: (output[2] ?? '').trim() }
  const name = text.match(/<command-name>\/?([^<\s]+)<\/command-name>/)
  if (name)
    return {
      kind: 'slash',
      name: name[1] ?? '',
      args: (text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '').trim(),
    }

  return null
}

const QUIET_COMMANDS = new Set(['inbox', 'clear'])

export function commandRowLine(row: CommandRow): string | null {
  if (row.kind === 'shell') return `$ ${row.command}`
  if (row.kind === 'slash') return QUIET_COMMANDS.has(row.name) ? null : `/${row.name} ${row.args}`.trim()
  const output = [row.stdout, row.stderr].filter(Boolean).join(NL)

  return output ? `output: ${clip(output, 600)}` : null
}

export function stopKindOf(error: string, message: string): Stop['kind'] {
  if (error === 'rate_limit') return /\bhit your\b.*\blimit\b/i.test(message) ? 'usage-limit' : 'api-error'
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'verification_required':
    case 'cloud_credential_error':
      return 'sign-in'
    case 'billing_error':
    case 'account_on_hold':
      return 'billing'
    default:
      return 'api-error'
  }
}

export function resetTime(message: string): string | null {
  return message.match(/\bresets\s+(?:at\s+)?([^·(\n]+?)\s*(?:\(|·|$)/i)?.[1]?.trim() ?? null
}

function stopShort(stop: Stop): string {
  switch (stop.kind) {
    case 'sign-in':
      return 'Signed out: /login'
    case 'billing':
      return 'Billing problem'
    case 'usage-limit':
      return stop.resets ? `Limit: resets ${stop.resets}` : 'Usage limit reached'
    default:
      return 'API error: resume'
  }
}

function dialogText(dialog: Dialog): string {
  return dialog.kind === 'permission' ? `Allow ${dialog.text}?` : dialog.text
}

export function statusLine(ledger: Ledger, stop: Stop | null, dialogs: Dialog[]): string {
  if (stop) return `! ${stopShort(stop)}`
  const dialog = dialogs[0]
  if (dialog) return dialogText(dialog)
  const first = ledger.items[0]
  if (first) return ledger.items.length > 1 ? `${ledger.items.length} · ${first.ask}` : first.ask
  const count = ledger.findings.length
  const findings = count === 0 ? null : `${count} finding${count === 1 ? '' : 's'}`

  return [ledger.card?.now, findings].filter(Boolean).join(' · ')
}
