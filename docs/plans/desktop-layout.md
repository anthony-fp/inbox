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

- **Section label.** Muted, regular weight: "Questions · 4", as the app labels its sidebar groups.
- **Open row.** The ask, wrapped in full, and its age at the side. Drawn by `row-client.tsx`, which draws the frame itself.
- **Selected row.** The same frame with the warm selection fill. The ask is bold. Its buttons and follow-ups sit under it, at the text column.
- **Row that just closed.** ✓ in the mark column, the ask and its outcome muted on one line, and Undo at the side.
- **Closed fold.** "3 closed ›", or "3 closed ⌄" unfolded, at the text column.
- **Closed item.** Its mark, the ask muted, how it closed muted on a second line, and its age at the side.

## Head of the pane

- The demo notice is muted and shares one line with Hide demo. Desktop words it shorter, "Sample entries. Presses send nothing.", so it fits.
- The update time stays under the tabs when it does not fit beside them. Narrowing the tabs to make room wrapped the first tab's count.

## Checked in the pane

- A frame drawn inside a Client insets its text exactly as one in the hooks tree: the row Client's text and the selected row's start at the same pixel.
- Ages such as "48m" and "1h" fit the 5-column side.
- The selected row's fill draws with rounded corners.

## Not checked yet

- The light appearance, the Findings and PRs tabs, and a row's hover in a frame.
