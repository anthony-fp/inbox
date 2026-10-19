import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { AssistantMessage, Context, Model } from '@oh-my-pi/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'

import { dialogActivity, dialogQuestions, guidanceText, systemText, toolActivity } from '../../hooks/model-text'
import type { DialogOutcome } from '../../hooks/model-text'
import type { PrPress } from '../../hooks/pr-tab'
import { ghFinder, ghIn } from '../../hooks/gh'
import type { Run } from '../../hooks/gh'
import type { RowPress } from '../../hooks/presses'
import { endTurn, noteActivity, notePrompt, recorded, sessionView } from '../../hooks/session'
import type { SessionView } from '../../hooks/session'
import { fetchPrs, isPrFetchDue, press, reconcileUpdateStatus, runUpdates, wakeForDone } from '../../hooks/session-host'
import type { PressOutcome, SessionHost } from '../../hooks/session-host'
import { CLOSE_DESCRIPTION, CLOSE_SCHEMA, RECORD_SCHEMA, recordDescription } from '../../hooks/tools'
import { DARK_TONES, LIGHT_TONES } from '../../hooks/tones'
import { NO_HOLDS, SETTLED_MS } from '../../hooks/view'
import type { ReplyHolds } from '../../hooks/view'
import { openTarget } from './commands'
import { createPanel } from './controller'
import type { PanelSource } from './controller'
import { demoSource } from './demo'
import { bandLine } from './panel'
import type { Style, Tone } from './panel'
import { exclusiveRun, pruneSessions, readState, updateState } from './state'
import type { OmpState } from './state'
import { OMP } from './texts'

const INBOX_MODEL_TIMEOUT_MS = 120_000
/** Added to the settle window so the timer fires after the window has fully passed. */
const WAKE_MARGIN_MS = 250
const SONNET = /sonnet/i
const MESSAGE_TYPE = 'inbox'
const BAND_KEY = 'inbox-band'

type Complete = (
  model: Model,
  context: Context,
  options: { apiKey: string; signal: AbortSignal },
) => Promise<AssistantMessage>

/** What the host takes from outside, so a test can supply its own. */
export type HostDeps = {
  /** The folder that holds the inbox's saved sessions. */
  stateDir: (pi: ExtensionAPI) => string
  now: () => number
  newId: () => string
  settleWindowMs: number
  home: string
  complete: Complete
  /** Copies text to the clipboard. Returns why it could not, or null. */
  copy: (text: string) => Promise<string | null>
  /** Runs work the handler that started it does not wait for. */
  background: (work: Promise<unknown>) => void
}

/** The view a look draws, with the facts about the host that the shared view does not hold. */
export type InboxScreen = {
  view: SessionView
  /** The model that runs the inbox update, or null when the person has none. */
  modelName: string | null
  isGhMissing: boolean
  isFetchingPrs: boolean
}

/** What a panel needs from the host. */
export type Inbox = {
  screen(ctx: ExtensionContext, holds?: ReplyHolds): Promise<InboxScreen>
  /** Marks the panel open, and runs what a freshly opened panel needs: Done messages due, and a PR fetch when due. */
  openPanel(ctx: ExtensionContext): Promise<void>
  closePanel(ctx: ExtensionContext): void
  fetchPrsWhenDue(ctx: ExtensionContext): void
  /** Calls `listener` after the session's saved state changes. Returns how to stop. */
  onChange(ctx: ExtensionContext, listener: () => void): () => void
  /** Applies a press for the session. `isStale` is true when the panel drew the press for another session. */
  press(ctx: ExtensionContext, p: RowPress | PrPress, holds: ReplyHolds, isStale?: boolean): Promise<PressOutcome>
}

async function defaultComplete(
  model: Model,
  context: Context,
  options: { apiKey: string; signal: AbortSignal },
): Promise<AssistantMessage> {
  const { completeSimple } = await import('@oh-my-pi/pi-ai')

  return completeSimple(model, context, options)
}

