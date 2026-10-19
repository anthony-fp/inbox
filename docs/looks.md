# Looks

Status: current. Read this before you change the UI or a business rule.

The inbox has four looks: `terminal`, `desktop`, `codex` and `omp`. A look is one way the inbox is drawn, and `GLOSSARY.md` defines it with host, shared module, adapter and difference on purpose. The rule is that shared modules decide and adapters draw. If a rule decides what a row says, which action leads, when a tab counts as empty or what text appears, it lives in a shared module. An adapter decides only how its look draws that. The plan for finishing this split is `docs/plans/three-looks.md`.

## Files

Shared modules are in `hooks/`. Every host consumes them, directly or through a build. They import only shared modules and shared types. `scripts/check-structure.mjs` checks those boundaries, including type imports. Codex and omp type checking need no generated Claude engine types.

| File | Role |
| --- | --- |
| `hooks/view.ts` | Shared module. The inbox view: Needs you order and count, handles, row state, feedback, done labels, action order, key plan, timing constants. |
| `hooks/presses.ts` | Shared module. The press reducer, its effects, and the saved last-action shape. |
| `hooks/arrivals.ts` | Shared module. Which rows are new, and where a look moves for them. |
| `hooks/ledger.ts` | Shared module. Saved ledger, upgrades, reply parsing and ledger writes. |
| `hooks/model-text.ts` | Shared module. Guidance, prompts, inbox notes, question numbers and the `Host` and `Told` types. Each host's `Host` names its agent, surface and the `record` and `close` tools. |
| `hooks/session.ts` | Shared module. The session state shape, and its pure functions: `notePrompt`, `endTurn`, `recorded`, `pressOn` and `sessionView`. |
| `hooks/session-host.ts` | Shared module. The `SessionHost` flows that run on a host's store: `runUpdates`, `reconcileUpdateStatus`, `wakeForDone`, `press`, `fetchPrs` and `isPrFetchDue`. |
| `hooks/gh.ts` | Shared module. `ghFinder` finds a gh that starts, and `ghIn` runs it, over a host's command runner. |
| `hooks/text.ts` | Shared module. Clipping, code-block formatting and relative ages. |
| `hooks/claude.ts` | Mod only. Claude transcript, command, dialog, stop and sidebar helpers. |
| `hooks/prs.ts` | Shared module. PR parsing, readiness and prompts. |
| `hooks/pr-tab.ts` | Shared module. The PRs tab's rules: fetching each tracked PR through a host's gh runner, which PRs the tab draws, its row ids, and what each PR press does. |
| `hooks/tools.ts` | Shared module. The record and close tools. |
| `hooks/demo.ts` | Shared module. Sample data for `/inbox demo` and the Codex demo. |
| `hooks/layout.ts` | Shared module. Sizes the desktop look and the Codex tab share. |
| `hooks/tones.ts` | Shared module. Status colors for native marks and terminal palettes. The Codex build writes them into CSS, and omp draws them as true color. |
| `hooks/inline.ts` | Shared module. Inline markdown in the agent's text, as spans each look draws. |
| `hooks/register.tsx` | Mod adapter. Draws the terminal and desktop looks, and also runs the band, the PRs tab, the per-reply update and the press runner. |
| `hooks/tabs-client.tsx` | Mod only. A Client region for the desktop tab bar, so each tab takes clicks over its whole shape. |
| `hooks/row-client.tsx` | Mod only. A Client region for a closed row in the desktop pane. |
| `hooks/fold-client.tsx` | Mod only. A Client region for the desktop "N Closed" line. |
| `hooks/links-client.tsx` | Mod only. A Client region for an open row's follow-ups on desktop. |
| `hooks/undo-client.tsx` | Mod only. A Client region for Undo on desktop, whose fill drains while Undo lasts. |
| `codex/src/tab.tsx` | Codex adapter. Draws the tab and runs page code: polling, selection, keys and clipboard. |
| `codex/src/row-actions.tsx` | Codex adapter. Maps shared actions to buttons and draws reply fields. Its production components have mounted tests. |
| `codex/src/tab.html` | Codex adapter. The tab's styles and page shell. |
| `codex/src/rows.ts` | Codex adapter. The motion state machine for rows. |
| `codex/src/arrivals.ts` | Codex adapter. The tab's rows, tabs and empty-tab rule, built on `hooks/arrivals.ts`. |
| `codex/src/settle.ts` | Codex adapter. Polling and settle-window timing for the tab. |
| `codex/src/texts.ts` | Codex adapter. Texts only Codex reads, and the `CODEX` host. |
| `codex/src/core.ts` | Codex host. Codex bindings over `hooks/session.ts`, the tab view and tab helpers. |
| `codex/src/data-dir.ts` | Codex host. The data folder and the dev build, which the loader reads. It imports no shared module, so a shared-module change leaves the loader's bundle unchanged. |
| `codex/src/state.ts` | Codex host. One JSON state file per session, under a lock. `SessionState` extends the shared `Session` from `hooks/session.ts`. |
| `codex/src/host.ts` | Codex host. `codexStore`, the Codex store that `hooks/session-host.ts` runs on. |
| `codex/src/server.ts` | Codex host. The MCP server: tools, and the host bindings for presses, open, queue and the background fetch of the session's PRs, which run in `hooks/session-host.ts`. |
| `codex/src/server-main.ts` | Codex host. The loader that Codex starts once per app launch. |
| `codex/src/server-handler.ts` | Codex host. The request handler the loader reloads. |
| `codex/src/update.ts` | Codex host. Binds `hooks/session-host.ts` update flows to `codex exec`. |
| `codex/src/update-main.ts` | Codex host. Entry point for the update process. |
| `codex/src/hook.ts` | Codex host. The hook logic that changes session state. |
| `codex/src/hook-main.ts` | Codex host. Entry point for the hooks. |
| `codex/src/demo.ts` | Codex host. Turns the shared demo data into a session. |
| `codex/src/transcript.ts` | Codex host. Reads the Codex session transcript. |
| `codex/src/run.ts` | Codex host. Runs a command with Node. |
| `omp/src/host.ts` | omp host. The only file that imports omp's packages. Wires omp's events to the shared session modules, registers the `record` and `close` tools and the `/inbox` command, shows the band, and supplies omp's `SessionHost`. |
| `omp/src/state.ts` | omp host. One JSON file per session under omp's agent folder, with a lock held in the process. `OmpState` extends the shared `Session`. |
| `omp/src/commands.ts` | omp host. Opens links and paths for omp's `SessionHost`. |
| `omp/src/texts.ts` | omp host. The `OMP` host names the shared guidance uses. |
| `omp/src/panel.ts` | omp adapter. Draws the band and the `/inbox` panel from the shared view and plans, and maps keys to presses. It imports no omp package. |
| `omp/src/controller.ts` | omp adapter. The open panel: the cached screen, the person's ui state, the work a key starts, and the redraw timer. |
| `omp/src/demo.ts` | omp host. Turns the shared demo data into a panel source for `/inbox demo`. |
| `omp/build.ts` | omp host. Bundles `omp/src/host.ts` and the shared modules into `omp/dist/host.js`. `--check` fails when the bundle is stale. |
| `omp/dist/host.js` | omp host. The committed bundle, which `omp/package.json` lists under `omp.extensions`. |
| `omp/package.json` | omp host. The plugin's version, `omp.extensions`, and the build, check, test and type scripts. |
| `.omp-plugin/marketplace.json` | omp host. The omp marketplace, which points at `omp/`. omp reads it before `.claude-plugin/marketplace.json`, which Claude Code reads. |

