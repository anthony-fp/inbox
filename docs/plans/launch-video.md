# Launch video

Status: building. The `draft` variant tells the story below with Pete's captions. Its takes were recorded in the VM with main's inbox, and every press in them is a click. Next, replace the drawn thread's text with text from a real session.

An 81.5-second video. It shows how much an agent's thread asks you to track, then shows the inbox taking that over in all three apps. It has no voiceover. Short captions carry the words, so it works muted in a feed. Every press is a click, and the pointer is on screen.

Pete chose to make the full 81.5-second cut first. A 30-second cut could follow, with beats 2, 7, 8, 11 and 12.

## The story

A session starts simple. Then the replies pile up: tool calls, diffs and long paragraphs. Questions and ideas scroll past inside them. To catch them all, you would have to read everything the agent wrote and keep it in your head. Some things the agent notices never reach the reply at all.

So you reply point by point. You read back through the thread, type a numbered list into the prompt and send it. The agent answers each point and raises new ones, and you do it again. This is one of the biggest sources of friction in working with a coding agent.

The inbox is the missing piece. It gives the agent one stable place to ask you, beside the conversation, in a form that is quick to scan. Each question comes with ready answers. Each finding comes with next steps such as Fix, Discuss and Reply. One click answers. Rows arrive and close on their own as the session moves.

It works the same in Claude Code in Terminal, the Claude app and Codex in the ChatGPT app. Each app draws it in its own style.

Reasons for these choices:

- **A long opening.** The viewer has to feel how much the thread asks of them before the inbox means anything.
- **A drawn opening.** Beats 1 to 6 show how much an agent writes and how much you have to remember, in any agent. A thread drawn in Remotion can be paced exactly, and it can mark what scrolls past while the text is still readable. A real recording sped up 8 times can't be read, and marks on moving footage are hard to place. The cut to real footage in beat 7 also marks where the product starts.
- **Clicks, not keys.** A pointer clicking shows cause and effect to a viewer who knows no keys. The VM's pointer does not show in the recordings, so the video draws it from each click's logged point and time.
- **The question arriving live in beat 7.** The inbox adds and removes rows on its own. The viewer has to watch a question leave the conversation and land in the inbox.

## Beats

Times are targets. Each caption stays on screen at least 2 seconds.

| # | Time | Picture | Caption |
| --- | --- | --- | --- |
| 1 | 0–4 s | A drawn thread. You type one short prompt, and the agent gives a short reply. | A chat session starts simple enough. |
| 2 | 4–11 s | Replies stream in faster and faster: tool calls, diffs and paragraphs. Questions and a side note are marked as they pass, then scroll away. | Then things begin to pile up. |
| 3 | 11–16 s | The camera pulls back to the whole thread, too small to read. The questions and the side note are marked where they sit in it. | Questions and ideas get buried. |
| 4 | 16–20 s | The camera pushes in on a line of the agent's thinking. It noticed that Canada orders use the US tax table, and decided to leave it. The reply never mentions it. | Some aren't even surfaced. |
| 5 | 20–26 s | Back at the prompt, you type a numbered reply, one line per point, and send it. | You diligently respond, point by point. |
| 6 | 26–31 s | The agent replies with a numbered list and new questions. You start typing "1." again. | Then again, and again... |
| 7 | 31–36.5 s | Recorded: Claude Code in Terminal, with the inbox docked beside the conversation. The reply ends, and its question arrives in the inbox as a row. | Inbox gives the agent one place to ask you. |
| 8 | 36.5–44.5 s | The pointer clicks the question. It opens with its answers ready. A click on one sends it as your message, and the row reads ✓ and the answer. | The agent anticipates your answers, as it should. |
| 9 | 44.5–53.5 s | A click on Findings shows two things the agent noticed outside its task: an issue, open with Fix, Discuss and Reply, and an opportunity below it. A click on Fix hands the issue to the agent, and the opportunity opens with Do it, Discuss and Reply. A click on Needs you leads into beat 10. | Your agent has somewhere it can surface issues and opportunities, with next steps. |
| 10 | 53.5–59.5 s | Back on Needs you, you answer the other question in the chat instead. When the agent replies, the row closes on its own. | Your agent keeps track of what's been completed so it doesn't hang around. |
| 11 | 59.5–75.5 s | The three apps side by side, each labeled. See below. | Same inbox. At home in each app. |
| 12 | 75.5–81.5 s | End card: "Inbox", large, and the repo's address under it. | |

