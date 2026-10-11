# Architecture deepening

The Claude app pane and the Codex tab draw the same view model, `hooks/view.ts`. Where both clients still compute the same rule, that rule moves into one shared module, so the clients cannot drift. Each step keeps the mod's behavior, and each one's checks pass before the next starts.

## Done

1. **Row keys.** `rowKeyPlan` in `hooks/view.ts` sets the order and letters of a row's keys. Each client maps the planned keys to its own controls.
2. **New rows.** `hooks/arrivals.ts` records each tab's rows and picks the tab and row to move to. Each client passes its own tabs and its own rule for an empty tab.

## Steps

3. **Press effects.** Two functions in `hooks/presses.ts` run an applied press's effects for both hosts. `runLocalEffects` runs its opens and copies, then replaces a Local press's pending result with how they went. `runSends` sends its messages in order. When a send fails, the rows the press recorded read why, an answer it made reopens its question, and its later sends stay unsent. Its earlier sends, opens and copies stand.
   - Both hosts already end in the same state for every press the inbox can make: a step either sends one message or runs opens and copies, never both. Codex no longer restores a copy of its state from before the press. It undoes only what the press did, as the mod does, so a write that lands meanwhile stands.
   - Each host keeps applying the press, its UI state and its own way to send and save. The mod runs a press's opens before its sends. Codex sends under the lock that applies the press, so no prompt reads the press before its message went, then runs opens outside the lock. No press both sends and opens, so the order never shows.
4. **Demo presses.** One pure function beside `applyPress` turns a press's result into what the demo copy records. A send goes nowhere, so it records no delivery, and a Local press records no result. A press that would act shows the sample note.
5. **Drawn lists.** One builder makes each tab's drawn entries, the settled rows they include, the Closed fold lines, and the rows the selection moves over. Each client passes the settled rows it still draws: the mod draws every settled row the view lists, and the Codex tab draws those it first saw less than SETTLED_MS ago.
6. **Desktop row layout.** The pane's row columns and per-look spacing get names in one record, instead of literals repeated across the open, closed and settled rows.
7. **Pane drawing.** The pane's drawing moves out of `hooks/register.tsx` into its own module. `register.tsx` keeps the engine hooks, state and press running.

## Checks for each step

- `./scripts/check.sh`, with the mod's tests unchanged, except where a step names a behavior change.
- The Codex tab's transitions replayed frame by frame in the local test page, compared with the run before the step.
- An adversarial review of the step's diff before it is committed.
- The Claude app pane and the Codex app, once Codex is restarted.
