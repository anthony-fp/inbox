# Codex row states

Every row in the Codex tab moves through one state machine, in `codex/src/rows.ts`. The machine decides what each row draws and which animation runs. Before it, that decision was spread over separate sets in `codex/src/tab.tsx`, and each fix covered one transition.

## What it fixed

Measured in the harness on 2026-10-10:

- **Dismiss, Done and answers.** The open row turned into its settled line in one draw. Its body and buttons vanished in the frame the reply arrived, and the row dropped from 108 px to 44 px with no animation.
- **A settling row measured its end height while an earlier animation still held it.** When a press's reply came back while the row was still growing to show "Sending…", the collapse measured the held height. The row then sat at 80 px for 200 ms and jumped to 44 px.

The simpler fix was to extend the switch-rows code, `closingRows` and `collapse()`, to the settle case. One machine for every state replaced it, so a new transition cannot be added without a defined start, end and animation.

## The states

Each row the shown tab draws, keyed by its id, is in one state:

| State | Draws | Comes to rest as |
| --- | --- | --- |
| `entering` | The row the view just brought in, growing from 0 height and fading in, 300 ms | `closed` or `open`, the form it arrived in |
| `closed` | The line | |
| `opening` | Line and panel, the height growing to fit, 200 ms | `open` |
| `open` | Line and panel | |
| `closing` | The line, and the panel, inert, while the height shrinks over it, 200 ms | `closed` |
| `settling` | The settled line, and the panel the row last drew open, inert, while the height shrinks over it, 200 ms | `settled` |
| `settled` | The settled line, with Undo and its countdown when the person's own Done or Dismiss closed it | |
| `undoing` | The settled line while an Undo press is out: "Undoing…", the countdown paused | |
| `leaving` | The row's last form, fading while its height collapses to 0, 200 ms | Removed. A settled row then shows in the Closed fold |

At each draw the tab works out the form each row should have now, its target:

| Target | When |
| --- | --- |
| `open` | The view lists the row open, and it is the tab's open row |
| `closed` | The view lists the row open, and another row is open |
| `settled` | The view lists the row settled, and its time to show in place has not run out |
| `undoing` | As `settled`, while its Undo press is out |
| `gone` | The view no longer lists the row, or its settled time ran out |

`stepRow` takes a row's track and its target and returns the next track. A track is the row's state, when it entered it, and whether it draws the open row's panel. When the target changes, the row starts moving toward it from where it is drawn: `opening` toward open, `closing` toward closed, `settling` toward settled, `leaving` toward gone. This holds for a row still growing in, too. A leaving row that is listed again grows back in. When a moving state's time has passed, it comes to rest.

Rules that hold in every state:

- **A panel is never removed while it shows.** A track that draws the panel keeps drawing it through `closing`, `settling` and `leaving`, so its content is clipped by the shrinking height instead of vanishing. A row that never drew a panel does not gain one when it settles.
- **The settled line shows as soon as the reply arrives.** It shows the outcome and Undo while the panel shrinks under it, so the press's result is visible at once.
- **A settling row is laid out as an open row is.** The settled line and the panel share one column, so the panel stays exactly where the open row drew it. The row's fill fades out over the same 200 ms as its height.
- **Nothing under the line moves while a press is out.** "Sending…" shows in the line's age slot, where the press's result will show.
- **A row's parts do not fade in.** When a row settles or is undone, its line, panel and Undo swap in place. A fade from nothing there reads as a flicker. A row that arrives still fades in as a whole.
- **Time ends a move, not the animation.** Each move into a moving state schedules a draw for when it is due to end, and that draw brings the row to rest. An animation that never reports its end cannot hold a row.
- **A move starts from the drawn height.** A row turned around mid-move starts the new animation from where it is.
- **A row's end height is its content's height.** The tab adds up the heights of the row's children, which no animation of the row changes.
- **A leaving row keeps its place.** The tab draws it where it last drew it until it is removed.
- **Rows of a tab not shown are forgotten.** They show their form at once when their tab shows.
- **Reduced motion.** Every move ends in the draw that starts it.
- **The line never moves** between `closed`, `opening`, `open` and `closing`, as [motion-and-undo.md](motion-and-undo.md) says.

## Not changing

- The Claude app's pane. Its engine has no opacity or CSS, and fast redraws break its clicks, so Dismiss there still swaps the row in one draw.
- The Codex app's move, enter and exit curves and lengths.
- The settle clock in `codex/src/settle.ts`, which the server shares. Changing it would change the server's build fingerprint.

## Checks

- Tests in `codex/tests/press.spec.ts`: every state reaches every target, a row drawing its panel never drops it except through `closing`, `settling` or `leaving`, a row turned around mid-move, and reduced motion.
- In the harness, each row's height and panel, frame by frame: Dismiss with a slow reply, an answer with an instant reply, Undo, a failing Undo, a settled row leaving, a row arriving, switching rows, and reopening a row mid-close.
- `./scripts/check.sh`.