Every beat with footage names its app in a band above the picture: "Claude Code in Terminal", "Claude app" or "Codex in the ChatGPT app". In the VM, Codex runs inside the ChatGPT app, and Pete chose that name for the video. The drawn thread in beats 1 to 6 has no label, since it stands for any agent.

Beat 10 shows an answer typed in the chat. Outside beat 11, the video shows no task only you can do, such as signing in to gh.

The end card shows two lines and nothing else:

```
Inbox
github.com/petekp/inbox
```

Reason: a viewer can't type install commands from a video. The repo's README has them.

## The side-by-side beat

Three columns, left to right: Claude Code in Terminal, the Claude app, Codex in the ChatGPT app. A label above each column names its app. All three show the same rows, and every click lands on the same frame in all three.

Reason for this order: it moves from the most familiar host to the newest, and puts the two Claude apps next to each other, so the step from terminal to desktop reads as one product in two forms.

| Time in beat | Picture |
| --- | --- |
| 0–2 s | A wide shot of the three app windows, each whole, so the viewer recognizes each app by its chrome. |
| 2–4 s | Each column pushes in to its inbox. The columns appear left to right, 0.3 s apart. |
| 4–7 s | All three answer the same question with a click on the same frame. The terminal draws the ✓ row in monospace. The desktop app draws it beside native buttons. Codex animates the row closed. In all three the next row opens. |
| 7–9.2 s | A click on Findings in all three. It opens the same finding in each. |
| 9.2–13 s | A click back on Needs you, a click on the same task, and a click on Done. Undo drains in each, drawn the way that app draws it. |
| 13–16 s | Hold on the three settled lists. The caption sits under the middle column. |

What the viewer should take from it: the same rows, in the same order, with the same actions and the same results. Only the drawing differs, and each one matches its app: monospace in the terminal, native buttons in the desktop app, a web panel with motion in Codex.



## Recording

### Content

Beats 7 to 10 need a real session, because the point is that an answer reaches the agent and the agent acts. Demo presses send nothing. Script the session in a small sample project in the inbox-ui VM, so the recording never writes to your real inbox. Record it as one continuous take, as Vignette's trailer was recorded. The cut keeps spans of the take at real speed and skips Claude's working time, so the model's varying reply times don't need several takes.

Beat 11 needs the same rows in all three apps, and presses that change nothing outside the recording. The demo gives both. Claude Code shows it without its notices with `/inbox demo recording`. Codex does in a build made with `INBOX_DEMO_RECORDING=1`, from its Show demo button. All three read the same sample data from `hooks/demo.ts`.

The demo's rows describe work on an ordinary app: adding Apple Pay to a store's checkout page. A viewer who has never seen this project can follow them. Beat 11 answers "Show Apple Pay above the card form, or beside it?", opens the finding "Orders to Canada are taxed at US rates", and marks "Sign in to the Stripe CLI to forward webhooks" done.

Reason: the earlier demo rows described the inbox itself, such as "Hotkeys vanish on selected rows in ANSI", and beat 11 is where viewers read rows most closely.

### Frame and theme

- 1920×1080 at 60 fps, so the push-ins in beat 11 stay sharp.
- All three apps in the dark theme. Codex and the desktop app follow the system appearance. Give the terminal a dark theme with colors, so the open row shows its fill and not only the `▌` bar the Auto theme draws.
- Run Claude Code with its fullscreen renderer, `CLAUDE_CODE_NO_FLICKER=1 claude`, in a terminal at least 110 columns wide. Its pane then docks beside the conversation instead of inline above the prompt, so beat 7 can show the question in both places. The takes confirm the docked pane stays open while Claude replies.
- Set the desktop app's own theme to System or Dark. Hide its sidebar, which lists your other sessions.
- For beat 11, size the three windows to the same height. Each column is 640 px wide, so record each app at 2× and crop to the inbox and a strip of the app around it.
- The takes use a 13 pt font in a zoomed Terminal window, 124 columns wide. At 14 pt the window is 111 columns, and the released inbox drops the key letter before a long option, such as "(recommended)". The fix is on main and not released yet.
- Hide the menu bar, the Dock and notifications. Use a fresh account picture and a neutral project name.

### Clicks

Every press is a click, in all three apps. The VM's pointer does not show in the recordings, so the video draws one. It glides to each target and dips with a ring on each click.

