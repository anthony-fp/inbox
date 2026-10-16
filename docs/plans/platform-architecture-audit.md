# Platform architecture implementation

Status: built. Published v0.2.5 and the terminal wrapping repair are integrated. The reliability pass preserves saved records, isolates conversation changes and records explicit sends before queue submission. Codex page replacement keeps the working page until its candidate is ready. Native checks verify attachment, focus and draft retention across two page replacements, plus Dismiss and Undo.

The worktree is based on main at `a06073b`, which includes v0.2.5.
Shared modules decide row content, actions, navigation, PR help, delivery
feedback and update bookkeeping. Each look keeps its native controls,
fitting, focus and motion. [The look map](../looks.md) owns the current
module inventory and deliberate platform differences.

## Reliability pass

The pass covers accepted presses, durable state, concurrent updates and UI
recovery. Confirmed failures were reproduced before repair. Release tooling and model-facing text are unchanged by this pass.

| Subsystem | Current behavior | Evidence | Status |
| --- | --- | --- | --- |
| Explicit Codex sends and Done notifications | The session lock covers an atomic checkpoint before queue invocation. The checkpoint includes the affected rows and an unconfirmed attempt. Accepted sends become queued; ambiguous outcomes retain the attempt and draft. An unknown older attempt blocks acknowledgement of a newer identical message. | Production-server tests simulate acceptance followed by a failed final write, initial-write failure, unknown outcomes and later identical sends. No local effect runs if the initial press could not be saved. | done |
| Local effects and PR actions | Each new local press has its own result identity. Late results cannot replace newer ones, including equal-time presses. Thrown effects become visible failures. Address rejects a review thread that no longer waits; Discuss remains available. | Three reproduced failures now pass at the shared reducer and production-server boundaries. | done |
| Codex persistence and workers | Unreadable or newer-version files remain untouched and raise an error. Valid legacy state still upgrades. Update workers use the existing atomic owner-lock protocol. View reads reconcile abandoned activity under that lock without spending a retry. Contention inside an acquired callback propagates as an error. | Lock, worker, migration and failed-write tests pass, including process death and nested lock contention. | done |
| Native conversation lifecycle | Resume results belong to one stop and conversation. Model responses and saved-session loads check their owner inside state updates. Old loads cannot overwrite a newer session. | Tests hold callbacks before and after state commits and switch conversations before releasing them. | done |
| Native saved sessions | A failed replacement keeps the previous stored copy. Saves use captured session keys and commit revisions. Same-session resume waits for pending commits. Pruning uses saved timestamps and preserves unreadable or unknown-age records. | Failed writes, out-of-order completions, clear/resume, delayed reads and delayed load application all pass. | done |
| Codex page recovery | A candidate starts against a detached root. The working page remains usable until the candidate connects and active presses finish. Failed candidates are disposed; Retry or a different page can try again. Host theme changes and current drafts survive activation. | Mounted tests and real-browser checks preserve controls, host hooks, drafts and focus across failed and successful replacement. Thirteen isolated DOM probes cover response ordering, uncertainty and preparation failures. | done |
| Codex interaction state | A completed send cannot erase a newer draft. Older presses cannot clear newer feedback. Old demo responses and stale page metadata are ignored. Finding details preserve explicit line breaks. | Held-response probes pass. The browser measures three explicit finding lines in both themes. | done |

All eight repository checks pass. Independent review found and verified repairs
for the acquired-lock error, committed-save ordering and overlapping-load races.
The Claude plugin suite passes 121 tests. Live terminal and Claude desktop smoke
checks use an isolated copy of the current source. They cover startup, Reply,
draft recovery, Dismiss and Undo; terminal expiry has 77 sampled frames. Model
submissions and per-turn model updates are disabled in those live fixtures.
Concurrency and failed-effect behavior are verified by the isolated harnesses,
not by live model turns.

