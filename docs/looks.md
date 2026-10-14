# Looks

Status: current. Read this before you change the UI or a business rule.

The inbox has three looks: `terminal`, `desktop` and `codex`. A look is one way the inbox is drawn, and `GLOSSARY.md` defines it with host, shared module, adapter and difference on purpose. The rule is that shared modules decide and adapters draw. If a rule decides what a row says, which action leads, when a tab counts as empty or what text appears, it lives in a shared module. An adapter decides only how its look draws that. The plan for finishing this split is `docs/plans/three-looks.md`.

## Files

Shared modules are in `hooks/`. Both hosts import them. They import nothing from the engine or from a host, and `scripts/check-structure.mjs` checks that. The one exception is a type import from the engine in `hooks/ledger.ts`, which step 5 of `docs/plans/three-looks.md` removes.

| File | Role |
| --- | --- |
| `hooks/view.ts` | Shared module. The inbox view: Needs you order and count, handles, row state, feedback, done labels, action order, key plan, timing constants. |
| `hooks/presses.ts` | Shared module. The press reducer, its effects, and the saved last-action shape. |
| `hooks/arrivals.ts` | Shared module. Which rows are new, and where a look moves for them. |
| `hooks/ledger.ts` | Shared module. Saved ledger, ledger writes, and the texts the model reads. It also holds Claude-only code and two UI helpers, `ago` and `isLapsed`. |
| `hooks/prs.ts` | Shared module. PR parsing, readiness and prompts. |
| `hooks/pr-tab.ts` | Shared module. The PRs tab's rules: fetching each tracked PR through a host's gh runner, which PRs the tab draws, its row ids, and what each PR press does. |
| `hooks/tools.ts` | Shared module. The record_finding and close tools. |
| `hooks/demo.ts` | Shared module. Sample data for `/inbox demo` and the Codex demo. |
| `hooks/layout.ts` | Shared module. Sizes the desktop look and the Codex tab share. |
| `hooks/inline.ts` | Shared module. Inline markdown in the agent's text, as spans each look draws. |
| `hooks/register.tsx` | Mod adapter. Draws the terminal and desktop looks, and also runs the band, the PRs tab, the per-reply update and the press runner. |
| `hooks/tabs-client.tsx` | Mod only. A Client region for the desktop tab bar, so each tab takes clicks over its whole shape. |
| `hooks/row-client.tsx` | Mod only. A Client region for a closed row in the desktop pane. |
| `hooks/fold-client.tsx` | Mod only. A Client region for the desktop "N Closed" line. |
| `hooks/links-client.tsx` | Mod only. A Client region for an open row's follow-ups on desktop. |
| `hooks/undo-client.tsx` | Mod only. A Client region for Undo on desktop, whose fill drains while Undo lasts. |
| `codex/src/tab.tsx` | Codex adapter. Draws the Codex tab and runs its page code: polling, keys, clipboard. |
| `codex/src/tab.html` | Codex adapter. The tab's styles and page shell. |
| `codex/src/rows.ts` | Codex adapter. The motion state machine for rows. |
| `codex/src/arrivals.ts` | Codex adapter. The tab's rows, tabs and empty-tab rule, built on `hooks/arrivals.ts`. |
| `codex/src/settle.ts` | Codex adapter. Polling and settle-window timing for the tab. |
| `codex/src/texts.ts` | Codex adapter. Texts only Codex reads, and the `CODEX` host. |
| `codex/src/core.ts` | Codex host. Session logic as pure functions on the session state. |
| `codex/src/state.ts` | Codex host. One JSON state file per session, under a lock. |
| `codex/src/server.ts` | Codex host. The MCP server: tools, presses, open, queue, and the background fetch of the session's PRs. |
| `codex/src/gh.ts` | Codex host. Finds a gh the server can start, and runs it for the shared PR fetch. |
| `codex/src/server-main.ts` | Codex host. The loader that Codex starts once per app launch. |
| `codex/src/server-handler.ts` | Codex host. The request handler the loader reloads. |
| `codex/src/update.ts` | Codex host. The per-reply update through `codex exec`. |
| `codex/src/update-main.ts` | Codex host. Entry point for the update process. |
| `codex/src/hook.ts` | Codex host. The hook logic that changes session state. |
| `codex/src/hook-main.ts` | Codex host. Entry point for the hooks. |
| `codex/src/demo.ts` | Codex host. Turns the shared demo data into a session. |
| `codex/src/transcript.ts` | Codex host. Reads the Codex session transcript. |
| `codex/src/run.ts` | Codex host. Runs a command with Node. |

## Who owns each rule

Change a rule in its owner. Do not change it in a reader.

