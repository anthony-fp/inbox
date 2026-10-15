# inbox

The inbox gathers what waits on you in an agent session into one organized
place beside the conversation: the agent's questions, tasks only you can do,
issues and ideas it noticed, and your PRs. An agent here means Claude or
Codex. The inbox runs in three places:

- **Claude Code in the terminal**, as a mod. Type `/inbox`.
- **Code sessions in the Claude desktop app**, as the same mod, in a pane
  beside the conversation.
- **The Codex desktop app**, as a plugin, in an Inbox tab in the side panel.

Each place draws the inbox in its host app's own style. The rules are the
same in all three.

[https://github.com/user-attachments/assets/560f80be-e6fb-484e-8a3f-7b4828b98fb2](https://github.com/user-attachments/assets/aae4edc0-a0dc-44d5-9851-7fd1d80499ee)

## Install

### Claude Code

In a Claude Code session in the terminal, type:

```
/plugin install inbox --marketplace petekp/inbox
```

Answer `y` to add the marketplace, then choose a scope. It starts working in
that session. A user-scope install also covers Code sessions in the Claude
desktop app on this machine.

To install from the desktop app instead, open a Code session and choose
+ > Plugins > Add plugin, then Manage plugins. `/plugin` does not run there.
The inbox does not reach the app's cloud sessions.

To update, run these, then `/reload-plugins` in any session that's already
open:

```sh
claude plugin marketplace update inbox
claude plugin update inbox
```

- It makes one Sonnet call after each of Claude's replies. See [Cost](#cost).
- It was built and tested with Claude Code 2.1.296.

### Codex

```sh
codex plugin marketplace add petekp/inbox
codex plugin add inbox@inbox
```

Then, in the Codex desktop app, trust the plugin's hooks: click the hook icon
beside the prompt's approval setting, then Allow all. Codex runs a plugin's
hooks only after you trust them. To open the inbox, press + at the top right
of the window, then choose More tools, then Inbox.

[codex/README.md](codex/README.md) covers updating and running the `codex`
command from inside the app.

### For both

The PRs tab needs the GitHub CLI, `gh`, signed in.

## Using it

Type `/inbox` in Claude Code, or open the Inbox tab in Codex. The inbox has
three tabs:

- **Needs you**: questions the agent asked you, and tasks only you can do.
- **Findings**: bugs, risks and ideas the agent noticed outside the task it's
  working on.
- **PRs**: pull requests from this session and your current branch, what's
  blocking each one, and review comments waiting on you.

Each item shows what you can do with it. Press an answer's button and it goes
to the agent as your message. You can also have the agent fix a finding, mark
a task done, or dismiss anything you don't need.

When the tab you're on is empty and something new arrives on another tab, the
inbox switches to it.

### In each app

- **Terminal:** each action shows the letter that runs it. `1`, `2` and `3`
  switch tabs, and `j` and `k` move up and down. ctrl+x tab moves focus from
  the prompt to the line above it, then to the panel, then back to the prompt.
- **Claude desktop app:** you click. `/inbox` sent as the first message of a
  new session is not recognized as a command. Send it after the first
  message.
- **Codex:** you click, or use the terminal's keys. The tab shows no letters.

In Claude Code, a line above your prompt counts what needs you and the
findings waiting, with a button that opens the panel. When Claude stops on an
error, the stop shows on a second line. Codex has no such line.

To see every part with sample items in Claude Code, run `/inbox demo`. Presses
on them change only the samples and send nothing. Press Hide demo, or run the
command again, to go back to your own items. `/inbox demo recording` shows the
same samples without the notices that mark them, for recording a video. Run
`/inbox demo` to end it.

## Cost

You might be wondering how many extra tokens the inbox uses.

In Claude Code, it adds two things:

| What the inbox adds | Tokens | Cost at API prices |
|---|---|---|
| A Sonnet call after each of Claude's replies, to update the inbox | 3–4k in, about 2k of it cached. 100–250 out. | About 0.5¢ per reply, or 1¢ after 5 idle minutes |
| Its instructions and tools, sent with every request Claude makes | About 1,350, cached | Under 0.1¢ per request |

In one long Opus session, this came to about 1% of the total cost. A shorter
or cheaper session pays a larger share. On a Claude plan, these count toward
your usage limits.

In Codex, the update after each reply runs through the `codex` binary inside
the desktop app, with your Codex sign-in. It uses about 16,000 input tokens
per reply, most of them the base instructions every `codex exec` call
includes. It counts toward your plan's usage.

## What it runs, sends and changes

This covers the Claude Code mod. [codex/README.md](codex/README.md) covers
the Codex plugin.

**What leaves your machine.** Three things, and nothing else:

- After each of Claude's replies, the inbox sends one Sonnet request to
  Anthropic through Claude Code's own model connection. It holds your last
  prompt, Claude's reply, the inbox's open items, and a line for each tool
  Claude ran. A tool line reads like `ran: npm test` or
  `edited src/app.ts`. [Cost](#cost) gives the request's size.
- When the inbox may have missed a turn, it asks the same model to update it
  from the whole conversation. It forks the conversation for this, or reads
  the transcript after a resume.
- To fill the PRs tab, it runs read-only `gh` queries: `gh pr view`, and
  `gh api graphql` for review threads. They reach GitHub under your own `gh`
  sign-in. The inbox never reads your GitHub token.

**Programs it starts.**

| Program | When |
|---|---|
| `gh` | To fill the PRs tab |
| `open` | When you press a button that opens a link, file or folder |
| `test -x` | Before opening a file. An executable file is shown in Finder, not run. |
| `herdr pane report-metadata` | Only inside the Herdr terminal, to show the inbox's counts in its sidebar |

**Messages it sends as you.** When you press an answer or action button, the
inbox sends Claude a message in your name. The message is the answer you
chose, or a request about the item, such as asking Claude to fix a finding.
Resume, on a stopped turn, sends `Continue`. Every message it sends starts
from a press. When you mark a task Done that Claude is waiting on, the inbox
tells Claude a few seconds later, or once Claude's running turn ends.

**What it adds to Claude's context.**

- Its instructions, about 1,350 tokens, in every request.
- A note beside your prompt when you answer one of Claude's numbered
  questions, or when the inbox changed since Claude last saw it.
- Its open items after the conversation is compacted, so Claude keeps them.

**What its hooks see.**

- Tool calls. The inbox reads each call to write the tool lines above, to
  show a question while Claude's question dialog is open, and to find a PR
  this session opens with `gh pr create`. It passes every call on unchanged,
  except calls to its own two tools. `record_finding` saves a finding and
  `close` closes an item. The inbox answers these itself, so they run
  without a permission prompt.
- Permission prompts. While Claude Code asks you to approve a tool call, the
  inbox shows a row for it, then passes the request on unchanged. It never
  approves or denies a permission prompt.
- Tool descriptions. It lists its own two tools to Claude up front, instead
  of behind tool search. It leaves other tools' descriptions alone.
- Shell commands you run with `!`, and their output. A command that runs
  with nothing on stderr closes a task that asked you to run it.
- Session starts. After `/clear`, a resume or a fork, the inbox loads that
  conversation's items. It passes the event on unchanged.
- Your theme setting, to match its colors.

It also adds the `/inbox` command, and keeps its items in Claude Code's
plugin storage on this machine.

## Developing

Read [AGENTS.md](AGENTS.md) first. [docs/looks.md](docs/looks.md) says which
file owns each rule and where the three apps differ on purpose.

Run the mod from a clone:

```sh
claude --plugin-dir /path/to/inbox
```

The session reloads the mod when you change one of its files.

The Codex plugin shares the rules in `hooks/` with the mod. Rebuild its
bundles after changing either:

```sh
npm --prefix codex ci         # once
npm --prefix codex run build
```

[codex/README.md](codex/README.md) covers trying a build in Codex.

`./scripts/check.sh` runs Prettier, `claude plugin validate`, a type check and
the tests, and checks the Codex bundles are current. The type check needs the
types Claude Code writes to `.claude-plugin/types/` the first time it loads
the mod.