## Who owns each rule

Change a rule in its owner. Do not change it in a reader.

| Rule | Owner | Read by |
| --- | --- | --- |
| Needs you order and count | `hooks/view.ts:needsYouOrder`, `hooks/view.ts:inboxView` | All four looks, the band and the status line |
| Question handles | `hooks/model-text.ts:questionNumbers`, read by `hooks/view.ts:inboxView` | The terminal and omp looks. They draw `1)` or `•`. Desktop and Codex draw no handle on a question. |
| Needs you groups | `hooks/view.ts:NEEDS_YOU_GROUPS` | The mod and omp. The Codex tab names the groups in `codex/src/tab.tsx`. |
| Finding groups and handles | `hooks/view.ts:FINDING_GROUPS`, `hooks/view.ts:drawnLists` | All four looks. Each lists findings under an Issues and an Opportunities title and draws the kind's mark as the handle. A handed-off finding draws ✓ instead. |
| Row state | `hooks/view.ts:RowState`, `hooks/presses.ts:isHandedOff` | All four looks |
| Which row opens: by default, when rows arrive above it, and after a press closes the open row | `hooks/view.ts:firstWaiting`, `hooks/view.ts:keptOpen`, `hooks/view.ts:rowAfterClose` | All four looks. omp uses `firstWaiting` and `rowAfterClose` to pick the selected row, and `keptOpen` to keep it when rows arrive above it. |
| Held rows: which closed rows stay in place while the person replies, what their reply sends, and which closed records a prune keeps | `hooks/view.ts:heldReplies`, `hooks/view.ts:inboxView`, `hooks/view.ts:fieldExit`, `hooks/presses.ts:applyPress`, `hooks/ledger.ts:pruneClosed` | All four looks. The mod passes its open field, drafts and discarded replies, and prunes in `hooks/register.tsx:commitLedger`. The omp panel holds its field and drafts in its ui state and passes them with each screen and press. The Codex tab sends its replies and discarded replies with each view and press. The Codex server saves those replies' rows as `heldRows`, and `codex/src/state.ts:updateState` keeps their closed records when it prunes each write. Each view or press replaces `heldRows`, since Codex shows one tab per thread, as `tabSeenAt` also assumes. |
| Feedback text | `hooks/view.ts:feedbackText`, `hooks/view.ts:feedbackOf` | Terminal and desktop through the pane, Codex through the tab, omp through the panel |
| Done labels | `hooks/view.ts:DONE_LABELS` | All four looks |
| Row content and reply intent | `hooks/view.ts:RowView`, `hooks/view.ts:rowMark`, `hooks/view.ts:replyHint`, `hooks/view.ts:rowFeedbackText` | All four looks |
| Action order, emphasis and icon kind | `hooks/view.ts:ActionView`, `hooks/view.ts:actionsOf`, `hooks/view.ts:rowKeyPlan` | All four looks |
| Shared labels and fold counts | `hooks/view.ts:ROW_COPY`, `hooks/view.ts:actionLabel`, `hooks/view.ts:foldLabel`, `hooks/view.ts:earlierLabel`, `hooks/view.ts:groupEmptyText`, `hooks/view.ts:DEMO_NOTICE` | All four looks |
| Key plan | `hooks/view.ts:rowKeyPlan` | All four looks take the order. Terminal and omp draw the key letters. Desktop and Codex draw labels only, and Codex still binds the letters. omp calls it with `isAllShown` true. |
| Press reducer and effects | `hooks/presses.ts:applyPress`, `hooks/presses.ts:runLocalEffects`, `hooks/presses.ts:runSends` | The mod, the Codex server and `hooks/session-host.ts:press` for omp |
| Settle window | `hooks/view.ts:SETTLED_MS`, `hooks/view.ts:settleWindowMs` | The mod and omp pass `SETTLED_MS`. Codex passes `codex/src/settle.ts:SETTLE_WINDOW_MS`. |
| Closed fold size | `hooks/view.ts:CLOSED_SHOWN`, `hooks/view.ts:closedShown` | All four looks. |
| Options fold size | `hooks/view.ts:OPTIONS_FOLD_AT` | The terminal, desktop and Codex looks through `actionsOf`. omp shows every option. |
| New rows, empty tabs and where a look moves | `hooks/arrivals.ts:recordRows`, `hooks/arrivals.ts:isTabEmpty`, `hooks/arrivals.ts:followTo` | The pane, the Codex tab and the omp panel, in `omp/src/panel.ts:followRows`. |
| Stop texts | `hooks/view.ts:stopText`, `hooks/view.ts:stopFix`, `hooks/view.ts:RESUME_TEXT` | The mod and omp. Codex shows no stops. |
| Press guard | `hooks/view.ts:PRESS_GUARD_MS` | The terminal, desktop and Codex looks. omp takes keys only and has no guard. |
| Row padding | `hooks/layout.ts:ROW_PAD_PT` | Desktop and Codex |
| Demo data | `hooks/demo.ts:demoView` | The mod's `/inbox demo`, `codex/src/demo.ts:demoState` and `omp/src/demo.ts:demoState` |
| Model-read texts | `hooks/model-text.ts:guidanceText`, `hooks/model-text.ts:systemText`, `hooks/model-text.ts:inboxText`, `hooks/model-text.ts:promptNotes`, `hooks/tools.ts:recordDescription` | The mod, Codex and omp, each through its `Host` |
| Saved state shapes and upgrades | `types/index.d.ts:PluginState`, `hooks/ledger.ts:upgradeLedger`, `hooks/presses.ts:upgradeLastActions` | The mod also uses `hooks/register.tsx:upgradeState`. Codex uses `codex/src/state.ts:upgraded`, which gives a state saved without `heldRows` an empty list. omp uses `omp/src/state.ts:upgraded`. |
| PR readiness and prompts | `hooks/prs.ts:readiness`, `hooks/prs.ts:prompts` | The mod, the Codex tab and the omp panel |
| Tracked-PR help steps | `hooks/pr-tab.ts:itemPrSteps` | Every host, in views and press validation |
| Exchange application and activity | `hooks/ledger.ts:applyExchangeUpdate`, `hooks/model-text.ts:addActivity` | Every host; retry scheduling remains with the host |
| Codex worker activity | `hooks/session-host.ts:reconcileUpdateStatus`, `codex/src/core.ts:viewOf` | The Codex server checks ownership before clearing abandoned activity. Pending exchanges alone do not imply an active worker. |
| Claude Done notifications | `hooks/register.tsx:wakeForDone`, `hooks/register.tsx:recordDoneRefusal`, `hooks/presses.ts:refuseDoneNotification` | Persist the notification identity before submission. An explicit refusal keeps the task Done, records the reason and restores Undo. Session switches preserve the result in its original session. Refused attempts are not sent again automatically. |
| Codex Done notifications | `hooks/session-host.ts:wakeForDone`, shared delivery reducers in `hooks/presses.ts` | Checkpoint each batch before queue submission. Unknown outcomes remain unconfirmed in settled rows and Closed folds, without an automatic resend. |
| Undo result | `hooks/presses.ts:applyPress`, `hooks/pr-tab.ts:applyPrPress` | Every host clears its closed-note acknowledgement when the result names an actual reopen |
| Arrival acknowledgement | `hooks/presses.ts:withArrival` | Every host; one bulk press can affect several rows |
| PR presses, which PRs the tab draws, and how a PR is fetched | `hooks/pr-tab.ts:applyPrPress`, `hooks/pr-tab.ts:drawnPrs`, `hooks/pr-tab.ts:fetchTracked` | The mod, the Codex server and omp's host |
| Missing-gh notice text | `hooks/pr-tab.ts:GH_MISSING_TEXT` | All four looks. The mod sets `PrViews.isGhMissing` when `gh --version` cannot start after a failed fetch. The Codex server and omp set their own flag from `hooks/gh.ts:ghFinder`, and look for gh again after a fetch where a gh run ended with code -1. |
| PR button order, labels, emphasis and icon kind | `hooks/pr-tab.ts:threadActions`, `hooks/pr-tab.ts:checkActions`, `hooks/pr-tab.ts:prBlockActions` | All four looks |