| Rule | Owner | Read by |
| --- | --- | --- |
| Needs you order and count | `hooks/view.ts:needsYouOrder`, `hooks/view.ts:inboxView` | All three looks, the band and the status line |
| Question handles | `hooks/ledger.ts:questionNumbers`, read by `hooks/view.ts:inboxView` | The terminal look only. It draws `1)` or `•`. Desktop and Codex draw no handle on a question. |
| Finding groups and handles | `hooks/view.ts:FINDING_GROUPS`, `hooks/view.ts:drawnLists` | All three looks. Each lists findings under an Issues and an Opportunities title and draws the kind's mark as the handle. A handed-off finding draws ✓ instead. |
| Row state | `hooks/view.ts:RowState`, `hooks/presses.ts:isHandedOff` | All three looks |
| Which row opens: by default, when rows arrive above it, and after a press closes the open row | `hooks/view.ts:firstWaiting`, `hooks/view.ts:keptOpen`, `hooks/view.ts:rowAfterClose` | All three looks |
| Feedback text | `hooks/view.ts:feedbackText`, `hooks/view.ts:feedbackOf` | Terminal and desktop through the pane, Codex through the tab |
| Done labels | `hooks/view.ts:DONE_LABELS` | All three looks |
| Action order | `hooks/view.ts:actionsOf` | All three looks |
| Key plan | `hooks/view.ts:rowKeyPlan` | All three looks take the order. Terminal draws the key letters. Desktop and Codex draw labels only, and Codex still binds the letters. |
| Press reducer and effects | `hooks/presses.ts:applyPress`, `hooks/presses.ts:runLocalEffects`, `hooks/presses.ts:runSends` | The mod and the Codex server |
| Settle window | `hooks/view.ts:SETTLED_MS`, `hooks/view.ts:settleWindowMs` | The mod passes `SETTLED_MS`. Codex passes `codex/src/settle.ts:SETTLE_WINDOW_MS`. |
| Closed fold size | `hooks/view.ts:CLOSED_SHOWN`, `hooks/view.ts:closedShown` | All three looks |
| Options fold size | `hooks/view.ts:OPTIONS_FOLD_AT` | All three looks through `actionsOf` |
| New rows and where a look moves | `hooks/arrivals.ts:recordRows`, `hooks/arrivals.ts:followTo` | The pane and the Codex tab |
| Press guard | `hooks/view.ts:PRESS_GUARD_MS` | All three looks |
| Row padding | `hooks/layout.ts:ROW_PAD_PT` | Desktop and Codex |
| Demo data | `hooks/demo.ts:demoView` | The mod's `/inbox demo` and `codex/src/demo.ts:demoState` |
| Model-read texts | `hooks/ledger.ts:guidanceText`, `hooks/ledger.ts:systemText`, `hooks/ledger.ts:inboxText`, `hooks/ledger.ts:promptNotes`, `hooks/tools.ts:findingDescription` | The mod and Codex, each through its `Host` |
| Saved state shapes and upgrades | `types/index.d.ts:PluginState`, `hooks/ledger.ts:upgradeLedger`, `hooks/presses.ts:upgradeLastActions` | The mod also uses `hooks/register.tsx:upgradeState`. Codex uses `codex/src/state.ts:upgraded`. |
| PR readiness and prompts | `hooks/prs.ts:readiness`, `hooks/prs.ts:prompts` | The mod and the Codex tab |
| PR presses, which PRs the tab draws, and how a PR is fetched | `hooks/pr-tab.ts:applyPrPress`, `hooks/pr-tab.ts:drawnPrs`, `hooks/pr-tab.ts:fetchTracked` | The mod and the Codex server |

Some rules are still written once per adapter. Each is a place where the looks can drift.

| Rule | Where it is written | Status |
| --- | --- | --- |
| Row content: mark, second line, finding head, text-field hint, file line | `hooks/register.tsx:itemRow`, `hooks/register.tsx:findingRow`, `codex/src/tab.tsx:itemRow`, `codex/src/tab.tsx:findingRow` | Two copies until step 6 of `docs/plans/three-looks.md` |
| Copy strings: status line, empty findings text, Undo, Try again, Send, Cancel, group titles | `hooks/register.tsx` and `codex/src/tab.tsx` | Two copies until step 6 of `docs/plans/three-looks.md` |
| Empty-tab rule | `hooks/register.tsx:followNewRows`, `codex/src/arrivals.ts:isShownEmpty` | Two copies until step 8 of `docs/plans/three-looks.md`. Their inputs differ but their results agree today. |
| Per-reply update, activity cap of 40, Undo's `told.closed` cleanup | `hooks/register.tsx:runUpdate`, `hooks/register.tsx:noteActivity`, `codex/src/update.ts:applied`, `codex/src/core.ts:noteActivity`, `codex/src/server.ts:makeServer` | Two copies until step 9 of `docs/plans/three-looks.md` |
| Open effect and demo press | `hooks/register.tsx:openPath`, `hooks/register.tsx:runDemoPress`, `codex/src/server.ts:makeServer` | Two copies until step 9 of `docs/plans/three-looks.md` |

