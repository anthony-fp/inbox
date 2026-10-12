# Fix and Do it settle a finding's row

Status: built on `ideal-layout`.

Pressing Fix or Do it on a finding hands it to the agent. The row then shows "✓ Handed off" with Undo, the way an answered question settles, and leaves the list once the settle time ends.

## What changes

- **The row settles.** For the settle time, the row shows "Handed off" in place, with Undo. Afterward it is not drawn and is not counted.
- **The finding stays open.** The ledger keeps it open, so the agent can still close it with `mcp__inbox__close` once the fix lands. Nothing the agent or the inbox model reads changes.
- **It comes back if the fix doesn't land.** The row is hidden only until the agent's reply for that turn applies. If the reply leaves the finding open, the row shows again, as a handed-off task does today.
- **Undo brings the row back.** It cannot take back the message, which has already gone to the agent. The row is listed again with its "✓ Handed off" note, and stays out of the count until the agent's reply applies.
- **The fold never counts it.** The finding is not closed, so the "N closed" fold leaves it out until the agent closes it.

Reply and Discuss are unchanged. A typed reply can be a question back, so the row stays listed.

## Where

- `hooks/view.ts`: `inboxView` gives a finding handed off by Fix the settled state while it settles, and leaves it out after.
- `hooks/presses.ts`: Undo on such a row marks its last action `isKept`, which lists it again.
- `types/index.d.ts`: `LastAction.isKept`, optional, so saved state needs no conversion.
- `hooks/register.tsx`: the pane redraws when the settle time ends, after a press and after a reload.
- Codex draws the settled state as it does an answered question's.