The repaired native Codex panel passes the attachment and interaction checks
below. Exact arrival identity and the remaining native host limits are listed
under follow-ups.

## Claude Done refusal recovery

A refused notification leaves the task Done and records why it was not sent.
Its Closed entry offers Undo. The saved notification ID prevents an old
refusal from changing a newer close, including one with the same timestamp.
Refused attempts do not send again on timers or resume.

A session switch before submission cancels the notification and restores
recovery in the original session. A refusal after submission updates that
session's saved ledger. Recovery shares the conversation-application queue
and invalidates saved snapshots read before it completes. Unrelated session
reads remain independent, so a slow old read cannot block a newer conversation.

The existing native lifecycle suite covers immediate refusal, switches before
and during submission, batches, resume, Undo and no automatic resend. Shared
press coverage checks replacement closes with identical timestamps. The full
eight-stage repository check passes on the combined main-based worktree.
Standards and behavior reviews found no remaining issues in the repair.

Live verification used synthetic tasks with a controlled refusal at the
submission boundary. Terminal at 82 by 32 and Claude desktop both showed the
refusal and restored the task through Undo. Desktop reuses its existing Undo
Client because a native Button's first click only focused it; the Client
passed single-click recovery. The built Codex page also showed the refusal
and restored the task through its production server. Native Codex attachment,
Reply, drafts, Dismiss and Undo now pass separately. The controlled refusal
remains a browser fixture. No real notification or model request was sent in
these fixtures. Temporary desktop settings were restored after verification.

## Worker status and Done notification repair

Worker activity is reconciled through the existing owned update lock.
An abandoned active update becomes a failed update awaiting the next normal
trigger; its pending exchange and retry count stay intact. A live worker keeps
its activity flag. No model call starts from a view poll.

Done notifications use the explicit-send durability boundary. Resolve the
queue command before dispatch, checkpoint the affected closes and one
unconfirmed delivery record, then invoke the queue once. A successful response
records acceptance; an ambiguous outcome or failed final write retains the
uncertain attempt. Polls and server restarts do not resend it. A failure before
dispatch leaves Undo available. Existing delivery feedback also covers Done
rows and their Closed-fold entries.

Verification covers live and killed workers, waiting exchanges, preserved
retry budgets, batched Done actions, initial and final write failures, accepted
and ambiguous queue outcomes, arrival acknowledgement, Undo and restart.
Standards and behavior reviews found no code defects. The review identified
outdated remaining-limit entries, which are corrected here. Six new
production-boundary cases failed before the repairs and pass afterward. The
combined server, update and press suites pass 67 cases. The worker test kills a
real child process while it holds the lock. Browser fixtures verify the failed
worker status, one Done notification for two tasks, queued and unconfirmed
Closed-fold feedback, and batch acknowledgement after an accepted arrival.

These runtime changes apply to Codex. Terminal and Claude desktop keep their
existing worker and submission paths; the shared renderer contract and the
full Claude plugin suite are checked. Worker failures and queue outcomes use
isolated production-boundary tests. Native Codex interaction checks are
recorded separately below.

## Implementation and release integration

Source and test conflicts are resolved. The combined build preserves the
release's inline tab column, stable pane height, background-thread exclusion,
main-session turn counting, recording demo, and Codex group and Undo motion.
It also preserves the architecture work's delivery safeguards, lock ownership,
startup readiness and visible terminal Undo. Generated Codex bundles are
rebuilt from these sources. The combined test build keeps the approved
`packages: 'external'` option; release-bundle options are unchanged.

