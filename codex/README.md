# Inbox for Codex

The inbox as a plugin for the Codex desktop app. It keeps one list of what
waits on you in a conversation: Codex's questions, the tasks only you can do,
and the findings Codex recorded. The list shows in
an Inbox tab beside the conversation, and its buttons send your answer to
Codex as your own message.

Status: built. The tab runs in the Codex desktop app. Presses, Dismiss, Undo
and row switching were checked there on 2026-10-10. After a reinstall, the
server reloads its handler without restarting the app.

## Install

```sh
codex plugin marketplace add petekp/inbox
codex plugin add inbox@inbox
```

Without a `codex` command on your PATH, run the one inside the desktop app:

```sh
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
```

Then, in the desktop app:

1. Trust the plugin's hooks when Codex asks. Codex runs a plugin's hooks only
   after you trust them, and asks again after an update that changes them.
   The hooks give Codex the inbox at each prompt, record what it does, and
   update the inbox after each reply.
2. Open the Inbox tab beside the conversation.

## What it costs

After each reply, the plugin asks a model to update the inbox. It runs the
`codex` binary inside the desktop app, so it uses your Codex sign-in and
counts toward your plan's usage: about 16,000 input tokens per reply, most of
them the base instructions every `codex exec` call includes.

## Needs

- The Codex desktop app on macOS. The hooks and the plugin's server run on
  the Node.js the app ships with, or on `node` from your PATH outside the app.

## Working on it

The source is in `src/`, and the plugin Codex installs is `plugin/`. The
plugin shares `ledger.ts`, `presses.ts`, `tools.ts` and `demo.ts` with the
Claude Code mod in `../hooks`, and esbuild bundles them into
`plugin/dist`. The bundles are committed, since an install copies the folder
and runs no build.

```sh
npm ci           # once
npm run build    # after changing src/ or the shared modules
npm test
```

A change shows in Codex after `npm run build`, a reinstall with
`codex plugin add inbox@inbox`, and a new chat. Each build gives the tab's
page a new address, so Codex does not reuse its saved copy.

To change the tab or the server while you watch them, run `npm run dev`. On
each save it rebuilds the tab's page and the server's handler, and points the
installed plugin's server at both. An open Inbox tab swaps to the new page
within a few seconds, and the server's next call runs the new handler. The
tab can swap only if its own page came from a build that has this feature.

Codex keeps a plugin's server process running across reinstalls and new
chats. That process is a small loader, `src/server-main.ts`, which imports the
handler, `dist/server-handler.mjs`, again whenever its file changes. So a
build and a reinstall take effect without restarting Codex. Only a change to
the loader itself needs Codex quit and reopened. The tab says when its page
and the running handler come from different builds.

`../scripts/check.sh` checks the bundles are current, the types and the
tests. The design and what was measured are in
[docs/plans/codex-plugin.md](../docs/plans/codex-plugin.md).