Some content and host bookkeeping still have two copies. These are remaining work in `docs/plans/three-looks.md`.

| Rule | Where it is written | Remaining work |
| --- | --- | --- |
| PR block and row composition | `hooks/register.tsx` and `codex/src/tab.tsx` | Both use shared PR rules and button plans, but compose their own content. |
| Host notices and some closed-row composition | `hooks/register.tsx` and `codex/src/tab.tsx` | Share identical decisions while keeping native fitting and decoration local. |
| Local effects and demo presses | `hooks/register.tsx:openPath`, `hooks/register.tsx:runDemoPress`, `hooks/session-host.ts:press`, `codex/src/server.ts:makeServer` | Shared effect descriptions still have host execution and demo wiring. |

A `deliveryId` identifies one local press. Each host keeps a sent-prompt record
before an arrival can change its rows. Arrival events provide message text but
no matching delivery ID, so they consume the oldest matching record. Queued feedback appears only after the message has waited one second.
Unconfirmed feedback has no delay. A newer
identical press reads “Delivery unconfirmed” until a later arrival can confirm
its record. Open rows, settled rows and Closed folds preserve that status
without a success mark.

The mod keeps sent-prompt records in its live plugin state across reloads.
Older state can lack the history needed to distinguish identical messages;
those message texts remain unconfirmed in that session. Unmatched records are
retained because discarding one could make its late arrival acknowledge a newer
press. Exact reconciliation and bounded retention need host queue identity or
queue status that the current arrival APIs do not provide.

