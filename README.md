# Inbox

A stable place beside your agent's chat for everything that waits on you: its questions, the tasks only you can do,
and the bugs and ideas it noticed on the way.

This is [anthony-fp/inbox](https://github.com/anthony-fp/inbox), a fork of
[petekp/inbox](https://github.com/petekp/inbox) by Pete Petrash. It installs and works like the original, and adds the
changes listed under [This fork](#this-fork).

https://github.com/user-attachments/assets/a493119c-4d8b-46e0-a18a-bd0ecf041b6b

## Quick start

For Claude Code in the terminal:

1. Install the plugin:

   ```
   /plugin install inbox --marketplace anthony-fp/inbox
   ```

2. Open the pane:

   ```
   /inbox
   ```

3. Open it in every new session with one word. Add this line to `~/.zshrc` or `~/.bashrc`:

   ```sh
   alias ci='claude "/inbox"'
   ```

   Then run `source ~/.zshrc`, and start sessions with `ci`. See [Open the inbox at launch](#open-the-inbox-at-launch).

## Why

A long chat with an agent piles up questions, bugs, ideas and tasks in one scrolling thread, and you must hold all of
them in your head. The inbox lifts each one out of the thread into a list that stays put.

- The agent does not have to do anything special. After each reply, a model reads what the agent wrote and records each
  question, with its answers. The recommended answer comes first.
- Each item comes with buttons for what you can do next: answer, explain, fix, dismiss.
- The agent gets a place to record problems it saw outside the task, which it would otherwise skip to stay on topic.

## This fork

The fork adds to the Claude Code looks, in the terminal and the desktop app. Codex and omp keep the original tabs.

| Change                                                                                      | Status                           |
| ------------------------------------------------------------------------------------------- | -------------------------------- |
| Install commands and links point to `anthony-fp/inbox`                                      | Done                             |
| Open the inbox at launch with `claude "/inbox"`                                             | Done                             |
| **Now** tab: what needs you, the session's plan, and findings, in one list                 | Done                             |
| **Plan**: Claude keeps a checklist for work of three or more steps, and the pane shows it   | Done                             |
| **Files** tab: the documents, artifacts and links the session made, with open and dismiss   | Done                             |

## Install

You can also paste a link to this repo to your agent and ask it to install the inbox.

### Claude Code

In a Claude Code session in the terminal, type:

```
/plugin install inbox --marketplace anthony-fp/inbox
```

Answer `y` to add the marketplace, then choose a scope. It starts working in that session. A user-scope install also
covers Code sessions in the Claude desktop app on this machine.

To install from the Claude desktop app instead, open a Code session:

1. Click **+** beside the prompt, then **Add plugins**.
2. In the Directory, click **+** at the top right, then **Add from a repository**.
3. Enter `anthony-fp/inbox` and click **Sync**.
4. Click **+** on Inbox.

This installs it for your user account, so it works in the terminal too. `/plugin` does not run in the desktop app, and
the inbox does not reach the app's cloud sessions.

If your organization manages Claude Code, an inbox you install yourself works only in part. Claude Code skips the hooks
it uses to add to what Claude reads, so Claude gets neither the inbox's instructions nor its list of what waits on you.
The inbox also keeps the old conversation's list after `/clear` or a resume, and shows no permission prompts or failed
turns. Questions, tasks and findings still reach it. To get everything, ask an admin to list the inbox in your
organization's managed settings.

To update, run these, then `/reload-plugins` in any session that's already open:

```sh
claude plugin marketplace update inbox
claude plugin update inbox
```

- It makes one Sonnet call after each of Claude's replies. See [Cost](#cost).
- It was built and tested with Claude Code 2.1.300.
- The PRs tab needs the GitHub CLI, `gh`, signed in.

### Open the inbox at launch

`claude` takes a first prompt as its argument, and `/inbox` is ready before that prompt runs. So this starts a session
with the pane already open:

```sh
claude "/inbox"
```

To make it the default, add an alias to your shell's startup file, then open a new terminal:

| Shell     | File                          | Line                                      |
| --------- | ----------------------------- | ----------------------------------------- |
| zsh       | `~/.zshrc`                    | `alias ci='claude "/inbox"'`              |
| bash      | `~/.bashrc`                   | `alias ci='claude "/inbox"'`              |
| fish      | `~/.config/fish/config.fish`  | `alias ci 'claude "/inbox"'`              |

Plain `claude` still starts a session without the pane. In the Claude desktop app, type `/inbox` in the session; the app
has no launch command.

### Codex

```sh
codex plugin marketplace add anthony-fp/inbox
codex plugin add inbox@inbox
```

Then, in the ChatGPT desktop app, trust the plugin's hooks: click the hook icon beside the prompt's approval setting,
then Allow all. Codex runs a plugin's hooks only after you trust them. To open the inbox, press + at the top right of
the window, then choose More tools, then Inbox.

[codex/README.md](codex/README.md) covers updating and running the `codex` command from inside the app.

### omp

```sh
omp plugin marketplace add anthony-fp/inbox
omp plugin install inbox@inbox-omp
```

The inbox starts working in the next omp session. To update, run
`omp plugin marketplace update inbox-omp` and `omp plugin upgrade inbox@inbox-omp`, then restart omp.

After each reply, the inbox makes one model call to update the list. It uses the first of these that your omp can run:

1. The model your `@inbox` role names, under `modelRoles` in omp's `config.yml`.
2. The newest Sonnet from your providers, `anthropic` first.
3. Your `@smol` role.

Only Sonnet is tested. Your provider bills each call at that model's rate. The panel's footer shows the model it uses,
or "no inbox model: set @inbox" when it has none.

## Using it

Type `/inbox` in Claude Code or omp, or open the Inbox tab in the ChatGPT app. The inbox has three tabs.

In Claude Code the tabs are Now, Files and PRs. Now holds Needs you, the plan and Findings in one list. Codex and omp
still have the tabs Needs you, Findings and PRs. They have no plan and no Files tab.

### Needs you

Questions the agent asked you, and tasks only you can do.

Press an answer and it goes to the agent as your message. You can also type your own reply, or press Explain to have
the agent say more before you decide.

A task is something like signing in or adding an API key. It comes with buttons for its steps, such as copying a
command or opening a file. In Claude Code, running the command with `!` closes the task once it succeeds.

### Findings

Bugs, risks and ideas the agent noticed outside the task it's working on. The agent records them and carries on with
its task, and you decide later which ones to act on.

- **Fix** on an issue, or **Do it** on an idea, hands it to the agent.
- **File issue** has the agent file it in your issue tracker, such as Linear or GitHub, or link the issue that already
  covers it.
- **Reply** sends your own words about it.
- **Explain** has the agent say why it matters and what fixing it would involve, without acting.
- **Discuss** talks it through, and **Dismiss** drops it.

### Plan

For work of three or more steps, Claude Code keeps a checklist and Now shows it between Needs you and Findings. A step
is waiting, in progress or done. The plan file lives in `.inbox/plans/` in your worktree, and Git ignores `.inbox/`.
Claude sees the plan beside each of your prompts, and again after the conversation is compacted.

### Files

The documents, artifacts and links this session made (Claude Code only). It lists files Claude wrote (.md, .html, .pdf,
.png, .jpg, .svg and .csv), the plan file, Artifact publishes, and files or links Claude adds for you to see.

- **Open**, **Finder** and **Copy path** act on a file. A link has **Open** and **Copy link**.
- **Dismiss** hides a row. Dismissed rows fold under "Dismissed", and **Restore** brings one back.
- Only http and https links open.

### PRs

Pull requests from this session and your current branch. Each one is marked Blocked, Ready or Waiting, and lists what
blocks it: review comments waiting on you, failing checks and merge conflicts. Buttons hand the work to the agent:
address one review comment or all of them, draft a reply, fix a failing check, resolve conflicts, or merge.

### It keeps itself up to date

When you answer a question in your own message, a task gets done, or the agent fixes a finding, the inbox closes the
item. Closed items fold away under the open ones, each with how it ended.

The agent reads the inbox too. Beside each of your prompts, it sees what's still open and what you answered, even after
the conversation is compacted.

Every press shows what it did right away. Discuss reads "Discussing…" until the agent replies, then "✓ Discussed".

### In each app

- **Terminal:** each action shows the letter that runs it. `1`, `2` and `3` switch tabs, and `j` and `k` move up and
  down. ctrl+x tab moves focus from the prompt to the line above it, then to the panel, then back to the prompt.
- **Claude desktop app:** you click. Type `/inbox` to open the pane.
- **ChatGPT app:** you click, or press the same keys as in the terminal. The tab shows no letters.
- **omp:** `/inbox` opens the panel over the conversation, and esc closes it. Each action shows the letter that runs
  it, and Reply is `r`. Arrow keys move between rows and between a row's buttons, and enter presses the focused button.
  Tab, or `1`, `2` and `3`, switch tabs.

In Claude Code, a line above your prompt counts what needs you and the findings waiting, with a button that opens the
panel. When Claude stops on an error, a second line says why, with a Resume button after an API error. The ChatGPT app
has no such line. omp has a line with the same counts, and no stop line. Inside the Herdr terminal, the counts also show
in its sidebar.

To see every part with sample items in Claude Code, run `/inbox demo`. Presses on them change only the samples and send
nothing. Press Hide demo, or run the command again, to go back to your own items. `/inbox demo recording` shows the same
samples without the notices that mark them, for recording a video.

## Cost

In Claude Code, the inbox adds two things:

| What the inbox adds                                               | Tokens                                          | Cost at API prices                               |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| A Sonnet call after each of Claude's replies, to update the inbox | 3–4k in, about 2k of it cached. 100–250 out.    | About 0.5¢ per reply, or 1¢ after 5 idle minutes |
| Its instructions and tools, sent with every request Claude makes  | About 1,350, cached                             | Under 0.1¢ per request                           |

In one long Opus session, this came to about 1% of the total cost. A shorter or cheaper session pays a larger share. On
a Claude plan, these count toward your usage limits.

In Codex, the update after each reply runs through the `codex` binary inside the desktop app, with your Codex sign-in.
It uses about 16,000 input tokens per reply, most of them the base instructions every `codex exec` call includes. It
counts toward your plan's usage.

## What it runs, sends and changes

This covers the Claude Code mod. [codex/README.md](codex/README.md) covers the Codex plugin. The omp extension runs the
same `gh` queries. Its update request goes through omp's own connection to the provider of the model it uses, and holds
the same things as the Claude Code request.

**What leaves your machine.** Three things, and nothing else:

- After each of Claude's replies, the inbox sends one Sonnet request to Anthropic through Claude Code's own model
  connection. It holds your last prompt, Claude's reply, the inbox's open items, and a line for each tool Claude ran. A
  tool line reads like `ran: npm test` or `edited src/app.ts`. [Cost](#cost) gives the request's size.
- When the inbox may have missed a turn, it asks the same model to update it from the whole conversation. It forks the
  conversation for this, or reads the transcript after a resume.
- To fill the PRs tab, it runs read-only `gh` queries: `gh pr view`, and `gh api graphql` for review threads. They reach
  GitHub under your own `gh` sign-in. The inbox never reads your GitHub token.

**Programs it starts.**

| Program                      | When                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `gh`                         | To fill the PRs tab                                                       |
| `open`                       | When you press a button that opens a link, file or folder                 |
| `test -x`                    | Before opening a file. An executable file is shown in Finder, not run.    |
| `herdr pane report-metadata` | Only inside the Herdr terminal, to show the inbox's counts in its sidebar |

**Messages it sends as you.** When you press an answer or action button, the inbox sends Claude a message in your name.
The message is the answer you chose, or a request about the item, such as asking Claude to fix a finding. Resume, on a
stopped turn, sends `Continue`. Every message it sends starts from a press. When you mark a task Done that Claude is
waiting on, the inbox tells Claude a few seconds later, or once Claude's running turn ends.

**What it adds to Claude's context.**

- Its instructions, about 1,350 tokens, in every request.
- A note beside your prompt when you answer one of Claude's numbered questions, or when the inbox changed since Claude
  last saw it.
- Its open items after the conversation is compacted, so Claude keeps them.

**What its hooks see.**

- Tool calls. The inbox reads each call to write the tool lines above, to show a question while Claude's question
  dialog is open, and to find a PR this session opens with `gh pr create`. It passes every call on unchanged, except
  calls to its own two tools. `record` saves a question, a task or a finding and `close` closes an item. The inbox
  answers these itself, so they run without a permission prompt.
- Permission prompts. While Claude Code asks you to approve a tool call, the inbox shows a row for it, then passes the
  request on unchanged. It never approves or denies a permission prompt.
- Tool descriptions. It lists its own two tools to Claude up front, instead of behind tool search. It leaves other
  tools' descriptions alone.
- Shell commands you run with `!`, and their output. A command that runs with nothing on stderr closes a task that
  asked you to run it.
- Session starts. After `/clear`, a resume or a fork, the inbox loads that conversation's items. It passes the event on
  unchanged.
- Your theme setting, to match its colors.

**What it keeps.** The inbox saves each session's items, and the PRs it tracks, in Claude Code's plugin storage on this
machine. It keeps the 40 most recent sessions and deletes older ones. An item can summarize part of the conversation,
so it may name the people in it. Nothing goes to the plugin's author.

It also adds the `/inbox` command.

## Developing

Read [AGENTS.md](AGENTS.md) first. [docs/looks.md](docs/looks.md) says which file owns each rule and where the four
looks differ on purpose.

Run the mod from a clone:

```sh
git clone https://github.com/anthony-fp/inbox
claude --plugin-dir /path/to/inbox
```

The session reloads the mod when you change one of its files.

The Codex plugin shares the rules in `hooks/` with the mod. Rebuild its bundles after changing either:

```sh
npm --prefix codex ci         # once
npm --prefix codex run build
```

[codex/README.md](codex/README.md) covers trying a build in Codex.

The omp extension in `omp/` shares the rules in `hooks/` too. It runs on [Bun](https://bun.sh), and omp installs it
from a bundle, so rebuild the bundle after changing `omp/src` or the shared modules:

```sh
bun install --cwd omp --frozen-lockfile --ignore-scripts   # once
npm --prefix omp run build
```

Try a build in omp with a fresh `HOME`, so it cannot touch your own omp settings or inbox:
`env HOME=/path/to/empty/folder omp -e omp/src/host.ts`.

`./scripts/check.sh` runs Prettier, `claude plugin validate`, a type check and the tests, and checks the Codex bundles
and the omp bundle are current. The type check needs the types Claude Code writes to `.claude-plugin/types/` the first
time it loads the mod. The omp checks need `bun` on your `PATH`.
