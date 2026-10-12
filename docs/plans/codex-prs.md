# A PRs tab in Codex

Status: built. `gh` runs from the server: the shared fetch, run with the PATH the Codex app gives the server, found `gh` and its sign-in, a linked PR and the branch's PR. Not yet seen in the Codex app: the PRs tab drawing those views, and a PR press sending its message.

The Codex Inbox tab gets the PRs tab the Claude panes have. It lists the PRs the conversation links and the current branch's PR, each with its verdict, its review threads and its failing checks, and the same buttons. A press sends Codex the same message it sends Claude.

## What is shared

The PR rules move out of `hooks/register.tsx` into a new shared module, `hooks/pr-tab.ts`, which both hosts import. One copy of each rule means a fix in one host reaches the other.

- **Fetching:** `fetchPr` and the fetch of every tracked PR take a `gh` runner and a clock instead of the Claude engine. Each host passes its own runner.
- **Tracking:** `isTracked`, `isDismissing`, `drawnPrs` and `threadSentIn` decide which PRs show and which threads were handed off.
- **Presses:** `applyPrPress` and `prRetryOf`, with the row ids `prThreadId`, `prCheckId` and `prMarkId`. The messages stay in `prompts`.
- **Order and status:** `inPrOrder`, `readiness` and `prNeedsYou`, as now.

The ledger already keeps the PRs a conversation links, in `ledger.prs`, for both hosts.

## What Codex adds

- **State:** `SessionState` gains `prViews`, the saved `PrViews`. `upgraded` in `codex/src/state.ts` fills it for state saved before.
- **Fetching:** the server runs `gh` through `deps.exec` in the session's folder. A view request starts a fetch when the last one is over 2 minutes old, or on the first view, and returns at once. The tab shows "Checking for PRs…" while it runs.
- **Finding gh:** the desktop app may start the server without Homebrew on its PATH. The server tries `gh`, then `/opt/homebrew/bin/gh`, then `/usr/local/bin/gh`. When none runs, the tab says gh was not found.
- **Presses:** `inbox_press` takes PR presses too. A send goes through `codex queue`, as a row press's does. An open goes through the existing local open.
- **Tab:** a third tab, PRs, with its count in the PR blue. Each PR block follows the panes: the number and title, the verdict word in its tone with its reasons one per line, the actions, then "Review threads · N" and "Failing checks · N". Every PR is a block in that order, so each keeps its Open PR button.
- **Demo:** the demo state gains the mod's demo PRs, so the demo shows the tab without `gh`.

## Not changed

- The messages Codex reads. `prompts` already names no agent.
- The Claude panes' behavior. Their code calls the shared functions instead of its own copies.

## Checks

- `./scripts/check.sh`, with tests for the shared fetch and press rules moved alongside them.
- The tab in a headless browser with the demo state.
- In the Codex app: the PRs tab in a chat on a branch with an open PR, and one PR press. This is the one part a harness cannot show.
