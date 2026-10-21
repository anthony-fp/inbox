# Scripted release pass

Status: proposed. Nothing in it is built.

The live pass in [release.md](../release.md) step 4 is run by hand in a macOS VM, one look at a time. It takes about three hours, and it gets longer with each client the inbox adds. This plan makes it a script: one list of rows, a driver for each look, and a checker that decides each row from evidence. It also moves the checks that do not need a real app out of the VM.

## What the pass misses now

- **The build.** Each look is checked on whatever commit exists when its turn comes. The bump commit always comes after the pass, so no look is ever checked on the exact commit that ships.
- **The install.** The pass loads the build from a plugin folder, or in omp with `-e`. People get the inbox from a marketplace, and most of them get 0.2.10 as an update from 0.2.9. That update is never tried.
- **The model.** A new install of Claude Code in the VM runs Haiku. The agent's side of a row, such as recording a question, is checked on a smaller model than most people use.
- **The verdict.** Whoever drives a row also writes its verdict. Nothing checks the verdict against the evidence.
- **The machine.** Each run backs up the VM's saved state and restores it by hand afterwards. A missed restore leaks into the next run.

## Three layers

Each check runs in the cheapest place that can catch what it is for.

| Layer | Checks | Runs | Exists now |
| --- | --- | --- | --- |
| 1. Drawing snapshots | What each look draws for each row state, from saved state, with no model and no app | On the host, in `check.sh` | Partly. omp's `render()` in `omp/src/panel.ts` returns text lines. The mod's tests mount trees with `$.ui.mount` but cannot print one. The Codex tab has only happy-dom tests. |
| 2. Agent evals | Whether each agent records and closes as the guidance says | On the host, `./scripts/eval.sh` | Yes |
| 3. Live pass | What only the real app shows: install and update, hooks, a press reaching the agent, saved state from the last release, layout in the app's own engine, and the app's own UI around the inbox | In VM clones, scripted | By hand |

Layer 1 does not replace layer 3. This release's pass found two bugs, and layer 1 would have caught neither:

- **The desktop reply field's Discard button ran off the pane.** That is the Claude app's own layout engine at its narrowest pane. `$.ui.mount` does not run that engine. The desktop rows in layer 3 keep a capture at the narrowest pane, read against the row's expected result.
- **A question dismissed in omp's dialog showed only after the next message.** That came from the order in which omp sends its events when a dialog is cancelled. It needs the real omp. A stand-in model can still drive it: the model only asks the question, and omp itself runs the cancel.

## Repeatable model turns

A row such as Finding needs an agent turn. A real model answers differently each run, costs plan usage, and takes a minute. A stand-in model server returns a scripted answer for each row instead. It replaces only the model: the agent, the app and the inbox stay real.

The server answers two kinds of call:

- **The agent's turns.** For example: "call `record` with this finding, then reply with this text".
- **The inbox model's calls.** After each reply, the inbox asks a model to update its rows. That is `$.model.complete` in the mod, `codex exec` in Codex and the `inboxModel` in omp. They go through the same model endpoint, so the server must answer them too, in the format the inbox expects.

Each agent speaks a different protocol, and whether each one accepts a stand-in is the open question this plan depends on:

| Agent | How it would reach the server | Known |
| --- | --- | --- |
| Claude Code in a terminal | `ANTHROPIC_BASE_URL`, with an API key in its own config folder | Documented, not yet tried here |
| Claude Code in the Claude app | Signed in through the app | Unknown |
| Codex in the ChatGPT app | A custom model provider in `config.toml`, OpenAI Responses protocol | Unknown whether the app honors it |
| omp | A custom provider | Unknown |

Where the probe fails, the fallback for that look is:

- seed the inbox's saved state directly, for the rows about drawing and presses;
- keep real model turns, on the model the evals use, for the rows that need the agent: Question, Finding, Dialog and Resume.

Every look keeps one real-model turn in every run, so the wiring to a real model is checked even where the stand-in works.

## A fresh VM for every run

One base VM holds:

- the apps signed in, and `gh` signed in;
- a sample project whose GitHub remote has an open PR;
- the previous release installed from its marketplace, as a person installs it;
- at least four sessions with saved state in each agent.

Each run clones the base (Tart clones are copy-on-write and take seconds), boots the clone, runs and deletes it. There is no backup and no restore. After each release, the base is rebuilt with that release as the new "previous release".

A sign-in in the base expires eventually. Every run starts with a check row that each agent is signed in, so an expired sign-in fails in the first minute instead of halfway through.

The harness stops only the VMs it started, by their process id. Other sessions use VMs on the same Mac.

## Parallel runs