## Differences on purpose

A difference is on purpose when a look cannot do something or the product decided it. Anything not listed here is drift.

| Topic | Terminal | Desktop | Codex | Why | Where |
| --- | --- | --- | --- | --- | --- |
| Keys | Button hotkeys work. The key letter is drawn before the label. | Clicks only. Button hotkeys do nothing, and no letter is drawn. | A page `keydown` handler takes the letters. No key text is drawn. | The desktop pane takes no key input. A browser page can, but keys are an extra there. | `hooks/register.tsx:keyedButton`, `codex/src/tab.tsx:KeyButton` |
| Hit areas | Character cells. | A Button takes a click only over its label. A Client region takes clicks over a whole shape. | Normal page hit areas. | The engine draws desktop Buttons label-sized. | `hooks/row-client.tsx:RowProps`, `hooks/tabs-client.tsx:TabsProps` |
| Motion and bars | Undo's fill drains by cells until the row leaves. A just-closed row without Undo shows a bar that shrinks by half cells. New rows have no bar. No animation. | Undo's fill drains while it lasts. No leave bar and no animation. New rows have no bar. | Rows enter, move and exit. New rows have no bar. | The pane has no opacity, transform or CSS. | `hooks/register.tsx:leaveBar`, `hooks/undo-client.tsx`, `codex/src/rows.ts:stepRow` |
| Scroll after a close with Undo | Inline panes reveal Undo beside the next selected row. If both do not fit, Undo takes priority until it expires. Manual scrolling cancels the expiry reveal. Selecting another row redirects it to that row. Docked panes retain their normal scroll. | Reveals the selected row with the least scrolling. | Reveals the selected row with the least scrolling, then checks again after its animation. | An inline terminal pane has a short window and a time-limited recovery action. | `hooks/register.tsx:openAfterClose`, `codex/src/tab.tsx:revealSelected` |
| Redraw and polling | Redraws in steps while a row leaves. | Redraws once when a row leaves. A timer redraw loop made clicks fail. | The tab polls the server every 3 seconds. | Only the mod gets pushed events. | `hooks/register.tsx:redrawWhileLeaving`, `codex/src/settle.ts:POLL_MS` |
| Hot reload | Mod handlers reload. | Same as terminal. | The handler reloads. The tab stages a candidate before replacing its root, style and script. Failed startup keeps the working page; successful replacement waits for active presses. The loader needs Codex restarted. | Each instance owns its timers, listeners and animations. Staging preserves the working UI and host state until the candidate can take over. | `codex/src/server-main.ts:load`, `codex/src/server-handler.ts:createHandler`, `codex/src/tab.tsx:swapPage`, `codex/src/tab.tsx:dispose` |
| Storage | Engine atoms hold the live session. The engine store keeps a saved ledger per session. | Same as terminal. | One JSON file per session, under a lock. | Codex has no engine store. Its hooks run as separate short-lived processes beside the server. | `hooks/register.tsx:save`, `codex/src/state.ts:withLock` |
| How a press sends, opens and copies | Sends with the engine's prompt submit. Opens and copies in process. | Same as terminal. | Sends with `codex queue` from the server. Opens in the server. The tab copies. | Codex's server cannot reach the page's clipboard. | `hooks/presses.ts:EffectHost`, `hooks/session-host.ts:press`, `codex/src/server.ts:makeServer` |
| Band, stop and dialog rows | Yes. | Yes. | No. | Codex has no line above its prompt. | `hooks/view.ts:TABS`, `hooks/view.ts:ROW_TABS` |
| PR data | The mod runs gh through the engine, on a timer while the person is around. | Same as terminal. | The server runs gh through `deps.exec` in the session's folder, and refetches on a view when the last fetch is over 2 minutes old. It tries `gh`, then the Homebrew folders. | The ChatGPT app may start the Codex server without Homebrew on its PATH. A Claude Code session, in the terminal or the Claude app, gets the login shell's PATH. | `hooks/register.tsx:fetchPrsNow`, `hooks/session-host.ts:fetchPrs`, `hooks/gh.ts:ghFinder` |
| Settle window | A row stays in place for `SETTLED_MS` from the close. | Same as terminal. | The server lists a row as settled for `SETTLED_MS` plus two polls from the close. The tab draws it in place for `SETTLED_MS` from the first poll that lists it. | The tab only learns of a close at its next poll. | `codex/src/settle.ts:SETTLE_WINDOW_MS`, `codex/src/settle.ts:drawnSettled` |
| Failed per-reply update | Shows failure after work stops, advances applied turns and catches up after the next message. | Same as terminal. | Retains the first failed exchange for the next Stop. An active retry shows Updating. A second failure drops the exchange. | Both hosts end hand-offs after a reply. Their recovery events and retry schedules differ. | `hooks/register.tsx:queueUpdate`, `hooks/session-host.ts:runUpdates`, `codex/src/core.ts:viewOf` |
| Primary buttons | None. A plain terminal Button ignores `variant`. The recommended option ends "(recommended)". | The recommended option, Done, Fix or Do it. On the PRs tab, Address, Fix, or a PR's first move. | Same as desktop. | `docs/plans/inbox-ui.md` says the desktop pane makes the recommended option, or else Done, Fix or Do it, the primary button. | `hooks/register.tsx:keyedButton`, `codex/src/tab.tsx:KeyButton` |
| Reply control | A labeled action with its key. | A follow-up in a Client region. | A normal button. | Desktop native Buttons fill and pad only their labels. The Client keeps the follow-up's hit area and spacing with the other links. The shared action keeps normal emphasis and its place in the order. | `hooks/links-client.tsx:LinksProps`, `codex/src/row-actions.tsx:ActionButton` |
| Reply focus | The reply field receives typing. | On desktop 2.42304.0 with engine 2.1.299, the first Reply click leaves typing in the chat composer even when it is empty. Clicking the field enables typing and preserves the composer draft. | The reply field receives typing after Reply. Built-page and native MCP-panel checks pass. | The desktop host reports successful `ui.focus` without transferring typing to its Input. See the verified limits in `docs/reference/claude-desktop-app.md`. | `hooks/register.tsx:focusField`, `codex/src/tab.tsx:draw` |
| Finding path display | The file name, in Claude Code's inline-code color. | Same as terminal. The pane has no font props. | The file name in the mono font, on a soft chip. The full path shows on hover. | The full path is long and shows a private folder. | `hooks/register.tsx:findingRow`, `codex/src/tab.tsx:findingRow` |
| Clipping | Inline bodies fit parsed display spans to a line budget. They retain their planned breaks, inline styles, link addresses and explicit newlines. | The adapter clips with a measured characters-per-cell estimate. | CSS wraps and truncates. | Shared text is never pre-shortened. Each adapter fits content to its own drawing. | `hooks/register.tsx:terminalTextLines`, `hooks/register.tsx:rowClientProps`, `hooks/register.tsx:DESKTOP_CLIP_CHARS_PER_CELL` |
| Long button labels | The host's Button draws a label on one line and cuts it with an ellipsis when it does not fit. | Same as terminal, inside the pill. | The label wraps inside the button, which becomes a rounded rectangle. | Terminal and desktop Buttons are drawn by the host on one line. The Codex tab can wrap, so the whole answer stays readable. | `hooks/register.tsx:keyedButton`, `codex/src/row-actions.tsx:ActionButton` |
| Row age | Side column. | A reserved side column keeps the age at narrow widths too. | Side column, at least as wide as "Sending…", which shows there while a press is out. | Each native drawing fits the same age in its own row. Codex reserves the width so a press does not wrap the title. | `hooks/register.tsx:rowClientProps`, `hooks/register.tsx:sideAge` |
| Row feedback while collapsed | Stays on the title line, after the title. | Same as terminal. | Feedback that has an age moves to the side column, before the age, cut at 11em. The full text shows when the row opens. | A collapsed Codex row stays one line, so the list scans fast. | `hooks/register.tsx:pressedAge`, `hooks/register.tsx:listRow`, `codex/src/tab.tsx:ListRow`, `codex/src/tab.html:.side-label` |
| Colors | Host palette with shared status tones. | Native theme keys and shared SVG status tones. | Host style variables and shared status tones in CSS. | Each look uses its host's theme and drawing primitives. | `hooks/register.tsx:paletteFor`, `hooks/tones.ts:toneColors`, `codex/src/tab.tsx:applyHost` |
| `/inbox` at startup | Registers before the first prompt. | The first `/inbox demo` opens the sample pane without an agent turn. The host can still show a stale unknown-command warning. | No command. The Inbox tab opens at any time. | Registration runs during `session.start`; a command waits for Inbox initialization. The remaining warning belongs to the desktop host. | `hooks/register.tsx:registerInboxCommand`, `hooks/register.tsx:ensureOn` |
| `/inbox` during a turn | Runs at once. | Waits until the turn ends. | No command. The Inbox tab opens at any time. | The command is registered `immediate`. The desktop app sends a typed command through Claude Code's prompt queue, which holds it until the turn ends whatever `immediate` says, as checked in Claude Code 2.1.296. | `hooks/register.tsx:registerInboxCommand` |
| Tab placement | Inline when the pane body is at least 80 columns wide, a column at the pane's left beside the rows. Docked or narrower, a row above them. | A row above the rows. | A row above the rows. | Inline, a row of tabs lines up with the group titles under it and reads as one more title. Docked tabs have their own fill and line. A pane body narrower than 80 columns leaves the rows too little room beside a tab column. | `hooks/register.tsx:INLINE_RAIL_AT` |
| Tab counts | Always drawn. Tabs that don't fit wrap to a second line. | Dropped when the tabs with counts don't fit on one line, below about 38 columns. | Always drawn. | The desktop tabs are one Client region of fixed height, so they cannot wrap. | `hooks/register.tsx:desktopTabSizes` |
| Demo for a recording | `/inbox demo recording` shows the demo without its notice line, its "Demo:" prefix, Hide demo and its sample notes. | Same as terminal. | A build made with `INBOX_DEMO_RECORDING=1` shows Show demo, and its demo leaves out the notice line and the sample notes. | Codex has no command, and its demo is reachable only from Show demo, which a release build leaves out. | `hooks/register.tsx:setDemo`, `codex/build.mjs:isDemoRecording` |
| Look for mobile and VS Code | Used. | Not used. | Not used. | The engine's `surface` can be `mobile` or `vscode`, which nobody has checked. They get the terminal look. | `hooks/register.tsx:lookOf` |

