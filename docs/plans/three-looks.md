# One inbox in three looks

Status: building. Steps 1 to 4 are done. In step 5, the guidance and start title are built once; the ledger split is not done. Terms follow `GLOSSARY.md`.

Agents build and maintain this product, so the code itself has to tell them two things. First, which rules every look shares, and where each one lives. Second, where the looks differ on purpose, and why. Today the core rules are shared. The rules around that core are copied per look, and nothing says which copies must match. This plan makes each rule live in one place, writes down every deliberate difference next to the code, and adds checks that fail when a look drifts.

## Terms

- **Look**: one of the three ways the inbox is drawn: `terminal` is the Claude Code terminal, `desktop` is the pane in the Claude desktop app's Code mode, and `codex` is the Codex tab. The engine's own `surface` is a different thing: where Claude Code runs.
- **Host**: the program that runs the inbox code. The mod draws the terminal and desktop looks. The Codex plugin runs the Codex tab.
- **Shared module**: a file in `hooks/` that both hosts import: `view.ts`, `presses.ts`, `arrivals.ts`, `ledger.ts`, `prs.ts`, `tools.ts`, `demo.ts`, `layout.ts`. It imports nothing from the engine or from either host.
- **Adapter**: the code that draws the shared view in one look. `hooks/register.tsx` draws the terminal and desktop looks. `codex/src/tab.tsx` draws the Codex tab.
- **Difference on purpose**: a behavior that differs between looks because one look cannot do something, or because the product decided so. Every other difference is drift.

## The drift this plan fixes

What is already shared, in one place:

- `hooks/view.ts` owns the Needs you order and count, question handles, row state, feedback, done labels and action order.
- `hooks/presses.ts` owns the press reducer and its effects: `applyPress`, `runSends` and `runLocalEffects`.
- The key plan, the timing constants, the new-row rule `followTo` and the shared row padding.
- The model-read texts built from `Host`: `systemText`, `inboxText`, `promptNotes`, `findingDescription`.
- No shared module imports host code at run time.

What drifts, with the evidence the review found:

1. **The model-read `GUIDANCE` text is a hand copy.** `hooks/register.tsx` and `codex/src/texts.ts` each hold one copy, and only the first paragraph differs. `START_TITLE` is copied the same way. `AGENTS.md` names only the Claude copy, so an A/B-tested edit reaches one agent.
2. **Each adapter builds its own row content from `RowView`.** `itemRow` and `findingRow` exist in both `register.tsx` and `tab.tsx`, and they decide the same things: the handed-off ✓, the second line, the finding head, the text-field hint and the file line. They already differ:
   - The Codex tab shows a finding's raw path. The pane shows it relative to the repo.
   - The Codex tab makes only the recommended option primary. The pane also makes Done and Address primary, as `inbox-ui.md` specifies.
   - The double ✓ is avoided by checking the glyph in the pane and the tone in the tab.
   - The pane recomputes feedback in the renderer instead of reading `RowView.feedback`.
3. **Copy is repeated in each adapter.** This covers the status line, "No open findings.", the demo banner, "N Closed", "Undo", "Try again", "All N options", Send and Cancel, the group titles, and the group count rule.
4. **The empty-tab rule and the default open row are written twice, with different inputs.** `followNewRows` in the mod and `isShownEmpty` in Codex read different inputs. Their results agree today, because a row drawn as settled already keeps its tab from being empty. A change to one would not reach the other.
5. **The per-reply update is written twice.**
   - Both copies exclude the explained row and cap activity at 40.
   - The mod keeps `turnsApplied` when an update fails. Codex advances it, because Codex has no catch-up. That difference is on purpose, but only a Codex comment says so.
   - Undo's `told.closed` cleanup, the open effect and the demo press are also written once per host.
6. **`hooks/ledger.ts` mixes three things.**
   - Shared model-read text.
   - Claude-only code that imports a `claude-code` type: the stop text, dialog and command rows, and the transcript.
   - The UI helpers `ago` and `isLapsed`, which the A/B rule then wrongly covers.
   
   Because of that type import, the Codex type check needs files only an interactive Claude session writes.