macOS runs at most two macOS VMs at a time on one Mac, and other projects use VMs too. When two are free, the run splits:

- **Clone A: terminal and omp, side by side.** Each runs in its own tmux session with its own config folder or `HOME`. Neither needs the screen.
- **Clone B: the Claude app, then the ChatGPT app.** Their drivers post real input events, so only one app can have them at a time. The release doc already says to quit the other app.

When only one VM is free, the clones run one after the other.

The same terminal and omp drivers also run on the host, with their own config folder and the stand-in model, as `mods/scripts/live.sh` in petekp/claude-code-setup does today. That is a fast loop while building. The release pass itself stays in the VM, so it cannot touch a real inbox.

## Rows as data

The rows in release.md step 4 become one data file, `scripts/release-pass/rows.json`. Each row names:

- the looks it runs in;
- its setup: seeded state, scripted turns, or a real turn;
- its steps, in terms of the inbox, such as "press Explain on the finding";
- what it expects: a condition on the saved state, text on screen, or a capture to read;
- the moments to capture.

`check.sh` checks that the table in release.md and the rows file list the same rows. The omp-only rows and the Codex session-pruning check go in the file too.

Each look has a driver that turns the steps into input:

| Look | Input | Reads the screen with |
| --- | --- | --- |
| Terminal | tmux keys, and mouse clicks as live.sh sends them | `tmux capture-pane` text |
| omp | tmux keys | `tmux capture-pane` text |
| Claude app | Accessibility: press a button by its label, without moving the pointer. Pointer events for the inbox's tab bar, which shows no accessibility buttons. | The accessibility tree's text, and window captures |
| ChatGPT app | Accessibility if the Inbox tab's web content shows in the tree; pointer events if not | Same, if exposed |

Finding a button by its label survives app updates that move things. Coordinates do not.

Adding a client means writing its driver and marking the rows it runs.

## Evidence and verdicts

For each row, the driver keeps:

- the saved state before and after;
- the screen text;
- timestamped captures;
- the agent's transcript.

The checker decides each row from that evidence, not the driver. A row whose condition is on saved state or screen text passes or fails mechanically. A row that needs eyes, such as layout at the narrowest pane, goes to a reviewer that did not drive it. The reviewer reads the capture against the row's expected result and names the capture in its verdict. A row with no evidence fails. The report lists each row's verdict, its evidence, and the states nobody saw.

The run's folder stays outside the repo, since captures can show private data.

## Release order

The bump moves before the pass:

1. Commit the bump on a candidate branch: the five version fields, the rebuilt bundles and `check.sh`.
2. Run the evals and the scripted pass on that commit, installed in each agent as an update from the previous release.
3. Write the release notes, push the same commit, tag it and publish.

The pass then runs on the exact commit that ships. Any change after it means a new candidate and a new run.

## Steps

1. **Probes**, before anything is built. Each answer picks a path above.
   - Does the stand-in model server work in each agent, including the inbox model's call?
   - Do the Claude app's inbox pane and the ChatGPT app's Inbox tab show in the accessibility tree inside the VM?
   - Does each agent update from 0.2.9 to a local candidate the way it updates from GitHub?
   - How long does a clone take, and how much disk does a run use?
2. **The base VM and the clone scripts.**
3. **The rows file, the checker, and the terminal and omp drivers.** Run them on the host, then in a clone.
4. **The 0.2.10 pass.** Terminal and omp are scripted. The Claude app and the ChatGPT app run by hand under the same rules: marketplace update, the evals' model, and a reviewer reads every capture.
5. **The Claude app and ChatGPT app drivers.**
6. **Layer 1.** Snapshot tests for omp's text lines, a printer for the mod's trees, and the Codex tab in a headless browser. Add them to `check.sh`.
7. **release.md** points at the harness and the new order.

## What needs approval

This is release tooling, so each piece needs Pete's yes before it is built:

- a new folder, `scripts/release-pass/`, with the rows file, the drivers, the checker and the clone scripts;
- the stand-in model server;
- additions to `check.sh`: the rows-file check and the layer 1 snapshots;
- release.md: the new order and the harness steps;
- the base VM image, which lives outside the repo.

## Costs and risks

- **Building.** Several days of agent work. The probes come first, so nothing is built on a stand-in that an app ignores.
- **Upkeep.** The Claude app updates itself, and an update can break a driver. Labels hold up better than coordinates, but a broken driver still blocks a release until it is fixed.
- **Drift.** Scripted turns show what the inbox does with a given turn, not what a real model would do. The real-model turn in every look and the evals cover that.
- **Shared VMs.** Two at a time on one Mac, shared with other projects, so a run sometimes waits.