### omp

omp draws the terminal's text and handles, with its own keys and a panel it owns. This table compares omp with the terminal look. The other columns of the table above do not apply to it.

| Topic | omp | Why | Where |
| --- | --- | --- | --- |
| Options fold | Every option shows, and there is no "All options" button. | The panel moves focus between buttons with the arrow keys, so a row with many options stays reachable. | `omp/src/panel.ts:rowButtons`, `hooks/view.ts:rowKeyPlan` |
| Reply key | `r` opens the reply field. The shared plan gives Reply `t`. | The product chose `r`, which reads as Reply. | `omp/src/panel.ts:REPLY_KEY` |
| Pressing a button | A row opens with its recommended option focused. Enter presses the focused button, and ← and → move focus between a row's buttons. A button's key letter also presses it. Enter on a Closed line unfolds or folds it. | omp gives an overlay raw keys, so the panel keeps its own focus. | `omp/src/panel.ts:handleKey`, `omp/src/panel.ts:defaultFocus` |
| Wrap-around | ← and → wrap at a row's first and last button. ↑ and ↓, and `j` and `k`, wrap from the last row to the first. | The panel takes keys only, so wrapping saves presses. | `omp/src/panel.ts:handleKey` |
| Switching tabs | Tab and Shift+Tab move between tabs, wrapping at either end, and `1`, `2` and `3` pick one. The terminal switches tabs only with `1`, `2` and `3`. | The overlay owns every key, so Tab is free to switch tabs. | `omp/src/panel.ts:handleKey` |
| Keys with no terminal equivalent | `u` undoes the most recent closed row. Escape closes the panel, or leaves a reply field. Enter presses the focused button, or sends a reply. ↑ and ↓ move between rows, as do `k` and `j`. | The terminal has Undo only as a button, and its pane has no raw keys. The overlay takes keys only, so each action needs one. | `omp/src/panel.ts:handleKey` |
| Separators and bullets | The `·` between counts and hints, and task bullets, use omp's `statusLineSep` theme color. The accent uses omp's `accent`. Status tones follow `hooks/tones.ts`. | They match omp's own status line, and follow the person's omp theme. | `omp/src/host.ts:styleOf` |
| Panel and band | `/inbox` opens an overlay that replaces the band while it shows. The band reads "Nothing needs you" when nothing waits, and it names `/inbox` as the way to open the panel. | omp has no side pane or button above the prompt. | `omp/src/host.ts:openPanelUi`, `omp/src/panel.ts:bandLines` |
| Press guard | None. | `PRESS_GUARD_MS` guards a click that lands as a row opens. The panel takes keys only. | `hooks/view.ts:PRESS_GUARD_MS` |
| Stop rows | The band shows the stop and its fix under the counts, and takes no key. Resume is a button on the stop row in the panel. A stop is a sign-in, usage-limit or API-error stop, never a billing stop, and a usage-limit stop names no reset time. It clears when the next turn starts. | omp's band cannot take keys. omp reports a failed request's HTTP status and message, and the inbox classes the stop from those with omp's own usage-limit rule. The mod reads Claude Code's error words, which name billing and the reset time. | `omp/src/host.ts:stopOf`, `omp/src/panel.ts:stopEntries`, `omp/src/panel.ts:bandLines` |
| Inbox model | A Sonnet model from the person's providers, `anthropic` first, else omp's `@smol` role. The panel footer names it, or says "no inbox model". | omp's providers come from each person's setup, so the inbox cannot assume one. | `omp/src/host.ts:inboxModel`, `omp/src/panel.ts:footer` |
| Sessions with no screen | A subagent, and a session run without a UI such as print mode, get no inbox. The `record` and `close` tools answer "The inbox is not shown in this session." | Nobody looks at those sessions. omp 18.1.17 gives an extension no field for the agent kind, and starts a subagent with no UI. | `omp/src/host.ts:isUnattended` |
| Storage | One JSON file per session under omp's agent folder, in `inbox/sessions/`, with a lock held in the process. | A file of its own keeps state out of the session file, which the agent reads back. | `omp/src/state.ts:statePath`, `omp/src/state.ts:updateState` |
| How a press sends, opens and copies | Sends with `sendUserMessage`, which queues as a follow-up while a turn runs. Opens with `open` and copies with the system clipboard command, both in omp's process. | omp's extension API sends and runs commands in process. | `omp/src/host.ts:createInbox`, `omp/src/commands.ts:openTarget` |
| Install | The marketplace copies only `omp/`, so the extension is a bundle with the shared modules inside. | An omp plugin cannot import `../hooks` once installed. | `omp/build.ts`, `.omp-plugin/marketplace.json` |