| Concern | Current owner and behavior | Verification |
| --- | --- | --- |
| Saved state locks | `codex/src/state.ts` publishes a prepared owner through an atomic symlink to a missing child. Recovery canonicalizes paths and checks process start and boot identity when available. Release and recovery claim a generation before unlinking it. Live writers retain ownership regardless of elapsed time. | Ten cases cover killed owners, interrupted recovery, mixed-version waiting, aliases, reused process IDs, concurrent writers, replacement ownership and callback failure. |
| Delivery | Both hosts keep sent-prompt records and a local delivery ID for each press. Shared reducers acknowledge every row of a bulk press. Late failures preserve newer actions and drafts. | Equal-time presses, lost arrivals, reloads, rewritten prompts, late failures, Closed folds and PR feedback are covered. Concurrent mod presses retain the newer action by press order. |
| Delivery feedback | `hooks/view.ts` shows Queued after one second. Delivery unconfirmed appears immediately, including in settled rows and Closed folds, with no success mark. | Checks cover the delay boundary and immediate uncertainty. The built Codex page renders seeded unconfirmed states. |
| PR-opening help | `hooks/pr-tab.ts:itemPrSteps` supplies both view construction and press validation. | Linked PRs, the branch PR and duplicate explicit links are covered. |
| Failed updates | Codex separates an active update from a failed exchange awaiting its next retry trigger. A failure that will not retry makes no retry promise. | First failure, active retry and final failure are covered. |
| Row and action meaning | `RowView`, `ActionView` and view helpers own content, reply intent, marks, emphasis and icon kinds. `rowKeyPlan` owns order. Renderers style actions in that order. | Mod drawing, folded options, finding follow-ups, guards and mounted Codex interaction checks pass. Native desktop keeps Help before Done. |
| Navigation | `firstWaiting`, `keptOpen`, `rowAfterClose`, `isTabEmpty` and `followTo` own selection and empty-tab decisions. Hosts supply drawn rows and blockers. | Shared decisions and host arrival cases pass. New rows above the selected row remain closed. |
| Inline Undo | `hooks/register.tsx` advances selection and reveals the existing Undo control. On expiry it reveals the current selected row, including a new default selection. Manual scrolling cancels that tracking. | Native terminal checks include consecutive closes, expiry, late arrivals, manual scrolling, selection, Reply, resize and previous-row fallback. |
| Terminal fitting | `hooks/register.tsx:listColumns` accounts for the inline tab column. `terminalTextLines` fits parsed display spans to the body budget and preserves planned breaks, styles, link addresses and explicit newlines. | Fourteen native cases cover plain, styled, code, link, multiline, exact-width and emoji text across widths of 70, 80, 82, 84 and 90 cells. The original 82 by 32 reproduction keeps its actions visible. |
| Update bookkeeping | `applyExchangeUpdate` preserves the item being explained. `addActivity` owns the activity cap and duplicate filter. Press results identify actual reopens for closed-note acknowledgement cleanup. | Explain preservation, activity history and repeat-close notification behavior are covered. |
| Model text | `hooks/model-text.ts` owns prompts and inbox notes. `hooks/claude.ts` owns Claude transcript, command, dialog and stop helpers. `hooks/text.ts` owns formatting. | All 269 byte/value comparisons against pinned v0.2.5 sources pass. Codex type checking needs no generated Claude engine types. |
| Dependency rules | The checker resolves imports and follows local dependencies from shared modules and Codex sources and tests. Shared restrictions apply through type bridges. Computed imports are restricted to the top-level runtime handler loader. | The 26 subprocess fixtures and independent type-bridge and nested-loader probes pass. |
| Codex reload ownership | `codex/src/tab.tsx:swapPage` replaces only the Inbox root, style and script. Each instance owns its timers, listeners and animations. Candidates initialize against a detached root. Replacement waits for active presses and preserves current UI state; failed candidates leave the working page usable. | Browser fixtures retain host hooks, retire old polls, initialize the new page once and preserve drafts during ordinary reload and an overlapping send. A retained full-page test covers host document identity and draft recovery. |
| Agent guidance | The entry point, glossary, look map and active plans name current owners and behavior. The built UI spec describes delayed Queued, immediate uncertainty, key-only Explain and recording demos. | Structure checks and standards/spec review pass. |