7. **Claude-only PR logic sits inside `register.tsx`.** It holds `applyPrPress`, a pure reducer of about 240 lines, and `prRetryOf`, `PR_STATUSES` and the row ids. Its labels and ids also leak into shared files without saying Codex has no PRs.
8. **Names collide.** `Look` is `'terminal' | 'desktop' | 'html'` in `view.ts`, and an animation frame in `tab.tsx`. "Client" means a look in the docs and an engine hover region in the code. Nothing defines look or host.
9. **Docs mislead.**
   - No file says "to change X, touch these files in every look".
   - About ten finished plans read as current instructions. `target-architecture.md` is 857 lines, has no status line, and lists deleted files.
   - Thirty-five references point to `docs/plans/clients.md`, which does not exist.
   - `codex/README.md` says the desktop tab is untried, and `codex-tab.md` contradicts the shipped keys.
10. **No check catches drift.**
    - Nothing checks import boundaries.
    - No test runs one scenario on both hosts. Each runner re-writes the same cases by hand.
    - No test draws the Codex tab.
    - A shared change can remove an action from one look and every check stays green.

## Target

Each rule has one owner. Adapters only map a shared description to their own widgets. Each difference on purpose is a named value with its reason, and one map lists all of them.

- **Shared modules decide; adapters draw.** If a rule decides what a row says, which action leads, when a tab counts as empty, or what text appears, it lives in a shared module. An adapter decides only how its look draws that: a glyph or an SVG, a column width, a clip point, motion.
- **Differences are values, not branches.** A difference on purpose is a field or parameter with a name, such as `advancesOnFailure` or a look's traits. It is never an unexplained ternary in an adapter.
- **One map, checked against the code.** `docs/looks.md` lists who owns each rule, each difference on purpose with its reason, and what to check in each look after a change. Every `file:symbol` it cites is checked to exist, so the map cannot quietly go stale.
- **Checks pin the boundaries.** An import check keeps shared modules pure. A test written once runs on both hosts. A drawing test confirms that every row and action in the demo reaches all three looks.

## Build steps

Each step is one commit on `revamp-build`. Each passes `./scripts/check.sh` and is checked on the looks it touches before the next starts. A step that changes `hooks/` or `codex/src` also rebuilds the Codex bundles with the clean-worktree flow, because the main working copy holds another session's uncommitted bundle changes.

The checks come first, so they guard the code moves that follow. Steps 1 to 4 change no behavior. Each behavior change is listed under the step that makes it.

Another session has uncommitted edits in `docs/plans/row-actions.md`, `docs/plans/codex-tab.md` and `codex/src/tab.html`. This plan leaves those files alone until that work lands. Their cleanup is listed in step 3 as waiting.

### 1. Names

- Add Look, Host, Shared module, Adapter and Difference on purpose to `GLOSSARY.md`.
  - A look is one of the three ways the inbox is drawn: `terminal`, `desktop` and `codex`.
  - The engine's `surface` is a different thing. It names where Claude Code runs, and includes `mobile` and `vscode`.
  - The engine's `Client` is a hover region, not a look.
- Rename the `'html'` look in `hooks/view.ts` to `'codex'`. Rename the animation type in `tab.tsx`, also called `Look`, to `Frame`.
- Add `lookOf(surface)` in `register.tsx` for the three places that pick a look from the engine's surface. Its comment says why mobile and VS Code get the terminal look.

### 2. Checks that pin today's boundaries

- Add `scripts/check-structure.mjs`, run by `check.sh`. No existing check reads imports or docs, so a new script is the smallest way to add these checks. It fails when:
  - a shared module imports the engine, `register.tsx`, a `*-client.tsx` file or `codex/`. Until step 5, a type-only engine import is allowed;
  - `codex/src` imports a `hooks/` file outside the shared module list;
  - a plan in `docs/plans/` has no status line from the fixed set: proposed, building, built, or superseded by another plan;
  - a relative link or a backticked repo path in `docs/`, `README.md`, `AGENTS.md` or `codex/README.md` names a missing file;
  - a `file:symbol` in `docs/looks.md` names a file without that symbol.
