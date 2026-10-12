# Desktop pane layout

Status: built. Checked in the dark appearance with the demo's Needs you tab.

The desktop pane's rows start at five different columns, so its hierarchy reads as haphazard. This plan gives every line in a list one shape, so the pane reads like the Claude app's own lists. The terminal pane does not change.

## The row shape

Every line in a list is the same frame, left to right:

| Part | Width | Holds |
| --- | --- | --- |
| Mark | 2 columns | ✓, ✕ or –, a finding's ▲ or ✦, or nothing |
| Text | the rest | the ask in full, wrapped; a closed item's outcome on a second line |
| Side | 5 columns, right-aligned | the age, as "12m", or Undo on a row that just closed |

Each frame is a Box with `borderStyle="single"` and a transparent border. That rounds its fill, and insets its content about 13 pt. Every frame has the same inset, so a fill on hover or selection changes no text position. Section labels are frames with no fill, so they start where the rows' text starts.

## What each line becomes

- **Section label.** Bold, with its count muted: "Questions · 4". A hairline rule parts each section from the one above. The first section has none, since the tabs' own line sits above it.
- **Open row.** The ask, wrapped in full, and its age at the side. Drawn by `row-client.tsx`, which draws the frame itself.
- **Selected row.** The same frame with the warm selection fill. The ask is bold. Its buttons and follow-ups sit under it, at the text column.
- **Row that just closed.** ✓ in the mark column, the ask and its outcome muted on one line, and Undo at the side.
- **Closed fold.** "3 closed ›", or "3 closed ⌄" unfolded, at the text column.
- **Closed item.** Its mark under the fold's label, a column's gap, then the ask muted and how it closed on a second line, dimmer. Its age is at the side.
- **Closed fold on hover.** The label and chevron turn the app's text color. No fill.

## PRs tab

A PR block lists what blocks the PR. Each row used to repeat its kind, "Failing check" or "Review thread", above its text. A failing check showed only its name. A thread with a reply showed only the reply, so the question it answered was gone.

The block, top to bottom:

1. **Title.** "#31" muted, the title bold.
2. **Status.** "Blocked:" in its color, then the reasons, muted.
3. **Buttons.** The action that moves the PR on is the primary button.
4. **Failing checks · 2.** A muted label, then one row per check:
   - mark ✕ in the error color
   - "CI / lint": the workflow muted, the check's name
   - "Failed after 41s" on the second line
   - the age at the side
5. **Review threads · 2.** A muted label, then one row per thread:
   - mark ◦, or ✓ once sent to Claude
   - "register.tsx:1147" muted, then the first comment, which asks for the change
   - the second line: who asked, or the latest reply as "@robin: Agreed, …"
   - the age at the side

The labels say each row's kind once, so the rows drop it.

### Data

The check's workflow, start and end come from the same `gh pr view` call, in `statusCheckRollup`, as `workflowName`, `startedAt` and `completedAt`. They are optional on `PrCheck`, so a saved check without them still reads.

What failed inside a check, such as the failing test or the first error line, would need one more call per failing check: `gh run view --log-failed`, or the check run's annotations. Not built. It waits on Pete's decision.

## Head of the pane

- The demo notice is muted and shares one line with Hide demo. Desktop words it shorter, "Sample entries. Presses send nothing.", so it fits.
- The update time stays under the tabs when it does not fit beside them. Narrowing the tabs to make room wrapped the first tab's count.

## Checked in the pane

- A frame drawn inside a Client insets its text exactly as one in the hooks tree: the row Client's text and the selected row's start at the same pixel.
- Ages such as "48m" and "1h" fit the 5-column side.
- The selected row's fill draws with rounded corners.

## Not checked yet

- The light appearance, and a row's hover in a frame.
- The fold's hover color. It needs the pointer over the pane.
