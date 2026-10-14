# Launch video

Status: proposed. Nothing is recorded yet.

A 70-second video that shows what the inbox does, then shows the same inbox in all three apps at once. It has no voiceover. Short captions carry the words, so it works muted in a feed.

## The story

An agent asks you something in the middle of a long reply, and the question scrolls away. The inbox keeps it, and everything else that waits on you, in one place beside the conversation. You answer with one press. It works the same in the Claude Code terminal, the Claude desktop app and Codex, and in each it looks like it belongs there.

Reason for this order: the viewer needs to feel the problem before the panel means anything. The side-by-side beat lands harder after they have learned what one row does, because they can then see that the same row behaves the same three times.

## Beats

Times are targets. Each caption stays on screen at least 2 seconds.

| # | Time | Picture | Caption |
| --- | --- | --- | --- |
| 1 | 0–5 s | Terminal. Claude writes a long reply. Midway it asks "Keep the old API for one release?", and the reply keeps scrolling until the question is gone. | Agents ask questions. Then they scroll away. |
| 2 | 5–9 s | The line above the prompt fades in: "2 need you · 1 finding". | The inbox keeps them. |
| 3 | 9–17 s | Type `/inbox`. The panel opens on Needs you, with the question open and its options under it. Press `b`. The row reads ✓ and the option chosen, the answer appears in the conversation as your message, and the next waiting row opens. | One press answers. |
| 4 | 17–26 s | Press `2`. Findings: an issue Claude noticed outside its task. Press Fix. The row shows ✓, and Claude starts on it. | It catches what the agent noticed on the way. |
| 5 | 26–32 s | Back on Needs you, a task only you can do: "Sign in to gh". Copy its command, run it, press Done. The row settles and Undo drains. | And the things only you can do. |
| 6 | 32–40 s | Press `3`. PRs: one PR blocked by a failing check, one with a review comment waiting on you. Press the comment's action. | It knows what's blocking your PRs. |
| 7 | 40–46 s | Claude finishes the fix. Without a press, the finding closes and drops into "1 Closed". | It cleans up after itself. |
| 8 | 46–62 s | The side-by-side beat. See below. | Same inbox. At home in each app. |
| 9 | 62–70 s | End card: the repo, and both install lines. | |

End card text:

```
github.com/petekp/inbox

Claude Code   /plugin install inbox --marketplace petekp/inbox
Codex         codex plugin add inbox@inbox
```

## The side-by-side beat

Three columns, left to right: Claude Code in the terminal, the Claude desktop app, Codex. All three show the same rows, and every press happens on the same frame in all three.

Reason for this order: it moves from the most familiar host to the newest, and puts the two Claude apps next to each other, so the step from terminal to desktop reads as one product in two forms.

| Time in beat | Picture |
| --- | --- |
| 0–2 s | A wide shot of the three app windows, each whole, so the viewer recognizes each app by its chrome. |
| 2–4 s | Each column pushes in to its inbox. The columns appear left to right, 0.3 s apart. |
| 4–7 s | All three answer the same question on the same frame. The terminal draws the ✓ row in monospace. The desktop app draws it beside native buttons. Codex animates the row closed. In all three the next row opens. |
| 7–10 s | All three switch to Findings on the same frame, and the same finding opens. |
| 10–13 s | All three press Done on the same task. Undo drains in each, drawn the way that app draws it. |
| 13–16 s | Hold on the three settled lists. The caption sits under the middle column. |

What the viewer should take from it: the same rows, in the same order, with the same actions and the same results. Only the drawing differs, and each one matches its app: monospace and keys in the terminal, native buttons in the desktop app, a web panel with motion in Codex.

## Recording

### Content

Beats 1 to 7 need a real session, because the point is that an answer reaches the agent and the agent acts. Demo presses send nothing. Script the session in a small sample project and run it under its own `CLAUDE_CONFIG_DIR`, so the recording never writes to your real inbox. The model's replies vary, so record several takes of each beat.

Beat 8 needs the same rows in all three apps, and presses that change nothing outside the recording. The demo gives both. Claude Code shows it with `/inbox demo`. Codex shows its Show demo button only in a build made with `INBOX_DEMO_BUTTON=1`. All three read the same sample data from `hooks/demo.ts`.

The demo's rows describe work on an ordinary app: adding Apple Pay to a store's checkout page. A viewer who has never seen this project can follow them. Beat 8 answers "Show Apple Pay above the card form, or beside it?", opens the finding "Orders to Canada are taxed at US rates", and marks "Sign in to the Stripe CLI to forward webhooks" done.

Reason: the earlier demo rows described the inbox itself, such as "Hotkeys vanish on selected rows in ANSI", and beat 8 is where viewers read rows most closely.

### Frame and theme

- 1920×1080 at 60 fps, so the push-ins in beat 8 stay sharp.
- All three apps in the dark theme. Codex and the desktop app follow the system appearance. Give the terminal a dark theme with colors, so the open row shows its fill and not only the `▌` bar the Auto theme draws.
- For beat 8, size the three windows to the same height. Each column is 640 px wide, so record each app at 2× and crop to the inbox and a strip of the app around it.
- Hide the menu bar, the Dock and notifications. Use a fresh account picture and a neutral project name.

### Synchronizing the three columns

Record each app separately and line the three up in the edit. Drive each one from the same timed script, so every press lands at the same moment after a shared start mark:

- **Terminal:** send keys to the Terminal window.
- **Claude desktop app:** press its Buttons through accessibility. The desktop app ignores hotkeys, so clicks are the only way. The press tooling from the desktop checks already does this.
- **Codex:** send keys to the tab. It takes the terminal's keys.

Start each script with a visible mark, such as switching to Findings and back, and align the three takes on its first frame.

### Before recording

- Merge the open branches first, so the video shows how the inbox behaves now: a tab opens on its first waiting row, a row you are reading stays open when another arrives, and a new row arrives without a colored bar.
- In the desktop app, send one message before `/inbox`. `/inbox` sent as a session's first message is not recognized as a command.

## Open decisions

1. **Length.** 70 seconds suits a launch post. A 30-second cut would keep beats 2, 3, 8 and 9.
2. **Music.** The plan assumes a track with a clear beat at 46 s, where the three columns appear.