A refused Done notification stays visible in its task's Closed entry as
"Done · Not sent: …", with Undo. The shared view decides whether recovery is
available. Terminal and Codex use buttons; desktop reuses its Undo Client
without a countdown so the first click reaches the action. The optional
`Closed.doneNotification` field records the attempt ID and refusal reason.
Every host's existing ledger upgrades preserve it; old records need no default.

Finding details preserve explicit newlines in all four looks. The Codex
adapter uses `pre-line` whitespace for the detail paragraph; its ordinary
spacing and inline formatting stay intact.

## Adding a host

A host is a program that runs the inbox's agent: it reacts to events, keeps state, runs the inbox model and the presses. It supplies a `SessionHost`, calls the shared session functions on its events, and draws a look. `omp/` is the example, and `docs/plans/omp-look.md` records how it was built.

### What a host supplies

`SessionHost` in `hooks/session-host.ts` is everything a host provides to run one session. Each shared function takes only the members it uses.

| Member | What the host does |
| --- | --- |
| `now` | The clock. |
| `read`, `update` | Read the session, and change it under a lock. `update` takes a `checkpoint` to save a state before an external effect. |
| `exclusive` | Runs the per-reply update unless another run holds the session. |
| `ask` | Calls the inbox model with the prompt `buildPrompt` writes. Null when it fails. |
| `deliver` | Sends a message to the agent as if the person typed it. |
| `prepare` | Throws when `deliver` could not start, before a sent record is saved. |
| `perform` | Opens a link or path, or copies text. Returns why it could not, or null. |
| `gh` | Finds gh, drops the one it kept, runs gh for the session, and reports when none starts. |
| `settleWindowMs`, `newId` | The settle window before Done tells the agent, and delivery ids. |