`registerInboxCommand` registers `/inbox` during `session.start`, before
`next(e)`, and retries when Inbox activates. Concurrent startup, attach and
command handlers wait for the same initialization promise. A cold command
can activate Inbox only when the engine identifies its origin as `composer`.
SDK and plugin commands keep a headless Inbox inactive. Lifecycle tests cover
saved-row readiness, registration refusal and concurrent initialization.

Independent reviews of the combined changes have no unresolved integration
findings. Review covered the append-handler validator name collision,
delivery timing, Undo expiry selection, terminal fitting and preservation of
the PR Markdown fit guard.

## Verification

The final worktree passes all eight `./scripts/check.sh` stages: formatting,
plugin validation, structure, both type checks, mod tests, Codex bundle
consistency and Codex tests. The Claude plugin suite contains 118 tests; the complete Codex suite also passes.

Model-facing strings are unchanged from v0.2.5. The 269 comparisons use the
release's committed sources and cover both hosts, empty and populated
ledgers, numbered answers, long input, code blocks and transcript text.
Future wording changes still follow the model evaluation rules in `AGENTS.md`.

| Look and build | Combined-build checks | Limits |
| --- | --- | --- |
| Terminal, Claude Code 2.1.301 | Fourteen native text cases pass across widths of 70, 80, 82, 84 and 90 cells, including the original 82 by 32 reproduction. Planned breaks keep actions visible while preserving inline styles, code, link addresses, hard newlines and ordinary emoji. Reply draft preservation, Dismiss/Undo and expiry pass across 94 new sampled frames. The final source passed the original 82 by 32 check again after the PR compatibility guard. Earlier combined-build checks cover click and key focus, Done, and 292 sampled frames of Undo and late arrivals. | Simultaneous terminal and desktop use of one session remains unverified. |
| Claude desktop 2.42304.0, bundled engine 2.1.299 | The wrapping candidate passes styled, code, link and multiline checks in dark mode at splitter widths of 62% and 72%. Explicit field click, Reply drafts, Cancel/reopen, Dismiss/Undo and narrow scrolling pass. The final PR guard was hot-reloaded before repeating code, link and multiline checks. Earlier combined-build checks cover first-command dispatch, both appearances, Send advancing selection, Done/Undo, Help before Done and PR handoff. | First Reply still leaves typing in the composer, and the host can show its stale command warning. Clipboard and controlled-refusal evidence below predates release integration. |
| Codex native MCP panel, repaired build | The loaded resource and safe handoff markers match the worktree. Show demo, Reply focus, Cancel/reopen draft retention, two page replacements with an exact draft, Dismiss and Undo pass in one attachment. Normal data returns after Hide demo. | Sample presses send nothing. Earlier native clipboard evidence remains separate; real delivery reconciliation is not established by these checks. |
| Codex built page with the production handler and isolated store | The lifecycle candidate passes ordinary reload and reload during a pending Send. Both preserve host heartbeat, host message handling and the exact draft, with one new initialization and no old-page polls after replacement. Before this repair, long, styled, multiline and exact-width fixtures passed at 360 and 720 pixels in light and dark. Earlier checks cover reduced motion, 2,789 measured frames, refused sends, new waiting rows and seeded uncertainty. | Native attachment has separate evidence below. Explicit finding newlines render as separate lines in both themes. Controlled refusals and seeded uncertainty do not establish live delivery reconciliation. |

**Earlier native effect checks.** Before release integration, disposable
non-demo fixtures kept the production renderers, press reducers and clipboard
paths. Desktop copy replaced a known clipboard sentinel with the exact fixture
marker. In the Codex panel, automated clicks showed the manual-copy fallback;
a user click copied the exact marker, confirmed by pasting it. These clipboard
checks were not repeated in the combined demo.