- **One source for the clicks.** The timeline holds each click's point on the VM's screen and its lead: how long its result takes to show in that app. `drive.py` clicks at those points, and the video draws the pointer from the same points and times.
- **Hover in the take.** `drive.py` moves the VM's pointer onto each target 0.3 s before it clicks, so the target's hover state is in the take when the drawn pointer arrives. The pointer then stays where it clicked, as the drawn one does.
- **Beats 7 to 10.** `act.py` sends `click x y` commands and logs each one on the recorder's clock. The states take their times and points from that log.

Checked on the demo:

- A click on a tab switches to it, in all three apps.
- A click on Findings opens its first finding, in all three apps. No separate click opens it.
- A click back on Needs you reopens the row that was open when you left it, in all three apps. In beat 11, that is the question that opened after the answer.
- A click on a row opens it, in all three apps.
- A click in the terminal's pane presses what is under it.
- A row ignores presses for its first 400 ms open, `PRESS_GUARD_MS` in `hooks/view.ts`. So beat 11 clicks Done a full second after the task opens.
- Terminal.app passes the pointer's hover to Claude Code, so a hovered option lights in the terminal's take.

### Synchronizing the three columns

Record each app separately and line the three up in Remotion. `drive.py <app>` reads the beat's click times from the timeline file. The recorder writes the host time of its first frame, and the driver logs each click on the same clock, as Vignette's `media/trailer/record.swift` and `drive.py` do. `cut.py` reports the first frame that changes after each click, which is when its result shows. Each click's lead in the timeline should match it.

## Animatic

The animatic is a Remotion project in `launch-video/`, with its own `package.json`. Remotion renders React components to video frame by frame. It is used under its free license's terms for evaluating. Publishing the finished video needs a Company License. [launch-video-research.md](launch-video-research.md) has the research and the reasons.

- **The timeline** is `launch-video/src/timeline.ts`. It holds each beat's caption, start and length, and each state's time, click and still. It imports `SETTLED_MS` from `hooks/view.ts` and `EXIT_MS` from `codex/src/rows.ts`, so a settled row holds for its real time.
- **The drawn thread** is `src/thread.ts`, for its lines and when each appears, and `src/ThreadView.tsx`, which draws it. Its text is written for the video. Before the final, replace it with text from a real session in the sample project.
- **The pointer** is `src/Pointer.tsx`.
- **Two variants.** `draft` is the video. `captions-off` is the same with no captions, to check that the pictures carry the story.
- **Stills.** Beat 11 has stills captured from the demo in all three apps. A column whose take is missing shows them instead. A beat with no take and no still draws a placeholder that names its app and state.
- **Where captures live.** Stills are in `launch-video/public/stills/<app>/<state>.png` and clips in `launch-video/public/takes/`. Git ignores both. The window sizes and inbox rectangles in `WINDOWS` are measured from the side-by-side takes, which the stills match within a few pixels. A take at another window size needs them measured again.
- **Looks.** The captions, app labels and pointer stay as they are drawn now. Each caption line is white text on its own dark pill, 48 px, centered at the bottom, so it reads muted at the size of a feed. Each column's app label sits in a pill above it. The pointer is the macOS arrow, since all three apps run on a Mac.

To run it, install its tools once with `npm --prefix launch-video ci`. Then:

- `npm --prefix launch-video run studio` opens Remotion Studio, which lists both variants.
- `node launch-video/scripts/check.mjs` prints the caption report, the states each beat cuts off and any missing stills.
- `node launch-video/scripts/check.mjs --render <variant>` also renders the variant to `launch-video/out/` and writes the checks below.

The agent checks each render:

- ffprobe: 1920×1080, 60 fps, and the frame count the timeline gives.
- A caption report: each caption lasts at least 2 s, reads at no more than 20 characters per second, and overlaps no other.
- Stills at every click and every caption's first and last frame, read back.
- A contact sheet of one frame per second.

## The draft

The draft is `launch-video/out/draft.mp4`, 81.5 seconds. The first draft, which told the earlier story, is kept beside it as `out/draft-1.mp4`. To render the draft again, run:

    node launch-video/scripts/check.mjs --render draft

- **Beats 1 to 6** are the drawn thread.
- **Beats 7 to 10** replay one session take in Claude Code, clicked with `act.py`.
- **Beat 11** replays three side-by-side takes, clicked with `drive.py`. In each app, every result shows within about 0.15 s after the drawn click.
- **Watch the render, not Studio.** Studio's preview in the terminal browser draws the takes black. The same browser plays each clip when it is opened on its own.
- **The takes show main's inbox,** which isn't released yet.