- Its first failures are the to-do list for step 3.
- Make `feedbackText` and the other switches over shared unions exhaustive with a `never` check. A new variant then fails the type check in every look that must handle it.

### 3. The map and the docs

- Write `docs/looks.md` with three tables:
  - **Owners**: concept, the owning `file:symbol`, and the looks that read it.
  - **Differences on purpose**: concept, terminal, desktop, Codex, the reason, and `file:symbol`. Rows: keys, hit areas, motion, redraw and polling, hot reload, storage, how a press sends, opens and copies, band and PRs, the settle window, failed updates, primary buttons on the terminal, and clipping.
  - **After a change to X, check Y**: one row per change type. The types are a row action, a row field, model-read text, a saved field, a size or timing, a tab, and a PR feature. Each row names the shared file, each adapter, the tests and what to rebuild.
- Rewrite `AGENTS.md` as a short entry point:
  - It links to the map and the glossary first.
  - It keeps the rules that hold everywhere.
  - It names both `GUIDANCE` copies until step 5 removes one.
  - Its model-read text rule adds the Codex model. The Codex model, `MODEL` in `codex/src/update.ts`, reads `systemText` through `codex exec`, and the Sonnet recipe does not cover it. An A/B run for a change to that text also runs `codex exec` with that model on the same sample.
  - It adds one rule: a change to a shared module or an adapter states, for each look, whether it applies and what was checked.
- Add header comments where a file does not say what it owns: `register.tsx`, `ledger.ts`, `prs.ts`, `server-main.ts` and `server-handler.ts`. The `register.tsx` header includes a section index.
- Clean up the docs:
  - Archive finished plans to `docs/archive/` with a dated banner.
  - Give every remaining plan a status line.
  - Remove the `clients.md` references.
  - Fix `codex/README.md`.
  - Move the misplaced `actionsOf` comment in `view.ts`.
- Waiting on the other session's work: archive `row-actions.md`, and fix the key text in `codex-tab.md`. Its line 57 says keys show before labels; the tab draws no key text.
- When this step lands, the docs checks switch from report-only to failing.

### 4. A drawing test for the mod's looks

- Add a test over `demoView` to `tests/hooks.test.ts`. Every row title and every action label in the shared view must appear in the terminal pane and in the desktop pane. The expected titles and labels come from the shared view, `inboxView` and `rowKeyPlan`, so a look that drops one fails.
- The test checks content, not markup or classes.
- It comes before the code moves in steps 5 to 11, so it catches a move that drops something from the mod's looks. The same test for the Codex tab comes in step 7, after the tab's components can be drawn without a page.
- No shared table of cases runs in both test runners. Such a table would test the shared functions twice. What differs between the hosts is their own wiring around those functions, which each host's own tests cover.

### 5. One source for model-read text

- Build `GUIDANCE` and `START_TITLE` once from `Host`, beside `systemText`. Both hosts call them. Before and after, the built strings must be byte-identical for both hosts. A scratch script compares them, so no A/B run is needed. If any byte differs, the step stops for an A/B run.
- Split `hooks/ledger.ts`:
  - It keeps the saved state and the ledger writes.
  - Prompts and `inbox:` texts move to `hooks/model-text.ts`, so the A/B rule names one file.
  - The Claude-only stop, dialog, command-row and transcript code moves to `hooks/claude-text.ts`, which only the mod imports.
  - `ago` and `isLapsed` move to `hooks/view.ts`.
- Drop the `claude-code` path from `codex/tsconfig.json`, so the Codex check no longer needs Claude's generated types. Tighten the import check: no shared module imports `claude-code` at all.
- Update the model-read list in `AGENTS.md` and the owners in the map.

### 6. One row content model

- Add a pure `rowContent(row, { agent, look, repoRoot })` to `hooks/view.ts`. It returns everything a row says:
  - the mark and its tone, which is ✓ when handed off, and whether the row folds;
  - the title, the age, and whether there is a second line;
  - the finding head with its type, tone and age, the detail, and the file shown relative to the repo;
  - the text-field kind and hint, with the agent's name passed in.
