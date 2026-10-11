# Working on the inbox

The inbox is drawn in three looks: the Claude Code terminal, the Claude desktop app's pane, and the Codex tab. Before you change the UI or a rule, read [docs/looks.md](docs/looks.md). It says which file owns each rule, where the looks differ on purpose, and what to check after each kind of change. [GLOSSARY.md](GLOSSARY.md) defines the terms.

## Every change

- The repo is public. Keep private paths, other people's names and session content out of commits.
- Run `./scripts/check.sh` after every change.
- Change a rule in the file that owns it, never in one look's drawing code. Shared modules in `hooks/` decide; `hooks/register.tsx` and `codex/src/tab.tsx` only draw. A change to a shared module reaches all three looks, and the Codex bundles must be rebuilt with `npm --prefix codex run build`.
- When you finish a change to a shared module or a look's drawing code, say for each look whether the change applies and what you checked there. A difference between looks that is not in the "Differences on purpose" table in `docs/looks.md` is drift: fix it, or add it to the table with its reason.
- Saved state outlives the code. Its shape is `PluginState` in `types/index.d.ts`. When a saved shape changes, convert old state in `upgradeLedger` or `upgradeState`, and in `upgraded` in `codex/src/state.ts`.

## Text a model reads

Test a change to text a model reads before keeping it. Small rewordings change behavior: a one-word edit to the findings rule in `systemText` made the inbox model re-add questions the user had dismissed.

- Claude reads `GUIDANCE`, the tool descriptions and the tool results in `hooks/register.tsx`, and the `inbox:` texts that `inboxText`, `closedText`, `carryText` and `answerNote` build in `hooks/ledger.ts`.
- Codex reads its own copy of `GUIDANCE` in `codex/src/texts.ts`. The two copies differ only in their first paragraph. Change both together.
- The inbox model reads `systemText` and the blocks from `buildPrompt` in `hooks/ledger.ts`. In the mod it is a Sonnet call after each reply. In Codex it is `codex exec` with the model in `MODEL` in `codex/src/update.ts`.
- To compare two versions, print each one's prompt for the same sample exchange. Run each several times with `claude -p --model sonnet --tools "" --system-prompt …`, and for text Codex reads, with `codex exec` and the Codex model. Count the outcomes.

## Presses

Every action shows what it did as soon as it is pressed. When Discuss showed nothing, a person sent the same message four or five times.

- Each `Action` declares its `kind`, a `PressKind`.
- A Talk or Hand-off press leaves a ✓ and its label on the row, as in "✓ Discussed". It stores its action id from `actionId()`, so the same action then reads "… again".
- A Local press, an open or a copy, shows "Opening x…" on its row, then its result: "✓ Opened x", or in red why it could not. It never reports through a toast.
- A Mark or View press shows itself, as closing a row or opening the text field does.
- Every Button's press runs `runPress()`. It applies a row press with `applyPress()` and a PR press with `applyPrPress()`, then records the row's last action, so a click and a key press record the same.

## Tests and live checks

- In `tests/hooks.test.ts`, `world()` answers every engine event the mod uses, and the test harness takes one handler per event. A test changes an answer through the variables `world()` resets, such as `ledgerReply`, `stopBlock` and `ghAnswers`.
- The plugin store is keyed by the mod's name, so a session that loads a copy under your own config writes to your real inbox's state. Check the UI live in a session with its own `CLAUDE_CONFIG_DIR`. `mods/scripts/live.sh` in petekp/claude-code-setup starts one in tmux.
- To try a change with real model turns, run `claude -p` on a copy of the mod. Patch the copy to turn on, since the mod does nothing under `-p`, and to skip its `$.store` writes, since the run signs in with your own config and would save the trial's sessions to your real inbox.

## Drawing in each look

- **Every look.** Check every state of what you change, and every move between states, not only the resting forms. Look at frames mid-move. A button must not shift while its press is out, content must not vanish before its space closes, and nothing may flicker. Then look in the real app. Say which states you did not see.
- **Every look.** Sizes the desktop pane and the Codex tab share, such as row padding, live in `hooks/layout.ts`. Change them there so the looks do not drift apart.
- **Terminal.** The terminal and desktop looks share `hooks/register.tsx`, so a change there for the desktop app can change the terminal too. Check it there.
- **Desktop.** Before designing for the Claude app's pane, read "Drawing limits for desktop design" in `docs/reference/claude-desktop-app.md`. Build only on what it marks verified or stated, and probe anything it marks unknown. A Button there is always native and as small as its label, and its hotkey does nothing. A custom-drawn control that takes clicks over its whole shape needs a `Client`. The pane has no opacity, transform or CSS, so a row changes form in one draw. The pane redraws only on events, so confirm it shows the new build before trusting a capture.
- **Codex tab.** A row's form and animation come from the state machine in `codex/src/rows.ts`. Add a new move there, as `docs/plans/codex-row-states.md` describes, not as a special case in `codex/src/tab.tsx`. Measure each row's height and position frame by frame in a local page that hosts the built tab, in both themes and with reduced motion. Then check it in the Codex app. The server's handler reloads when its file changes, after a reinstall or while `npm --prefix codex run dev` runs, and an open tab then replaces its page with the new one. Only a change to the loader, `codex/src/server-main.ts`, needs Codex quit and reopened.