## Differences on purpose

A difference is on purpose when a look cannot do something or the product decided it. Anything not listed here is drift.

| Topic | Terminal | Desktop | Codex | Why | Where |
| --- | --- | --- | --- | --- | --- |
| Keys | Button hotkeys work. The key letter is drawn before the label. Explain has a key and no button, so it does not crowd a row's answers. | Clicks only. Button hotkeys do nothing, and no letter is drawn. Explain is a button beside Reply and Dismiss. | A page `keydown` handler takes the letters. No key text is drawn. Explain has a key and no button, as in the terminal. | The desktop pane takes no key input. A browser page can, but keys are an extra there. | `hooks/register.tsx:keyedButton`, `codex/src/tab.tsx:KeyButton`, `hooks/view.ts:rowKeyPlan` |
| Hit areas | Character cells. | A Button takes a click only over its label. A Client region takes clicks over a whole shape. | Normal page hit areas. | The engine draws desktop Buttons label-sized. | `hooks/row-client.tsx:RowProps`, `hooks/tabs-client.tsx:TabsProps` |
| Motion and bars | Undo's fill drains by cells until the row leaves. A just-closed row without Undo shows a bar that shrinks by half cells. No animation. | Undo's fill drains while it lasts. No leave bar and no animation. | Rows enter, move and exit. | The pane has no opacity, transform or CSS. | `hooks/register.tsx:leaveBar`, `hooks/undo-client.tsx`, `codex/src/rows.ts:stepRow` |
| Redraw and polling | Redraws in steps while a row leaves. | Redraws once when a row leaves. A timer redraw loop made clicks fail. | The tab polls the server every 3 seconds. | Only the mod gets pushed events. | `hooks/register.tsx:redrawWhileLeaving`, `codex/src/settle.ts:POLL_MS` |
| Hot reload | Mod handlers reload. | Same as terminal. | The handler reloads, and an open tab replaces its page with the new build's. The loader needs Codex restarted. | Codex starts the loader once per app launch and keeps it. | `codex/src/server-main.ts:load`, `codex/src/server-handler.ts:createHandler` |
| Storage | Engine atoms hold the live session. The engine store keeps a saved ledger per session. | Same as terminal. | One JSON file per session, under a lock. | Codex has no engine store. Its hooks run as separate short-lived processes beside the server. | `hooks/register.tsx:save`, `codex/src/state.ts:withLock` |
| How a press sends, opens and copies | Sends with the engine's prompt submit. Opens and copies in process. | Same as terminal. | Sends with `codex queue` from the server. Opens in the server. The tab copies. | Codex's server cannot reach the page's clipboard. | `hooks/presses.ts:EffectHost`, `codex/src/server.ts:makeServer` |
| Band, stop and dialog rows | Yes. | Yes. | No. | Codex has no line above its prompt. | `hooks/view.ts:TABS`, `hooks/view.ts:ROW_TABS` |
| PR data | The mod runs gh through the engine, on a timer while the person is around. | Same as terminal. | The server runs gh through `deps.exec` in the session's folder, and refetches on a view when the last fetch is over 2 minutes old. It tries `gh`, then the Homebrew folders. | The desktop app may start the server without Homebrew on its PATH. | `hooks/register.tsx:fetchPrsNow`, `codex/src/server.ts:fetchPrs`, `codex/src/gh.ts:ghFinder` |
| Settle window | A row stays in place for `SETTLED_MS` from the close. | Same as terminal. | The server lists a row as settled for `SETTLED_MS` plus two polls from the close. The tab draws it in place for `SETTLED_MS` from the first poll that lists it. | The tab only learns of a close at its next poll. | `codex/src/settle.ts:SETTLE_WINDOW_MS`, `codex/src/settle.ts:drawnSettled` |
| Failed per-reply update | Keeps `turnsApplied`. | Same as terminal. | Advances `turnsApplied`. | The mod has a catch-up that retries. Codex has none, so a handed-off row would stay folded. | `hooks/register.tsx:queueUpdate`, `codex/src/update.ts:applied` |
| Primary buttons | None. A plain terminal Button ignores `variant`. The recommended option ends "(recommended)". | The recommended option, Done and Address. | The recommended option, Done and Address, as on desktop. | `docs/plans/inbox-ui.md` says the desktop pane makes the recommended option, or else Done or Address, the primary button. | `hooks/register.tsx:keyedButton`, `codex/src/tab.tsx:KeyButton` |
| Finding path display | The file name, in Claude Code's inline-code color. | Same as terminal. The pane has no font props. | The file name in the mono font, on a soft chip. The full path shows on hover. | The full path is long and shows a private folder. | `hooks/register.tsx:findingRow`, `codex/src/tab.tsx:findingRow` |
| Clipping | The adapter clips to the cell width, one character per cell. | The adapter clips with a measured characters-per-cell estimate. | CSS wraps and truncates. | Shared text is never pre-shortened. Each adapter knows its own width. | `hooks/register.tsx:rowClientProps`, `hooks/register.tsx:DESKTOP_CLIP_CHARS_PER_CELL` |
| Closed row age | Always drawn. | Dropped below 50 columns. | Always drawn. | A narrow desktop pane has no room for it. | `hooks/register.tsx:DESKTOP_WIDE_AT` |
| Colors | The Claude Code theme's palette. | Hex palettes for the dark and light themes, else translucent gray fills. | The host's theme and style variables, applied as CSS variables. | Each look matches its host app. | `hooks/register.tsx:paletteFor`, `codex/src/tab.tsx:applyHost` |
| `/inbox` during a turn | Runs at once. | Waits until the turn ends. | No command. The Inbox tab opens at any time. | The command is registered `immediate`. The desktop app sends a typed command through Claude Code's prompt queue, which holds it until the turn ends whatever `immediate` says, as checked in Claude Code 2.1.296. | `hooks/register.tsx:turnOn` |
| Look for mobile and VS Code | Used. | Not used. | Not used. | The engine's `surface` can be `mobile` or `vscode`, which nobody has checked. They get the terminal look. | `hooks/register.tsx:lookOf` |