### How it is made

The tools are in `launch-video/record/`. The takes are in `launch-video/takes/` and the cut clips in `launch-video/public/takes/`. Git ignores both.

1. **The demo without its notices.** In Claude Code and the Claude app, run `/inbox demo recording`. In Codex, build the tab with `INBOX_DEMO_RECORDING=1` in the VM's copy, then press Show demo. Either way the demo shows no notice line, no "Demo:" prefix, no Hide demo and no sample note. Never commit `plugin/dist` from that build. The VM needs a build of the inbox with this mode, which isn't released yet.
2. **The recorder.** `record.swift`, compiled to `out/record`, records the VM's window with ScreenCaptureKit and writes the host time of its first frame. A change in the VM shows in the recording within about 30 ms, with no pointer movement needed.
3. **The hand.** `hand.js` runs in the VM, reads commands over one SSH connection, and posts each key or click within a few milliseconds.
4. **Beat 11.** `drive.py <app>` plays the timeline's clicks for one app and logs them. Each click goes early by its lead, so its result shows on time. The leads in `LEADS` are measured from the takes. They differ between takes by up to 0.1 s, so read the frames around each click after a take. Start each take from a fresh demo, and wait about 5 s for the sample's answered row to settle:
   - **Claude Code.** `/inbox demo recording` turns the demo off. Run it again to start fresh.
   - **The Claude app.** Start a new session and send one message. Then send `/inbox demo recording`. As a session's first message, `/inbox` is not recognized as a command.
   - **Codex.** The demo lives in the server's memory, one per conversation. Quit and reopen the ChatGPT app to start fresh, then press Show demo in the same conversation.
5. **Beats 7 to 10.** They come from a real Claude Code session on Haiku, in a sample checkout project in the VM, `~/storefront`. `act.py` sends each command and logs it on the recorder's clock. The project's settings deny Claude Code's question dialog, so Claude asks in its reply and the inbox records the question.
   - **Before the take,** a setup prompt seeds the inbox with one question, one issue and one opportunity: "Read src/checkout.js and src/cart.js. Don't change code yet. Ask me one question: should the receipt email show the tax line on its own? If you notice a bug, or a chance to improve something, in those two files, record it as a finding." A prompt that also named the files they import gave extra issues.
   - **The take's prompt** is "Rename chargeCard to createPayment in src/payments/stripe.js and its callers, keeping chargeCard as an alias for now. Run the tests, summarize the change file by file, then ask me whether to keep the alias for one release." When the prompt asked the question first, the agent answered it itself and no question arrived.
   - **Click the prompt before typing.** The inbox pane keeps focus after a click in it, and a typed letter there presses the answer with that key.
6. **The cut.** `cut.py` crops a take to its app window, resamples it to 60 fps, covers the Codex account picture, and writes the clip's size and window to `src/takes.json`.

### Before the final recording

- Replace the drawn thread's text with text from a real session.
- Release main, so the inbox in the video is the one viewers install.
- Record the terminal takes again. Terminal.app now draws the docked tabs without half blocks, and the takes still show the seam those left.
- Buy Remotion's Company License before the video is published. The free license covers individuals and companies of up to 3 people, and a company publishes this video. Until then, the animatic uses the free license's evaluation terms.

## Music

The music is "Focus Flow", minimal 4/4 IDM at about 123 BPM, made by Pete in Suno. A bar is 1.95 s. The video starts 0.4 s into the track, so the track's own shape follows the story:

- **Beats 1 to 6:** it builds slowly as the replies pile up.
- **Beat 7, at 31 s:** the full groove comes in as the inbox first appears.
- **Beat 10, from 56.4 s:** it breaks down.
- **Beat 11, at 62.2 s:** the groove comes back as the three apps push in.
- **The end card:** it fades out over the last 4 s.

`MUSIC` in `launch-video/src/timeline.ts` holds the file, the offset and the fade. The file is `launch-video/public/music/focus-flow.mp3`, and Git ignores that folder, because the track is for the post and not for sharing in this repo.

Suno's terms grant commercial use only on a paid plan. Pete confirmed the track was made on one.

## Open decisions

1. **The PR beat and the Fix beat.** Both are out of this draft. The story is about the conversation, and the new opening added 20 seconds. Either can come back.