Those earlier native fixtures also checked refused choices with Try again,
retry controls, refused typed replies with preserved drafts, and seeded
unconfirmed open, closed-answer and PR feedback. The send path returned a
controlled refusal before calling a transport or model. Seeded uncertainty
proved appearance only. These states were checked in dark native panes;
the combined built-page checks provide the newer light, dark and motion
evidence.

**Cleanup.** The terminal and desktop verification settings remain restored.
The browser fixture is stopped and its tab is closed. The native diagnostic
override is removed. The fixed Codex dev build remains running so the next
native check can use the same build without another restart.

**Terminal wrapping repair.** The inline body now keeps the line breaks it
planned. At 82 by 32 cells, the previous path joined five planned lines into
one paragraph and asked native Text to wrap again. The native renderer counted
a separator after a full-width line on the following line. That extra space
produced a sixth detail line and pushed actions below the pane.

`terminalTextLines` parses inline spans before wrapping. It keeps styles and
appended link addresses, counts explicit newlines, and adds an ellipsis to the
last clipped line. The renderer inserts planned breaks after parsing, so
those breaks cannot split Markdown syntax. The helper remains local to the
mod's inline terminal body fitting. Desktop and Codex drawing are unchanged.

A PR comment returns full Markdown only when both its existing raw-text
estimate and the planned inline count fit. This preserves the previous gate;
it does not redesign Markdown layout. The native PR probe did not establish
an action-visibility failure in that full-Markdown path. Clipped PR output
uses the planned styled lines.

## Native attachment recovery

Status: verified on the repaired build. The native MCP panel loaded resource
`ui://inbox/tab-c55bad91c952`, matching the prepared worktree page and server.
Its handoff marker and owned script/style IDs are present; its script contains
no `document.open()` call. The dev builder runs in an independent terminal
session so quitting the desktop app does not stop it. This is a local build,
not a published release or an update to the installed legacy bundle.

The same native tab stayed attached through two controlled page replacements.
An inert script marker identified the first replacement. Restoring the exact
original page caused the second. Both retained the reply field's exact draft
and focus, with one Inbox root and script. No tab was reopened during these
checks. The temporary marker was removed and the original page hash restored.

Show demo and Hide demo both work. Reply focuses the input; Cancel and reopening
Reply preserve its draft. Dismiss offers Undo, which restores the sample row
and its count. The normal Inbox view remains attached after leaving demo mode.
These checks use sample data and send no messages. The native screenshot
records the restored sample row after both page replacements.

The page-replacement contract remains covered by browser fixtures: retain the
host Document and body, stage a candidate against a detached root, wait for
active presses, and replace only Inbox's root, style and script. Disposal
removes only the retired instance's timers, listeners and animations. Failed
candidates leave the working page usable with Retry. Browser fixtures also
cover replacement during a held Send, failed initialization and host heartbeat
and message-listener retention.

An already-running legacy page cannot acquire these guarantees retroactively.
Its global timer cleanup and `document.open()` remove state owned by the host.
The installed legacy bundle remains separate from this worktree; if the dev
builder stops, the loader falls back to that bundle. A fresh host mount of the
repaired page is required for migration. Subsequent repaired-page updates
passed without remounting the native tab.

## Remaining limits and follow-ups