## After you change X, check Y

State in your change, for each look, whether it applies and what you checked.

| Change | Edit | Then check |
| --- | --- | --- |
| A row action | `hooks/view.ts:actionsOf`, `hooks/presses.ts:applyPress`, and `hooks/view.ts:DONE_LABELS` for its label | The action appears in terminal, desktop and the Codex tab. Check Undo, failure and key letters. Add the case to `tests/hooks.test.ts` and `codex/tests/press.spec.ts` when the repo's coverage expects it. |
| A row field | `hooks/view.ts:inboxView` and the `RowView` type, then `itemRow` and `findingRow` in both adapters | Both adapters draw the field. Until step 6, search both for the old field name. |
| A word on screen | The shared string in `hooks/view.ts` or `hooks/presses.ts`, else both adapters | Run the change through the `refine-prose` skill. Check each look for clipping. |
| Model-read text | `hooks/ledger.ts` or `hooks/tools.ts`. The guidance and every `inbox:` text reach both agents. | A/B test it as `AGENTS.md` says, with Sonnet for Claude and with `codex exec` and the model in `codex/src/update.ts:MODEL` for Codex. |
| A saved field | `types/index.d.ts:PluginState`, then `hooks/ledger.ts:upgradeLedger` or `hooks/register.tsx:upgradeState`, and `codex/src/state.ts:upgraded` | Load a state saved by the old build in the mod and in Codex. |
| A size or timing | `hooks/view.ts` constants or `hooks/layout.ts:ROW_PAD_PT` when both looks share it, else the adapter's own constant | Measure in the terminal, desktop and Codex tab. Add a row to Differences on purpose when the values differ. |
| A tab | `hooks/view.ts:TABS` and `hooks/view.ts:ROW_TABS` | The mod pane, the Codex tab, `codex/src/arrivals.ts:TAB_IDS` and the empty text in `hooks/view.ts:emptyText`. |
| A PR feature | `hooks/prs.ts` and `hooks/pr-tab.ts:applyPrPress` | All three looks. Check the PRs tab in each, and add the case to `codex/tests/server.spec.ts` when the repo's coverage expects it. |
| Anything in `hooks/` that Codex imports | The shared module | Run `npm --prefix codex run build` to rebuild the Codex bundles. `./scripts/check.sh` fails until you do. |
| `codex/src/server-main.ts` | The loader | Quit and reopen Codex. A change to `codex/src/server-handler.ts` or anything it imports reloads without a restart. |

## Checks

`scripts/check-structure.mjs` fails when a shared module imports the engine or a host, and when `codex/src` or `codex/tests` imports a file in `hooks/` that is not a shared module. It also fails on a plan with no status line, a doc that names a missing file, and a `file:symbol` in this file that does not exist. The symbol check passes when the file contains the word anywhere, so it does not prove a definition. `./scripts/check.sh` runs the script with prettier, plugin validation, type checks, the mod tests, and the Codex bundle, type and test checks. Run `./scripts/check.sh` after every change.