The host's state type extends `Session` from `hooks/session.ts`. It adds its own fields, and upgrades a state saved by an earlier build, as `omp/src/state.ts:upgraded` does.

### What a host calls on each event

| Event | Shared function |
| --- | --- |
| Session start or resume | `hooks/session.ts:startContext` gives the guidance and carried items. `hooks/session.ts:cleared` empties a session after a clear. |
| A prompt reaches the agent | `hooks/session.ts:notePrompt` records it, matches a press's message, and returns the notes to add beside the prompt. |
| The agent uses a tool | `hooks/model-text.ts:toolActivity` and `hooks/session.ts:noteActivity` add a line of turn activity. |
| The agent calls `record` or `close` | `hooks/session.ts:recorded`, with the answer from `hooks/tools.ts`. |
| A turn ends | `hooks/session.ts:endTurn` queues the exchange. Then `hooks/session-host.ts:runUpdates` runs the inbox model, and `hooks/session-host.ts:wakeForDone` tells the agent about rows closed with Done. |
| The person presses a button | `hooks/session-host.ts:press` applies it, saves a sent record before delivery, delivers, and runs local effects. |
| The PRs tab opens | `hooks/session-host.ts:fetchPrs` fetches through the host's gh. |
| A look draws | `hooks/session.ts:sessionView` builds the view. |

### The Host names

`Host` in `hooks/model-text.ts` names the agent, the surface the person sees, the band if there is one, where findings show, and the tools the agent calls, `recordTool` and `closeTool`. Its `intro` is the first paragraph of `guidanceText`. omp's is `omp/src/texts.ts:OMP`, and its tools are `record` and `close`. The Claude Code mod's are `mcp__inbox__record` and `mcp__inbox__close`, since an MCP server's name prefixes its tools.

### Files to add

| Add | In omp |
| --- | --- |
| The host, the only file that imports the agent's packages | `omp/src/host.ts` |
| State storage | `omp/src/state.ts` |
| The `Host` names | `omp/src/texts.ts` |
| The look's drawing, which imports only shared modules | `omp/src/panel.ts`, `omp/src/controller.ts` |
| A demo source | `omp/src/demo.ts` |
| Tests: the shared session script, the panel, the state and the host's events | `omp/tests/` |
| A bundle, when the agent installs a plugin by copying only its folder | `omp/build.ts`, `omp/dist/host.js` |
| The plugin's manifest and marketplace entry | `omp/package.json`, `.omp-plugin/marketplace.json` |

### Where else to register a host