**Desktop command warning and Reply focus.** Startup dispatch works, but the
host can still show the stale unknown-command warning tracked in
[issue 99691](https://github.com/anthropics/claude-code/issues/99691).
The first Reply click draws the field while typing stays in the composer.
Clicking the field enables typing and preserves the composer draft.
[The desktop reference](../reference/claude-desktop-app.md) records successful
focus API results and failed native focus transfer. A host fix remains
necessary, tracked in
[issue 100966](https://github.com/anthropics/claude-code/issues/100966).
The supported Input remains in use.

**Shared-session scrolling.** Simultaneous terminal and desktop use of one
session remains unverified. The host's scroll and close events omit the
surface, so either attached surface can cancel terminal scroll tracking.
The individual terminal path has live coverage.

Inline terminal Undo keeps priority until it expires when Undo and the next
row's actions cannot both fit. Expiry reveals the current selected row,
including a new default row. Selecting another row releases the Undo position
and follows that row after expiry. Changing tabs, opening a Closed fold or
scrolling manually ends this tracking. Desktop, docked terminal and Codex
retain their own scrolling policies.

**Exact delivery reconciliation.** The host callbacks Inbox uses expose no
verified link between an arrival and its press. A synthetic check through
the real Codex press and state paths sends identical text twice and omits the
first arrival event. Reporting the second leaves the latest press unconfirmed
with its receipt saved. A later same-text callback can mark it arrived.
Simulated queue responses establish Inbox behavior, not live host delivery.

The host APIs were checked on 2026-10-14:

| Host | Verified contract | Missing evidence |
| --- | --- | --- |
| Claude terminal and desktop | Claude Code 2.1.299's generated `PromptSubmitArgs` accepts no correlation ID. `PromptSubmitResult` returns text or a drop reason. `SessionAppendInput` exposes a row UUID, including for queue records. | No documented link connects the submit call, queue record and delivered row. `session.messages()` omits UUIDs and queue records and returns at most 4,096 messages. The public mod API exposes no submission-status lookup. |
| Codex | Bundled CLI 0.162.0-alpha.17.2 returns a queue ID. Its queue command has no list or status operation. The [documented prompt hook](https://developers.openai.com/codex/hooks#userpromptsubmit) supplies prompt text and turn ID. | The hook supplies no matching queue ID or origin. A person's identical prompt can consume a saved Inbox receipt. |
| Codex experimental app-server | Generated experimental bindings expose `thread/queue/add` with `clientUserMessageId`, a pending queue list, and persisted user-message items with `clientId`. Queue updates preserve the submission ID. | The relationship between those client IDs has not been verified. Inbox has no connection to the active app-server. Pending-list absence does not distinguish delivery from deletion. [Item pagination](https://developers.openai.com/codex/app-server) also depends on the thread store. |

A host fix needs a stable identity linking an accepted submission to its
arrival. A caller-supplied identity would let Inbox save the link before an
immediate arrival. Rewrites and queue edits must preserve it. Matching must
use that identity even when delivered text changes.

Recovering an unobserved arrival also needs durable evidence of the
submission's outcome: delivered, canceled, rejected or still pending.
A query by identity or retained delivery records can provide this.
A pending-only list cannot distinguish those outcomes.

With that contract, hosts can pass verified arrivals to the shared reducer
and retire completed receipts. Unresolved deliveries must remain unconfirmed.
Bounded retention must prevent late events from matching a newer press by
text. Legacy receipts still need conservative handling.

Acceptance for that future change must cover identical presses with a lost
event, duplicate and out-of-order events, queue edits, cancellation, reload,
a matching prompt typed by the person, and late arrival after cleanup.
Verify the contract in both hosts and feedback in all three looks.
Unmatched records remain saved under the current contract.

**Older locks.** An empty lock directory from an older build has no owner
identity. The new code retains it and times out. Safe removal requires
confirming that old writers have stopped. Current-format crashes recover
when the owner is known to have stopped. Update workers now use this protocol
too; an ownerless `.updating` directory left by an older worker remains held
because its owner cannot be established safely. When process metadata is unavailable,
recovery uses PID liveness conservatively. Older PID-only records remain
readable.

**Subagent prompts.** Synthetic input with `agent_id` reaches parent
bookkeeping, but actual host delivery has not been established. Verify that
event before changing admission policy. The release's verified
background-thread exclusion remains in place.

Further renderer separation remains proposed in
[three-looks.md](three-looks.md). It uses explicit row inputs and preserves
focus keys, press guards, redraw timing and retained panel content.
[Claude mode](claude-mode.md) remains a separate proposal with its own chat
identity, send acknowledgement and display-capability probes.