- Add `feedbackLine(row, look)`. It decides the double-✓ from `row.state`, not from a glyph. The pane reads `RowView.feedback` for item and finding rows, and computes feedback itself only for PR rows.
- Add two fields to `ActionView`: `emphasis`, one of `primary`, `normal` or `quiet`, and an icon kind, one of `done`, `retry`, `open`, `copy` or `run`. Adapters map the icon kind to a glyph or an SVG.
- Name the tones and marks once in `hooks/tones.ts`, together with `FINDING_BADGES` and the PR status marks. Each look keeps its own color values, so each still looks native to its app.
- Move the shared copy into a `COPY` object in `view.ts`. Adapters keep only decoration, such as the terminal's `↺`.
- Have `inboxView` return each group's title, count and Closed lines.
- Both adapters draw from these and delete their own copies.
- Two behavior changes, both on the Codex tab:
  - Done and Address become primary buttons, as `inbox-ui.md` specifies.
  - A finding's file shows relative to the repo, as the pane shows it. The raw path can be a long absolute path.

### 7. A drawing test for the Codex tab

- `codex/src/tab.tsx` keeps its state in module variables, and its `App` reads them, so it cannot be drawn without a page. Split it the way the server is split. `codex/src/tab-main.tsx` keeps the page: polling, keys, the clipboard and mounting. The components take the tab's state as an argument.
- Add `preact-render-to-string` as a dev dependency, and a test that draws the tab for `demoView` with each row open in turn. Every row title and action label from the shared view must appear. A test of a shared row function alone cannot catch an adapter that drops a field, which is the failure this test exists for.
- This comes after step 6, which moves row content out of the tab and leaves less state to pass.

### 8. One arrival rule

- Add `isTabEmpty` and `defaultOpenId` to `hooks/arrivals.ts`. Each host passes its drawn settled rows and its own blockers as named inputs: the stop and unread state in the mod, the heard state in Codex. Use them in both hosts.
- No behavior changes. The two rules agree today on every case, so one shared rule replaces both.

### 9. One update and press bookkeeping

- Add `applyExchangeReply` and `settleTurns` to the shared update code, with the activity cap and `addActivity`. The failed-update rule becomes a named input, `advancesOnFailure`. The mod passes false because it has a catch-up. Codex passes true because it has none.
- Return Undo's `told.closed` cleanup from `applyPress`, as part of its result. Both hosts then apply it.
- Codex's `notePrompt` uses `withArrival`.
- Add a shared `openTarget(env, …)` beside `openCommands`, and one demo press helper that returns the stale or sample note.

### 10. A Claude-only PR module

- Move `PrPress`, `applyPrPress`, `prRetryOf`, the PR row ids and `PR_STATUSES` into `hooks/pr-presses.ts`. Its header says Claude only. It gets direct tests in `tests/prs.test.ts`.
- The PR entries in `DONE_LABELS` move beside it. `view.ts` merges them in, with a note that Codex has no PRs.

### 11. The two drawings in `register.tsx`

- Group the scattered terminal and desktop values into one table of look traits. The 51 look branches include column sets, cell widths, button frames, row gaps, clip rules and labels. The branches then read named values.
- The full split into a terminal adapter and a desktop adapter stays out of this plan. The pane's drawing reads 74 module-level values, so the split needs its own design and a live check of every row form in both looks. The traits table is the first step toward it, and the map records why the split waits.

## Verification

- `./scripts/check.sh` after every step.
- **Codex tab:** the live-reload dev build and the local test page, in both themes. Then the Codex app: each row form, Dismiss and Undo, switching rows, and a finding with a file.
- **Claude terminal:** a live session with its own `CLAUDE_CONFIG_DIR`, in both themes.
- **Claude desktop pane:** after a redraw, captures of each row form, the PR block, and Done then Undo. Any form not seen is named in the report.
- For step 5, the byte comparison of every model-read string, before and after.

## Out of scope

- Merging `revamp` into `main`, and pushing.
- New product behavior beyond the two drift fixes in step 6.
- The terminal and desktop adapter split. Step 11 says why.