1. `Look` in `hooks/view.ts` gains the new value. Name the places that branch on it, as `isTerminalLike` does for the terminal's handles.
2. `scripts/check-structure.mjs` checks the host's imports. omp's rule is that its files import only shared modules, and that one file imports the agent's packages.
3. `scripts/check.sh` runs the host's bundle check, type check and tests.
4. `evals/agent.ts` gains the agent, with a stand-in for the inbox that uses the real tool descriptions, as `evals/omp-probe.ts` does for omp. `scripts/eval.sh` passes it through.
5. The tests run `tests/session-script.ts` against the host's `SessionHost`, as `omp/tests/session.spec.ts` does. The script drives a prompt, a `record` call, a turn end, the inbox model's answer, a press that sends, its arrival, Done and Undo. It calls the shared functions directly, so the host's event wiring needs its own tests.
6. The docs rows: this file's Files table, owners table, Differences on purpose and "After you change X"; `GLOSSARY.md`; `AGENTS.md`; the README's install steps; and `docs/release.md` for the version field and the build.

## After you change X, check Y

State in your change, for each look, whether it applies and what you checked.

| Change | Edit | Then check |
| --- | --- | --- |
| A row action | `hooks/view.ts:actionsOf`, `hooks/presses.ts:applyPress`, and `hooks/view.ts:DONE_LABELS` for its label | The action appears in terminal, desktop, the Codex tab and the omp panel. Check Undo, failure and key letters. Add the case to `tests/hooks.test.ts`, `codex/tests/press.spec.ts` and `omp/tests/panel.spec.ts` when the repo's coverage expects it. |
| A row field | `hooks/view.ts:inboxView` and the `RowView` type, then `itemRow` and `findingRow` in the mod and Codex adapters, and `omp/src/panel.ts` | Every adapter draws the shared field. Check resting, reply, handed-off, settled and failed forms that use it. |
| A word on screen | The shared string in `hooks/view.ts` or `hooks/presses.ts`, else every adapter | Run the change through the `refine-prose` skill. Check each look for clipping. |
| Model-read text | `hooks/model-text.ts` or `hooks/tools.ts`. The guidance and every `inbox:` text reach every agent. | A/B test it as `AGENTS.md` says, with Sonnet for Claude and with `codex exec` and the model in `codex/src/update.ts:MODEL` for Codex. Run `./scripts/eval.sh --suite agent --agent omp` for omp. |
| A saved field | `types/index.d.ts:PluginState`, then `hooks/ledger.ts:upgradeLedger` or `hooks/register.tsx:upgradeState`, `codex/src/state.ts:upgraded` and `omp/src/state.ts:upgraded` | Load a state saved by the old build in the mod, in Codex and in omp. |
| A size or timing | `hooks/view.ts` constants or `hooks/layout.ts:ROW_PAD_PT` when the looks share it, else the adapter's own constant | Measure in the terminal, desktop, Codex tab and omp panel. Add a row to Differences on purpose when the values differ. |
| A tab | `hooks/view.ts:TABS` and `hooks/view.ts:ROW_TABS` | The mod pane, the Codex tab, the omp panel, `codex/src/arrivals.ts:TAB_IDS` and the empty text in `hooks/view.ts:emptyText`. |
| A PR feature | `hooks/prs.ts` and `hooks/pr-tab.ts:applyPrPress` | All four looks. Check PR-opening help, bulk arrival and the PRs tab in each, and add the case to `codex/tests/server.spec.ts` or `omp/tests/panel.spec.ts` when the repo's coverage expects it. |
| Anything in `hooks/` that Codex imports | The shared module | Run `npm --prefix codex run build` to rebuild the Codex bundles. `./scripts/check.sh` fails until you do. |
| Anything in `hooks/` that `omp/src/host.ts` imports | The shared module | Run `npm --prefix omp run build` to rebuild `omp/dist/host.js`. `./scripts/check.sh` fails until you do. |
| `omp/src/host.ts` or the omp panel | The omp host or adapter | Run `omp/tests`. Then check live in omp with an isolated `HOME`, as `AGENTS.md` says: the band, `/inbox`, a real press that sends, and the light theme. |
| `codex/src/server-main.ts` | The loader | Quit and reopen Codex. A change to `codex/src/server-handler.ts` or anything it imports reloads without a restart. |

## Checks

`scripts/check-structure.mjs` parses imports and resolves their targets. It follows local import chains, including type bridges. Shared modules retain their shared-only restriction through those chains, and Codex cannot reach nonshared hooks through another local module. It includes build-shared tones and type imports. Shared modules and Codex reject computed targets. The only exception is a direct `import(url)` in the top-level `codex/src/server-main.ts:load` function. Nested functions do not inherit that exception. That function selects installed or dev handler URLs for hot reload.

The script also checks that omp's files import only shared modules, and that only `omp/src/host.ts` imports omp's packages. It checks plan status lines, file references and links. Its owner-symbol check only verifies that a word occurs in the referenced file. It does not establish a definition or semantic freshness.

`codex/tests/structure.spec.ts` checks the command against disposable fixtures. Mounted row-action tests check Codex controls and outcomes. The mod demo test checks terminal and desktop titles and actions, with settled rows and PRs outside that test. Full-page behavior, native painting, clipboard, focus and measured motion still need their own checks.

`omp/tests/session.spec.ts` runs the shared session script from `tests/session-script.ts` against omp's `SessionHost`. `omp/tests/panel.spec.ts` checks that the panel draws buttons in the shared plan order, in place of the demo test in `tests/hooks.test.ts`.

`./scripts/check.sh` runs formatting, plugin validation, structure, the type checks, the test suites, and that the Codex bundles and `omp/dist/host.js` match their sources. Run it after every change. Model evaluations run separately when model-facing text changes.