async function copyToClipboard(text: string): Promise<string | null> {
  const candidates =
    process.platform === 'darwin'
      ? [['pbcopy']]
      : process.platform === 'win32'
        ? [['clip']]
        : [['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of candidates) {
    try {
      const child = Bun.spawn(argv, { stdin: Buffer.from(text), stdout: 'ignore', stderr: 'ignore' })
      if ((await child.exited) === 0) return null
    } catch {
      continue
    }
  }

  return `no clipboard command started (${candidates.map(c => c[0]).join(', ')})`
}

const defaultDeps: HostDeps = {
  stateDir: pi => join(pi.pi.getAgentDir(), 'inbox'),
  now: Date.now,
  newId: randomUUID,
  settleWindowMs: SETTLED_MS,
  home: homedir(),
  complete: defaultComplete,
  copy: copyToClipboard,
  background: work => void work.catch(() => undefined),
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * True for a session nobody watches: a subagent, or a main session run without a UI (print mode). omp 18.1.17 gives
 * an extension no field for the agent kind, and starts a subagent with no UI. A build that adds `ctx.agent` also counts.
 */
function isUnattended(ctx: ExtensionContext): boolean {
  const agent = (ctx as { agent?: { kind?: unknown } }).agent

  return agent?.kind === 'sub' || !ctx.hasUI
}

const sessionIdOf = (ctx: ExtensionContext) => ctx.sessionManager.getSessionId()

/**
 * The inbox model: a Sonnet model the person's providers offer, since the inbox model evals pass on Sonnet. The
 * `anthropic` provider is preferred. Otherwise omp's `@smol` role.
 */
export function inboxModel(ctx: ExtensionContext): Model | null {
  const sonnets = ctx.models.list().filter(m => SONNET.test(m.id))
  const sonnet = sonnets.find(m => m.provider === 'anthropic') ?? sonnets[0]

  return sonnet ?? ctx.models.resolve('@smol') ?? null
}

/** The text blocks of a message's content, joined. */
function textOfBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((b: { type?: unknown; text?: unknown }) =>
      b.type === 'text' && typeof b.text === 'string' ? [b.text] : [],
    )
    .join('\n')
}

/** The last assistant message's text. */
function lastAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: unknown; content?: unknown } | undefined
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue

    return textOfBlocks(m.content)
  }

  return ''
}

/** The text of a user message. */
function userText(content: unknown): string {
  return typeof content === 'string' ? content : textOfBlocks(content)
}

/** The activity line for an omp tool call, through the names the shared `toolActivity` knows. */
function activityOf(tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case 'bash':
      return toolActivity('Bash', { command: input.command, run_in_background: input.async === true })
    case 'edit':
    case 'write':
      return toolActivity('Edit', { file_path: input.path ?? input.file_path })
  }

  return null
}

/** How an `ask` dialog ended, from its tool result. */
function askOutcome(event: {
  content: { type: string; text?: string }[]
  isError: boolean
  details?: unknown
}): DialogOutcome {
  const details = (event.details ?? {}) as { timedOut?: boolean; chatRedirect?: boolean }
  const answer = event.content.flatMap(b => (b.type === 'text' && b.text ? [b.text] : [])).join('\n')
  if (event.isError || details.chatRedirect || answer === '') return { kind: 'dismissed' }

  return { kind: details.timedOut ? 'timed-out' : 'answered', answer }
}

/** The slice of omp's theme the panel's style uses. */
type OmpTheme = {
  isLight: boolean
  bold(text: string): string
  inverse(text: string): string
  underline(text: string): string
  fg(color: 'accent' | 'statusLineSep', text: string): string
}

const ESC = '\x1b['

function truecolor(hex: string, text: string): string {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))

  return `${ESC}38;2;${r};${g};${b}m${text}${ESC}39m`
}

/** Maps the panel's styles onto omp's theme. The separator and the accent follow the theme; the tones follow `hooks/tones.ts`. */
export function styleOf(theme: OmpTheme): Style {
  const tones = theme.isLight ? LIGHT_TONES : DARK_TONES

  return {
    bold: theme.bold.bind(theme),
    dim: text => `${ESC}2m${text}${ESC}22m`,
    inverse: theme.inverse.bind(theme),
    underline: theme.underline.bind(theme),
    tone: (name: Tone, text) =>
      name === 'sep' || name === 'accent'
        ? theme.fg(name === 'sep' ? 'statusLineSep' : 'accent', text)
        : truecolor(tones[name], text),
  }
}

