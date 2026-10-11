# Working on the inbox mod

- The repo is public. Keep private paths, other people's names and session content out of commits.
- Run `./scripts/check.sh` after every change.
- Test a change to text a model reads before keeping it. Small rewordings change behavior: a one-word edit to the findings rule in `systemText` made the inbox model re-add questions the user had dismissed.
  - Claude reads `GUIDANCE`, the tool descriptions and the tool results in `hooks/register.tsx`, and the `inbox:` texts that `inboxText`, `closedText`, `carryText` and `answerNote` build in `hooks/ledger.ts`.
  - The inbox model, a Sonnet call after each reply, reads `systemText` and the blocks from `buildPrompt` in `hooks/ledger.ts`.
  - To compare two versions, print each one's prompt for the same sample exchange, run each several times with `claude -p --model sonnet --tools "" --system-prompt …`, and count the outcomes.
- Every action in the pane shows what it did as soon as it is pressed. When Discuss showed nothing, a person sent the same message four or five times. Each `Action` declares its `kind`, a `PressKind`. A Talk or Hand-off press leaves a ✓ and its label on the row, as in "✓ Discuss". It stores its action id from `actionId()`, so the same action then reads "… again". A Local press, an open or a copy, shows "Opening x…" on its row, then its result: "✓ Opened x", or in red why it could not. It never reports through a toast. A Mark or View press shows itself, as closing a row or opening the text field does. Every Button's press runs `runPress()`. It applies a row press with `applyPress()` and a PR press with `applyPrPress()`, then records the row's last action, so a click and a key press record the same.
- Saved state outlives the code. Its shape is `PluginState` in `types/index.d.ts`. When a saved shape changes, convert old state in `upgradeLedger` or `upgradeState`.
- In `tests/hooks.test.ts`, `world()` answers every engine event the mod uses, and the test harness takes one handler per event. A test changes an answer through the variables `world()` resets, such as `ledgerReply`, `stopBlock` and `ghAnswers`.
- The plugin store is keyed by the mod's name, so a session that loads a copy under your own config writes to your real inbox's state. Check the UI live in a session with its own `CLAUDE_CONFIG_DIR`. `mods/scripts/live.sh` in petekp/claude-code-setup starts one in tmux.
- To try a change with real model turns, run `claude -p` on a copy of the mod. Patch the copy to turn on, since the mod does nothing under `-p`, and to skip its `$.store` writes, since the run signs in with your own config and would save the trial's sessions to your real inbox.

## UI detail

Each client draws the inbox with its own engine. The terminal and the Claude app pane share `hooks/register.tsx`, and the Codex tab is a web page. Label every UI rule you add with the client it applies to.

- **All clients.** Check every state of what you change, and every move between states, not only the resting forms. Look at frames mid-move. A button must not shift while its press is out, content must not vanish before its space closes, and nothing may flicker. Then look in the real app. Say which states you did not see.
- **All clients.** Sizes the apps share, such as row padding, live in `hooks/layout.ts`. Change them there so the clients do not drift apart.
- **Terminal.** A change to `hooks/register.tsx` for the Claude app can change the terminal pane too. Check it there.
- **Claude app pane.** Before designing for it, read "Drawing limits for desktop design" in `docs/reference/claude-desktop-app.md`. Build only on what it marks verified or stated, and probe anything it marks unknown. A Button there is always native and as small as its label. A custom-drawn control that takes clicks over its whole shape needs a `Client`. The pane has no opacity, transform or CSS, so a row changes form in one draw. The pane redraws only on events, so confirm it shows the new build before trusting a capture.
- **Codex tab.** A row's form and animation come from the state machine in `codex/src/rows.ts`. Add a new move there, as `docs/plans/codex-row-states.md` describes, not as a special case in `codex/src/tab.tsx`. Measure each row's height and position frame by frame in a local page that hosts the built tab, in both themes and with reduced motion. Then check it in the Codex app. The server's handler reloads when its file changes, after a reinstall or while `npm --prefix codex run dev` runs. Only a change to the loader, `codex/src/server-main.ts`, needs Codex quit and reopened.
