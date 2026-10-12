# One structure for the inbox in every look

Status: proposed. It builds on `three-looks.md`, which is still building, and uses its names.

The inbox is drawn three ways: the terminal pane, the Claude desktop app pane, and the Codex tab. Today each look decides its own layout, so the same row has different parts, order and emphasis in each. This plan gives all three one structure, and keeps each look's drawing native to its host.

The split is:

- **Shared:** structure, order, words, emphasis, counts, and what each color means.
- **Per look:** material. That is cells, points or pixels, glyphs or SVG shapes, fills, fonts, hit areas, keys and motion.

A difference in material is allowed. A difference in structure is drift, unless the deviation list in `docs/looks.md` names it with its host constraint.

## Terms

- **Region:** a horizontal band of the pane. There are four: notice, tab bar, error line, body.
- **Section:** a label line, its rows, and an optional fold of closed rows.
- **Row grid:** the three columns every row uses. A mark column (2 columns wide), a text column, and a side column (5 columns wide) for the age or Undo.
- **Column:** the abstract width unit. One terminal cell, about 7.9 pt on desktop, and an unmeasured px value in Codex.
- **Emphasis:** an action's rank, `ActionView.emphasis` from `three-looks.md` step 6: `primary`, `normal` or `quiet`.
- **Role:** a named color use, such as `muted` or `surface.selected`. Each look maps a role to a value.

## The structure

### Regions

Every look draws these top to bottom and skips a region with nothing to say.

1. **Notice.** One line: `Sample entries. Presses send nothing.` with Hide demo at the right. Today the three looks use three wordings.
2. **Tab bar.** Tabs left. The status line, muted, at the right end. It wraps under the tabs when the row is too narrow, by the same rule in every look.
3. **Error line.** "Last update failed" and similar. Error tone, directly under the tab bar, only when there is one.
4. **Body.** Sections of rows. It scrolls as a whole.

The terminal's key list footer and Codex's Show demo link stay as listed deviations.

### Sections

- The label sits in the text column: `Questions · 4`. The label is bold and the count muted, after the shared " · ".
- Sections are flat. A hairline separates them, inset to start at the text column. No card fills, no borders. Desktop cannot draw rounded cards, and the hairline is the one separator all three looks can draw.
- The fold reads `4 closed`, lowercase. The number is the total closed, not the number shown. It lists the last 3 and then `1 earlier`. Today "3 closed" is wrong whenever more than 3 exist.

### Rows

```
 mark | text column                                  | side
      | title                                        | 27m
      | meta line (optional, muted)                  |
      | detail, file, actions (selected row only)    |
```

- **Mark:** top-aligned to the first text line. Never centered on the row, and never set by a control's height. This fixes the desktop settled ✓ that sits below its text.
- **Title:** bold only when selected. Clipped when not selected. The shared text is never shortened.
- **Meta:** at most one muted line at rest, for a closed row's outcome, a handed-off task's step, or a thread's reply.
- **Side:** the age in short form ("27m", "3h"), muted like every timestamp. It is never inline after the title, so no "·" can be left at a line end. Under the narrow breakpoint it moves to the end of the meta line instead of disappearing.
- **States:** rest, hover, selected, new, handed off, settled, closed, failed and typing each have one intent, shared by all looks. Selection has no hue. It is a neutral one step above the page, as hover is.

### Actions

Three levels of emphasis, in this order in every look:

1. **`primary`.** At most one: the recommended option, else Done or Address. Its label ends "(recommended)" in every look. Codex leaves that text off today.
2. **`normal`.** Other options, steps, Reply, Draft reply, Open.
3. **`quiet`.** Discuss, Explain, then Dismiss at the far right, set apart by space.

Every press shows its result on the row at once, as `AGENTS.md` requires.

### PRs

Each PR is a section:

1. The number in the PR blue, then the title bold.
2. A verdict line. "Blocked" in error tone, then the reasons muted, one per line so they can be counted.
3. One primary action that moves the PR on, such as Resolve conflicts, and Open PR.
4. Review threads, with the comment as the title and `@author · file:line` as the meta line.
5. Failing checks, collapsed to one line: `2 failing: plugin tests, lint`. Selecting it shows the rows with Open log. A check row says little until i231 adds the annotation text.
6. PRs with nothing to do go last, one line each, under `Nothing to do · 2`.

Threads come before checks because a thread needs the person and a failing check usually needs Claude.

### Color

- One meaning per tone. Amber waits on you. Purple is findings. Blue is PRs. Green is done. Red is failed.
- Counts: each tab's count is drawn in its tone, and only above 0. A number on a tab, a section label or the band counts the rows waiting now, so the three always agree.
- `hooks/tones.ts` holds every tone value. The color roles join it in build step 3.