export function createInbox(pi: ExtensionAPI, deps: HostDeps = defaultDeps): Inbox {
  const dir = deps.stateDir(pi)
  const openPanels = new Set<string>()
  const prepared = new Set<string>()
  const fetchingPrs = new Set<string>()
  const prsFetchedAt = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()
  let noted: { id: string; prompt: string; notes: string[] } | null = null
  let isGhMissing = false

  /** Changes a session's saved state, then tells whoever draws it. */
  const notifyChanged = (id: string) => listeners.get(id)?.forEach(listener => listener())

  const change = async (id: string, fn: Parameters<typeof updateState>[2]) => {
    const saved = await updateState(dir, id, fn)
    notifyChanged(id)

    return saved
  }

  const run: Run = async (args, { cwd, timeoutMs }) => {
    const [file = '', ...rest] = args
    try {
      const r = await pi.exec(file, rest, { cwd, timeout: timeoutMs })

      return { code: r.killed ? -1 : r.code, stdout: r.stdout, stderr: r.stderr }
    } catch (err) {
      return { code: -1, stdout: '', stderr: messageOf(err) }
    }
  }
  const gh = ghFinder(run)

  function askFor(ctx: ExtensionContext, id: string): SessionHost<OmpState>['ask'] {
    return async prompt => {
      const model = inboxModel(ctx)
      if (!model) return null
      try {
        const apiKey = await ctx.modelRegistry.getApiKey(model, id)
        if (!apiKey) return null
        const reply = await deps.complete(
          model,
          {
            systemPrompt: [systemText(OMP)],
            messages: [{ role: 'user', content: prompt, timestamp: deps.now() }],
          },
          { apiKey, signal: AbortSignal.timeout(INBOX_MODEL_TIMEOUT_MS) },
        )
        if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return null
        const text = reply.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')

        return text === '' ? null : text
      } catch {
        return null
      }
    }
  }

  function hostFor(ctx: ExtensionContext): SessionHost<OmpState> {
    const id = sessionIdOf(ctx)

    return {
      now: deps.now,
      read: () => readState(dir, id),
      update: fn => change(id, fn),
      exclusive: fn => exclusiveRun(dir, id, fn),
      ask: askFor(ctx, id),
      deliver: async (_s, text) => {
        try {
          pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: 'followUp' })

          return { state: 'accepted', queuedId: null }
        } catch (err) {
          return { state: 'rejected', reason: messageOf(err) }
        }
      },
      perform: async (_s, effect) =>
        effect.kind === 'copy' ? deps.copy(effect.text) : openTarget(run, effect.target, ctx.cwd, deps.home),
      gh: {
        find: gh.find,
        forget: gh.forget,
        run: (_s, bin, onUnstartable) => ghIn(run, bin, ctx.cwd, onUnstartable),
        noteMissing: isMissing => {
          isGhMissing = isMissing
        },
      },
      settleWindowMs: deps.settleWindowMs,
      newId: deps.newId,
    }
  }

  /** Runs once for each session in this process: clears an update flag a crashed process left, and prunes old sessions. */
  function prepare(ctx: ExtensionContext): void {
    const id = sessionIdOf(ctx)
    if (prepared.has(id)) return
    prepared.add(id)
    deps.background(reconcileUpdateStatus(hostFor(ctx)))
    deps.background(pruneSessions(dir, id))
  }

  function fetchPrsWhenDue(ctx: ExtensionContext): void {
    const id = sessionIdOf(ctx)
    if (fetchingPrs.has(id)) return
    fetchingPrs.add(id)
    notifyChanged(id)
    deps.background(
      (async () => {
        try {
          const host = hostFor(ctx)
          const s = await host.read()
          const last = prsFetchedAt.get(id)
          if (!isPrFetchDue(s, last, deps.now())) return
          try {
            await fetchPrs(host)
          } finally {
            prsFetchedAt.set(id, deps.now())
          }
        } finally {
          fetchingPrs.delete(id)
          notifyChanged(id)
        }
      })(),
    )
  }

  function wakeLater(ctx: ExtensionContext): void {
    ctx.setTimeout(() => deps.background(wakeForDone(hostFor(ctx))), deps.settleWindowMs + WAKE_MARGIN_MS)
  }

  /** Counts a prompt that reached the agent: matches it to a press and returns the notes the agent is told. */
  async function arrive(id: string, text: string): Promise<string[]> {
    let notes: string[] = []
    await change(id, s => {
      const r = notePrompt(OMP, s, text, openPanels.has(id))
      notes = r.notes

      return r.state
    })

    return notes
  }

  const start = (_event: unknown, ctx: ExtensionContext) => {
    if (isUnattended(ctx)) return
    prepare(ctx)
    showBand(ctx)
  }
  pi.on('session_start', start)
  pi.on('session_switch', start)
  pi.on('session_shutdown', (_event, ctx) => {
    const id = sessionIdOf(ctx)
    openPanels.delete(id)
    prepared.delete(id)
    if (noted?.id === id) noted = null
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (isUnattended(ctx)) return
    prepare(ctx)
    const id = sessionIdOf(ctx)
    const guidance = guidanceText(OMP)
    const systemPrompt = event.systemPrompt.includes(guidance) ? event.systemPrompt : [...event.systemPrompt, guidance]
    // omp can run this handler again for one prompt. The prompt counts once.
    if (noted?.id !== id || noted.prompt !== event.prompt) {
      const notes = await arrive(id, event.prompt).catch(() => null)
      if (notes) noted = { id, prompt: event.prompt, notes }
    }
    const notes = noted?.notes ?? []

    return {
      systemPrompt,
      ...(notes.length > 0
        ? {
            message: {
              customType: MESSAGE_TYPE,
              content: notes.join('\n\n'),
              display: false,
              attribution: 'agent' as const,
            },
          }
        : {}),
    }
  })

  pi.on('turn_start', () => {
    noted = null
  })

  /** Activity notes are best effort. A failed write must not reject, because omp blocks the tool call when a tool_call handler throws. */
  const noteQuietly = async (ctx: ExtensionContext, line: string | null) => {
    if (!line) return
    try {
      await change(sessionIdOf(ctx), s => noteActivity(s, line))
    } catch {
      return
    }
  }

  pi.on('tool_call', async (event, ctx) => {
    if (isUnattended(ctx)) return
    await noteQuietly(ctx, activityOf(event.toolName, event.input as Record<string, unknown>))
  })

  pi.on('tool_result', async (event, ctx) => {
    if (isUnattended(ctx) || event.toolName !== 'ask') return
    const questions = dialogQuestions((event.input as { questions?: unknown }).questions)
    await noteQuietly(ctx, dialogActivity(questions, askOutcome(event)))
  })

  /**
   * A press sent while a turn runs reaches the agent as a queued message, and omp does not run before_agent_start for
   * it. Its arrival is noted here, once the message starts.
   */
  pi.on('message_start', async (event, ctx) => {
    const message = event.message as { role?: unknown; content?: unknown }
    if (isUnattended(ctx) || message.role !== 'user') return
    const id = sessionIdOf(ctx)
    const text = userText(message.content)
    if (text === '' || (noted?.id === id && noted.prompt === text)) return
    try {
      const isSentByPress = (await readState(dir, id)).sent.some(x => x.text === text)
      if (!isSentByPress) return
      const notes = await arrive(id, text)
      noted = { id, prompt: text, notes }
      if (notes.length > 0) {
        pi.sendMessage(
          { customType: MESSAGE_TYPE, content: notes.join('\n\n'), display: false, attribution: 'agent' },
          { deliverAs: 'nextTurn' },
        )
      }
    } catch {
      return
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    if (isUnattended(ctx) || event.willContinue) return
    prepare(ctx)
    const id = sessionIdOf(ctx)
    const reply = lastAssistantText(event.messages)
    const written = await change(id, s => endTurn(OMP, s, reply, openPanels.has(id))).catch(() => null)
    if (!written) return
    const host = hostFor(ctx)
    if (written.pending.length > 0) deps.background(runUpdates(host))
    deps.background(wakeForDone(host))
  })

  const tool = (name: 'record' | 'close', description: string, parameters: object) => {
    pi.registerTool({
      name,
      label: name === 'record' ? 'Inbox record' : 'Inbox close',
      description,
      parameters: parameters as never,
      loadMode: 'essential',
      approval: 'read',
      execute: async (_toolCallId, args, _signal, _onUpdate, ctx) => {
        if (isUnattended(ctx)) return { content: [{ type: 'text', text: 'The inbox is not shown in this session.' }] }
        let result = ''
        await change(sessionIdOf(ctx), s => {
          const r = recorded(OMP, s, name, args as Record<string, unknown>, deps.now())
          result = r.result

          return r.state
        })

        return { content: [{ type: 'text', text: result }] }
      },
    })
  }
  tool('record', recordDescription(OMP), RECORD_SCHEMA)
  tool('close', CLOSE_DESCRIPTION, CLOSE_SCHEMA)

  const modelNameOf = (ctx: ExtensionContext) => {
    const model = inboxModel(ctx)

    return model ? (model.name ?? model.id) : null
  }

  const inbox: Inbox = {
    screen: async (ctx, holds = NO_HOLDS) => {
      const id = sessionIdOf(ctx)

      return {
        view: sessionView(await readState(dir, id), deps.now(), deps.settleWindowMs, holds),
        modelName: modelNameOf(ctx),
        isGhMissing,
        isFetchingPrs: fetchingPrs.has(id),
      }
    },
    openPanel: async ctx => {
      openPanels.add(sessionIdOf(ctx))
      await wakeForDone(hostFor(ctx)).catch(() => undefined)
      fetchPrsWhenDue(ctx)
    },
    closePanel: ctx => {
      openPanels.delete(sessionIdOf(ctx))
    },
    fetchPrsWhenDue,
    onChange: (ctx, listener) => {
      const id = sessionIdOf(ctx)
      const set = listeners.get(id) ?? new Set()
      set.add(listener)
      listeners.set(id, set)

      return () => void set.delete(listener)
    },
    press: async (ctx, p, holds, isStale = false) => {
      const outcome = await press(hostFor(ctx), p, isStale, holds)
      if (outcome.wakesForDone) wakeLater(ctx)

      return outcome
    },
  }

  const liveSource = (ctx: ExtensionContext): PanelSource => ({
    screen: holds => inbox.screen(ctx, holds),
    press: async (p, holds) => {
      const outcome = await inbox.press(ctx, p, holds)

      return { error: outcome.error, note: outcome.note }
    },
    fetchPrsWhenDue: () => inbox.fetchPrsWhenDue(ctx),
    onChange: listener => inbox.onChange(ctx, listener),
  })

  const hideBand = (ctx: ExtensionContext) => ctx.ui.setWidget(BAND_KEY, undefined)

  function showBand(ctx: ExtensionContext): void {
    if (ctx.mode !== 'tui') return
    ctx.ui.setWidget(
      BAND_KEY,
      (tui, theme) => {
        const style = styleOf(theme)
        let screen: InboxScreen | null = null
        const refresh = () =>
          inbox
            .screen(ctx)
            .then(next => {
              screen = next
              tui.requestRender()
            })
            .catch(() => undefined)
        void refresh()
        const stop = inbox.onChange(ctx, () => void refresh())

        return {
          render: width => (screen ? [bandLine(screen, width, style)] : []),
          invalidate: () => {},
          dispose: stop,
        }
      },
      { placement: 'aboveEditor' },
    )
  }

  async function openPanelUi(ctx: ExtensionContext, isDemo: boolean): Promise<void> {
    const { parseKey, extractPrintableText, truncateToWidth } = await import('@oh-my-pi/pi-tui')
    const source = isDemo
      ? demoSource({
          now: deps.now,
          after: (fn, ms) => void ctx.setTimeout(fn, ms),
          settleWindowMs: deps.settleWindowMs,
        })
      : liveSource(ctx)
    hideBand(ctx)
    if (!isDemo) await inbox.openPanel(ctx)
    try {
      await ctx.ui.custom<null>((tui, theme, _keybindings, done) => {
        const panel = createPanel({
          source,
          style: styleOf(theme),
          now: deps.now,
          requestRender: () => tui.requestRender(),
          close: () => done(null),
          timers: { every: (fn, ms) => ctx.setInterval(fn, ms), stop: handle => ctx.clearTimer(handle as never) },
          height: () => Math.max(10, tui.terminal.rows - 4),
        })
        void panel.start()

        return {
          render: width => panel.render(width).map(line => truncateToWidth(line, width)),
          handleInput: raw => {
            const key = parseKey(raw) ?? ''
            panel.handleInput(key, extractPrintableText(raw))
          },
          invalidate: () => {},
          dispose: () => panel.dispose(),
        }
      })
    } finally {
      if (!isDemo) inbox.closePanel(ctx)
      showBand(ctx)
    }
  }

  pi.registerCommand('inbox', {
    description: 'Show what waits on you',
    handler: async (args, ctx) => {
      const isDemo = args.trim() === 'demo'
      if (ctx.mode === 'tui') return openPanelUi(ctx, isDemo)
      const screen = isDemo
        ? await demoSource({ now: deps.now, after: () => {}, settleWindowMs: deps.settleWindowMs }).screen(NO_HOLDS)
        : await inbox.screen(ctx)
      const { needsYou, findings } = screen.view
      ctx.ui.notify(`Needs you ${needsYou.count}, Findings ${findings.count}`, 'info')
    },
  })

  return inbox
}

export default function (pi: ExtensionAPI): void {
  createInbox(pi)
}
