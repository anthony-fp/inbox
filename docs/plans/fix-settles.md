# Fix and Do it settle a finding's row

Status: built on `ideal-layout`.

Pressing Fix or Do it on a finding hands it to the agent. The row then settles the way an answered question does: it shows the choice, "✓ Fix" or "✓ Do it", with Undo. Once the settle time ends, the row moves to the Findings tab's Closed fold, where it shows the choice and when it was made.

## What changes

- **The row settles.** For the settle time, the row shows the choice in place, with Undo. It leaves the count at once.
- **It moves to the Closed fold.** After the settle time, the row lists in its group's Closed fold, with the choice as its outcome and the press time. It does not come back on its own, even when the agent's reply leaves the finding open. If the agent cannot finish the fix, it says so in its reply or records a new finding.
- **The finding stays open in the ledger.** The agent can still close it with `mcp__inbox__close` once the fix lands. Nothing the agent or the inbox model reads changes. When the agent closes it, the fold lists the agent's close in place of the choice.
- **Undo brings the row back.** It cannot take back the message, which has already gone to the agent. The row is listed again with its "✓ Handed off" note.
- **A failed send keeps the row open,** with "Not sent" and Try again, as any failed press does.

Reply and Discuss are unchanged. A typed reply can be a question back, so the row stays listed.

## Where

- `hooks/presses.ts`: `isFixSent` says whether Fix or Do it handed a finding off, not undone and not failed.
- `hooks/view.ts`: `inboxView` gives such a finding the settled state while it settles, then leaves it out of the rows and adds it to `findings.closed`.
- `hooks/register.tsx`: the Findings tab counts the view's closed findings when deciding whether it is empty.
- Codex draws from the same view, so its tab behaves the same.