## What changes in each look

### Desktop pane

- Settled row: the ✓ aligned to the title line.
- Age: kept when narrow, moved to the meta line.
- PR block: the verdict with reasons as a list, threads first, checks collapsed, quiet PRs as one line each.
- Dismiss set apart at the right of the quiet actions.
- Error text: `DESKTOP_PALETTE.tone` is empty, so error text likely draws uncolored. Finding f233 tracks it.

### Codex tab

- Flat sections with hairlines instead of cards inside a gray page.
- Age in a side column, so neither title nor answer is clipped in the middle.
- Titles wrap to two lines instead of one clipped line at 300 px.
- `(recommended)` added. Fold reads `4 closed`. Section count reads `Questions · 4`.
- Option buttons drawn as outlines, because grey on a grey card fails in light mode.
- Neutral selection instead of the blue mix.
- A loading state that waits briefly before showing, and an error strip with a Reload button in place of the instruction to close the tab.

### Terminal pane

- Header: the notice on one line, and the status on the tab row. This saves about 5 rows before the first item.
- Tree rails (`│ ├─ └─`) and the rule under every row removed. The mark column and the selected fill carry the grouping. This is a decision below.
- One button style: `[a Keep it open]`. Brackets show it is clickable. The letter shows its key. Today plain `a: label` text sits next to bracketed buttons.
- PR rows drop the "Failing check" and "Review thread" heads, because the section label says it.
- PR number in regular weight, as in the other looks.

## Decisions for Pete

Each has a recommendation. None is built until Pete chooses.

1. **Group findings by kind, one line each.** Recommend yes. `Issues · 2`, then `Opportunities · 2`, each row one line with its ▲ or ✦ mark in the shared tone. The kind word leaves the row because the group label says it. This halves each finding's height and removes the colored Svg kind label, which was built on request. If Pete takes it, open question i232 no longer applies. If not, i232 stands.
2. **Remove the terminal's tree rails and per-row rules.** Recommend yes. At 70 columns they take about a third of the lines. The fold chevron already shows nesting.
3. **Remove the terminal's section cards in the docked pane.** Recommend yes, with a 120-column capture checked first. The hairline replaces them.
4. **Add a PRs tab to Codex.** Recommend yes, after a spike confirms `gh` runs in the Codex server. That is not verified.
5. **Count a PR that is blocked on you in Needs you.** Recommend yes, as one row that opens the PRs tab. The count may appear in text Claude reads (`inboxText`, `carryText`), so check that first.
6. **Hide Explain on questions and tasks.** Recommend hiding it from the row first and keeping the key. Removing it changes model-read text and saved state, which needs an A/B run and an `upgradeState` step.
7. **Rename Address to Fix (issues) and Do it (opportunities).** Recommend changing only the label and keeping the message Claude receives, so no A/B run is needed.

These two would reverse choices Pete made, so they are listed only as options. Not recommended:

- Show the status line only while updating or failing.
- Hide ages under 1 hour at rest.

## On the `ideal-layout` branch

The branch builds this structure for Pete to try before any of it merges into `revamp`.

In it:

- Findings grouped into Issues and Opportunities, one line each (decision 1).
- The shared demo notice, `Questions · 4` labels, and a fold that counts every close, with an `N earlier` line.
- Ages in a side column in the terminal and Codex, as on desktop.
- The PR block in the terminal and desktop: review threads before failing checks under group titles, the verdict's reasons one per line, a quiet Dismiss, and PRs that wait on nobody as one line each under `Nothing to do`.
- Terminal sections parted by a rule instead of cards (decision 3).
- Fix and Do it labels on findings (decision 7). Explain keeps its key but leaves the row's buttons in the terminal and Codex (decision 6). Desktop takes no keys, so it still draws Explain.
- Codex: flat sections, the row grid, neutral selection, three button levels, `(recommended)`, a delayed loading line, and an error strip with Reload.
- Desktop: failures in the app's red (f233), and the settled ✓ on its text's line (f234).

Held back:

- Decision 2, the terminal's tree rails and per-row rules. Pete chose "Not yet".
- Decision 4, a Codex PRs tab, which needs the `gh` spike.
- Decision 5, counting a blocked PR in Needs you, which can change model-read text.
- Failing checks collapsed to one line. The group title now says the count, so this matters less.
- The layout tokens, the outline test and the contrast check. They follow once Pete approves the layout.

## Implementation

The goal: a change to the structure is made once, and a look that does not follow it fails a check.

### Where each rule lives

