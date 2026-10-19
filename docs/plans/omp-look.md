# A shared session core, then omp as the third host

Status: building. Step 1 is built on the `session-core` branch, not yet merged.

omp ([omp.sh](https://omp.sh/)) is a terminal coding agent forked from pi. It loads TypeScript extensions in its own Bun process. A throwaway extension showed that the shared modules in `hooks/` load in omp unchanged, and that omp can draw the band above the prompt and an `/inbox` panel and take its keys. That extension drew the shared demo data only. It never ran a real session.

A host does more than draw. It reacts to the prompt, tool-call and turn-end events, keeps each session's state, runs the inbox model after each reply, runs a press's sends, opens and copies, and runs gh. That work is written twice today: in the mod's `hooks/register.tsx`, and in the Codex host's `codex/src/core.ts`, `hook.ts`, `server.ts` and `update.ts`. omp would make a third copy, and each later feature would be wired three times. So the shared part of that work moves into `hooks/` first, and omp is built on it.

## Order

1. Move the Codex host's session logic into shared modules. Codex runs on them with no change in behavior.
2. Build omp as a host and a look on those modules.
3. Add omp to the repo's checks, docs and release steps, and write down what a new host supplies.
4. Move the mod onto the shared session modules.

Each step passes `./scripts/check.sh` and leaves the shipped hosts working, so the steps can ship one at a time.

## Step 1: shared session modules

### `hooks/session.ts`

A shared module holding a session's state and the pure changes to it.

`Session` holds the fields of `SessionState` in `codex/src/state.ts` that do not depend on Codex:

| Field | What it holds |
| --- | --- |
| `ledger` | Items, closed items and linked PRs |
| `turn` | What the running turn gathered for the per-reply update: the person's words, activity, the press that sent it |
| `told` | The inbox text the agent last read, and the closed items it was told about |
| `presence` | Turns started and applied, ledger state, whether an update runs |
| `pending` | Exchanges waiting for the inbox model |
| `sent` | Messages a press sent, kept until the agent receives them |
| `lastActions` | Each row's last press |
| `heldRows` | Rows held while the person replies |
| `prViews` | The PRs tab's data |

Codex keeps `root`, `home`, `cliPath`, `tabSeenAt` and `heard` in its own `SessionState`, which extends `Session`. `heard` records whether Codex has run the inbox's hooks, which only Codex can skip.

These functions move from the Codex host, and take the host's `Host` names where they now read `CODEX`:

| Function | From | Does |
| --- | --- | --- |
| `cleared` | `core.ts` | Empties a session after `/clear` |
| `startContext` | `core.ts` | The guidance and carried items at session start |
| `notePrompt` | `core.ts` | Records a prompt, matches a press's sent message, returns the inbox text |
| `noteActivity` | `core.ts` | Adds a line of turn activity |
| `endTurn` | `core.ts` | Queues the exchange for the inbox model |
| `applied` | `update.ts` | Applies the inbox model's answer to the oldest exchange |
| `viewOf` | `core.ts` | The view a look draws, without Codex's `heard` |
| `pressOn` | `server.ts` | Applies a row or PR press |
| `completedAttempt` | `server.ts` | Records how a sent message's delivery went |
| the record and close changes | `server.ts` | Applies `recordItem` and `recordClose` |
| the PR merge | `server.ts:fetchPrs` | Merges fetched PRs into `prViews` |

Whether a look is open is a host fact, so `notePrompt`, `endTurn` and `viewOf` take it as an argument. Codex passes `isTabOpen`.

### `hooks/session-host.ts`

A shared module holding the `SessionHost` type and the async work that runs through it. `SessionHost` is everything a host supplies to run one session. Each function takes only the members it uses. The `Host` names and whether the inbox is open are arguments to the functions in `hooks/session.ts`, not members:

| Member | What the host does | Codex | omp |
| --- | --- | --- | --- |
| `now` | The clock | `Date.now` | `Date.now` |
| `read`, `update` | Read the session, and change it with a checkpoint before an external effect | a JSON file under a file lock | a JSON file under a lock held in the process |
| `exclusive` | Run the per-reply update while no other run holds the session | the `.updating` file lock | a flag held in the process |
| `ask` | Call the inbox model with the prompt `buildPrompt` writes | `codex exec` | `completeSimple` on a model from omp's registry |
| `deliver` | Send a message to the agent as if the person typed it | `codex queue` | `sendUserMessage` |
| `perform` | Open a link or path, or copy text | `open`, and copies return to the tab | `open`, and the clipboard |
| `prepare` | Throw before a sent record is saved when delivery cannot start | resolves the codex binary | nothing |
| `gh` | Find gh, run it, and report when it cannot start | `ghFinder` and `ghIn` | `pi.exec` |
| `settleWindowMs`, `newId` | The settle window before Done tells the agent, and delivery ids | `SETTLE_WINDOW_MS`, `randomUUID` | the same |

Three pieces of `codex/src/server.ts` and `update.ts` move here and run through a `SessionHost`:

- `runUpdates`: runs pending exchanges through `ask`, oldest first, once a turn ends.
- `press`: the body of `onPress`. It applies the press, saves a sent record before delivery, delivers, and runs local effects.
- `wakeForDone` and the PR fetch.

Codex keeps the MCP server, the tab, the hooks' input parsing, `codex queue` and `codex exec`. Each becomes a member of the Codex `SessionHost` or calls into these functions.

### Check

- The Codex tests in `codex/tests` keep passing unchanged. They are the proof that Codex behaves as before.
- `tests/session-script.ts` drives one scripted session through the shared functions and a `SessionHost`: a prompt, a `record` call, a turn end, the inbox model's answer, a press that sends, the arrival of that message, Done and Undo. It checks the rows, deliveries, turn counts and sent records after each event. `tests/session.test.ts` runs it with the in-memory host in `tests/session-fake-host.ts`. A later host runs it with its own `SessionHost`, which catches a host whose storage, checkpoint, lock or delivery breaks the shared flow. It calls the shared functions directly, so a host's event wiring needs its own tests.
- `scripts/check-structure.mjs` lists the two new shared modules.

## Step 2: omp host and look

omp's code lives in `omp/`. omp runs TypeScript directly, so it imports the shared modules with no bundle.

| File | Role |
| --- | --- |
| `omp/src/host.ts` | omp host. The only file that imports omp's API. It wires omp's events to the shared session modules and supplies the omp `SessionHost`. |
| `omp/src/state.ts` | omp host. One JSON file per session, under a lock held in the process. |
| `omp/src/panel.ts` | omp adapter. Draws the band and the `/inbox` panel from the shared view, and maps keys to presses. |
| `omp/package.json` | Lists `src/host.ts` under `omp.extensions`, so omp loads it from an installed plugin. |

omp and pi change their extension API often. Keeping every omp import in `host.ts` means a breaking omp release changes one file.

### omp events

| Inbox need | omp event or call |
| --- | --- |
| Guidance in the system prompt | `before_agent_start`, returning `systemPrompt` with `guidanceText(OMP)` added |
| The `inbox:` text beside each prompt | `before_agent_start`, returning a hidden custom message (`display: false`) with `notePrompt`'s notes. The message stays in the session, as the inbox text does in Claude Code and Codex. |
| `record` and `close` | `pi.registerTool`, with the descriptions, schemas and answers from `hooks/tools.ts` |
| Turn activity | `tool_call` events, through `toolActivity` |
| Turn end | `agent_end`, then `endTurn` and `runUpdates` |
| Send a press's message | `pi.sendUserMessage`, delivered as a follow-up while a turn runs |
| `/inbox` and the band | `registerCommand('inbox')`, `ctx.ui.custom` for the panel, `ctx.ui.setWidget` above the editor for the band |
| PRs | `pi.exec('gh', …)` through `fetchTracked` |
| Session id | `ctx.sessionManager.getSessionId()`. Subagents, which `ctx.agent.kind` names, are skipped. |

### The omp look

The panel follows the throwaway extension's design, rewritten in `omp/src/panel.ts` with tests. It has three tabs: Needs you, Findings and PRs. These differ from the terminal look on purpose:

- Enter presses the focused button. A row opens with its recommended option focused.
- ← and → move between a row's buttons, and wrap at either end.
- Tab and Shift+Tab switch tabs, and 1, 2 and 3 pick one.
- ↑ and ↓ wrap from the last row to the first.
- `r` opens the reply field.
- The panel is an overlay opened by `/inbox`, since omp has no side pane.
- Separators and task bullets use omp's `statusLineSep` theme color, so they match omp's own status line.

The button order still comes from `rowKeyPlan`.

### Choices for step 2

These are settled when step 2 starts:

- **The inbox model in omp.** omp's providers come from each person's own setup. Recommended: use a Sonnet model when the person's providers offer one, since the inbox model evals pass on Sonnet. Otherwise use omp's `@smol` model role, and say which model runs in the panel.
- **Where state lives.** Recommended: a JSON file per session under omp's agent folder, written like Codex's. `pi.appendEntry` is the alternative. It follows `/branch`, but it writes into the session file the agent reads back.

### Check

- The shared session test from step 1, run against the omp `SessionHost`.
- Tests for `omp/src/panel.ts`: button order from `rowKeyPlan`, focus and wrapping, and each row state.
- The agent eval suite with an omp runner, since `guidanceText(OMP)` and the omp tool descriptions are text a model reads. Each run is a paid model call through the person's omp providers.
- Live in omp: a real send through `sendUserMessage` and its arrival, the reply field, Undo and its countdown, the PRs tab, the light theme, a narrow terminal, and the newest omp release.

## Step 3: omp in the repo

- `Look` in `hooks/view.ts` gains `omp`.
- `docs/looks.md` lists omp's files, owners and differences on purpose. `GLOSSARY.md` names omp under Look, Host and Adapter.
- The demo order test in `tests/hooks.test.ts` covers the omp look.
- `scripts/check-structure.mjs` checks `omp/` imports, and `scripts/check.sh` runs omp's tests.
- `docs/release.md` lists omp's version field.
- `.claude-plugin/marketplace.json` lists the omp plugin, since omp's marketplace reads that file and loads `package.json#omp.extensions`.
- `docs/looks.md` gets a section on adding a host: the `SessionHost` members, the shared session test, the files a host and a look add, and the checks above.

## Step 4: the mod on the shared session modules

The mod keeps its session in `PluginState` in `types/index.d.ts`, and `hooks/register.tsx` runs both its host work and its two looks. This step maps `PluginState` onto `Session`, moves the mod's host work to a mod `SessionHost`, and leaves `register.tsx` drawing. Saved state outlives the code, so `upgradeState` converts each saved field that changes shape.

This step changes the most code, and runs last so that the `SessionHost` shape has been tested on two hosts first. After it, each host runs the same session code, and a new host supplies a `SessionHost`, a look and their tests.