| Rule | Owner | Notes |
| --- | --- | --- |
| What a row says, and its parts | `rowContent` in `hooks/view.ts` | Three-looks step 6. It also returns the mark name and each action's `emphasis`. |
| Sections, group labels, counts, fold totals | `inboxView` in `hooks/view.ts` | Three-looks step 6 has it return each group's title, count and closed lines. This plan adds the fold's total. |
| PR block content | `prBlock` in `hooks/prs.ts` | Claude only, until Codex has PRs. |
| Copy | `COPY` in `hooks/view.ts` | Three-looks step 6. The notice, fold, and empty texts go here. |
| Columns, spacing steps, breakpoints, region order | `hooks/layout.ts` | Abstract values in columns and steps. |
| Each look's units | the look-traits table, three-looks step 11 | It gains each spacing step and column in the look's unit. Codex gets the same fields. |
| Tones, marks and color roles | `hooks/tones.ts` | Three-looks step 6 names the tones and marks here. This plan adds `surface.raised`, `surface.selected`, `surface.hover`, `line`, `muted` and `age`, and each mark's SVG path, so desktop Svg and Codex inline SVG draw the same shape. |
| Deviations | the deviation table in `docs/looks.md` | Each row names its host constraint and `file:symbol`. |

### Layout tokens

`hooks/layout.ts` holds only abstract values:

```ts
export const COLUMNS = { mark: 2, side: 5 } as const
export type Space = 's0' | 's1' | 's2' | 's3' | 's4'
export const BREAKPOINTS = { statusWraps: 54, ageMoves: 50, tabsShrink: 40 } as const
export const REGIONS = ['notice', 'tabs', 'error', 'body'] as const
```

Each look's traits give `column` and `space: Record<Space, number>` in its own unit. Layout code asks for `space.s3`, never a number. The breakpoints are estimates from reading the code, not measurements. Measure them against `DESKTOP_WIDE_AT` and the tab-shrink constants before they replace those constants. The desktop row padding of 8 pt also needs measuring as a fraction of a line.

### Keyed tables

Each table that varies by look, mark, role or state is a `Record` over its union: `Record<Look, …>`, `Record<MarkName, …>`, `Record<ColorRole, …>`, `Record<RowStateName, …>`. Adding a mark, role or state then fails the type check in every look that has not drawn it.

### Drift checks

1. **Outline test.** Extend the step-4 drawing test in `tests/hooks.test.ts`. Each look flattens what it draws for the demo into one ordered list: regions, section labels, and for each row its parts with their text and emphasis. The test compares the lists across looks, minus the deviations in `docs/looks.md`. A look that drops, adds or reorders a part fails. Codex joins once three-looks step 7 can draw the tab without a page.
2. **Deviation list.** `scripts/check-structure.mjs` already checks the `file:symbol` references in `docs/looks.md`. The outline test reads the same list, so an unlisted difference fails and a listed one must name its code.
3. **Contrast check.** For each appearance, check every text role against the surfaces it can sit on, using the values in `tones.ts`. Run it in `check.sh`.
4. **State coverage.** A `STATES` list in `hooks/demo.ts` names every row state the demo shows. A test fails when a `RowState` variant has no demo row, so every state can be seen in every look.
5. **Capture review.** A script captures the terminal and Codex looks for each demo state and writes the atlas page. Desktop captures need the live app, so they are a manual review step after a change, not part of `check.sh`.

### How to make a common change

- **Add a row part:** add it to `rowContent`, then draw it in each adapter. The outline test fails until all three draw it.
- **Change a color:** change the role's value in `tones.ts`. The contrast check runs on it.
- **Add a mark:** add it to the marks in `hooks/tones.ts` with its glyph, path and tone. The keyed table forces each look to handle it.
- **Let one look differ:** add a row to the deviation table with its host constraint, then the code.

## Build order

Each step is one commit, passes `./scripts/check.sh`, and is checked in the looks it touches.

1. Finish three-looks step 6 (`rowContent`, `COPY`, action emphasis, group titles from `inboxView`), using the row grid and emphasis above.
2. Add the `hooks/layout.ts` tokens, and their unit values to the look traits of three-looks step 11. No visible change.
3. Add the color roles to `tones.ts` and the contrast check. Fix f233.
4. Move desktop's `markShape` paths into the marks in `tones.ts`, and draw Codex marks from the same paths.
5. Add the fold total and the outline test for the terminal and desktop.
6. Fix the drift, one look per commit: Codex first (age column, flat sections, labels, neutral selection), then desktop (mark alignment, narrow age), then terminal (fold label, counts, PR heads).
7. PR block content in the terminal and desktop.
8. Pete's decisions, each its own commit.
9. Codex in the outline test, after three-looks step 7.
