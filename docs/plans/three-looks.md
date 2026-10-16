# One inbox in three looks

Status: building. Shared text, row semantics, navigation and dependency checks are built. Further renderer separation remains proposed. Native verification is incomplete.

Shared modules decide the inbox's behavior and content. Each adapter maps that description to its own controls, units and motion. [The look map](../looks.md) lists current owners and deliberate differences. [The glossary](../../GLOSSARY.md) defines look, host and adapter.

## Built

- **Shared model text.** `hooks/model-text.ts` builds the guidance, prompts, inbox notes and numbered-answer mapping for both agents. `hooks/ledger.ts` owns ledger state and parsing. `hooks/claude.ts` contains the mod's transcript, command, dialog and stop helpers. `hooks/text.ts` contains text formatting. Codex type checking no longer needs generated Claude engine types.
- **Shared row and action descriptions.** `RowView` carries finding detail, the displayed file name and reply intent. `ActionView` carries emphasis and icon kind. Shared helpers decide marks, reply hints, recommended labels and feedback. Each renderer maps these fields to native controls.
- **Shared action order.** `rowKeyPlan` puts retry first, then options or help steps, then the remaining actions. Emphasis changes a button's appearance without changing its position. The desktop renderer follows that order.
- **Shared navigation.** `firstWaiting`, `keptOpen` and `rowAfterClose` decide which row opens. `isTabEmpty` and `followTo` decide when to move tabs. Hosts supply their blockers and drawn settled rows. New rows have no arrival bar. Codex animates their entry.
- **Shared PR rules.** Both hosts use `hooks/pr-tab.ts` for fetching, tracking, presses and PR-opening help. Press validation uses the same help steps as the view. Arrival acknowledgement updates every matching row of a bulk press and preserves newer presses. Both hosts retain sent-prompt records; ambiguous delivery stays visible in open rows and Closed folds, as the look map defines.
- **Shared update and Undo bookkeeping.** `applyExchangeUpdate` applies reply data and `addActivity` owns the activity limit and duplicate filter. Press results name actual reopened rows, so hosts clear closed-note acknowledgements only for those rows. Retry scheduling stays with each host.
- **Import checks.** The structure checker parses source and resolves literal import targets. It follows local dependencies from nested Codex sources and tests, shared build inputs and type imports. Shared restrictions continue through type bridges. Nested functions cannot imitate the runtime loader exception. The checker tests invoke the real command against disposable fixtures.
- **Codex row-action components.** The tab uses production components in `codex/src/row-actions.tsx`. Mounted tests cover action order, emphasis and guarded clicks. A mounted real-tab test covers reply focus, hidden shortcuts, draft preservation and sending through its host bridge. Full polling, selection, PR drawing and measured motion still need separate proof.

## Remaining work

1. **Separate drawing from host orchestration where its inputs are explicit.** The mod still combines engine events, storage, presses and both native drawings. The Codex tab still combines page effects and row drawing. Use the existing row and action descriptions as inputs. Preserve stable focus keys, press guards, redraw timing and retained panel content while moving code.
2. **Remove remaining content copies at their owners.** PR block and row drawing, host-specific notices and some closed-row composition still sit in both adapters. Share a decision when both readers require the same result. Keep text fitting, native controls, theme resolution and DOM measurement local.
3. **Add drawing proof as renderers become separable.** Extend the existing mod drawing test for uncovered settled and PR content. Add Codex row and full-page checks only for contracts the mounted action tests cannot reach. A missing row field, stale selection or dropped panel during collapse must fail at the renderer that owns it.
4. **Complete native acceptance.** Automated state and component checks do not establish native painting, clipboard access, keyboard focus or measured animation. Record the current build, width, theme and transitions observed. Name each state or host that was not checked.

Each change passes `./scripts/check.sh`. Rebuild the Codex bundles after changing a shared module or Codex source. A move of model-facing text preserves its bytes; changed text follows the model-testing rule in `AGENTS.md`.

Native checks:

- Terminal: both themes, narrow fitting, keys, Reply, retry and close followed by Undo.
- Claude desktop: confirm the loaded build, then check Client hit areas, reply focus, row and fold states, PR content and both appearances. The pane changes form in one draw because it has no browser animation primitives.
- Codex: mounted controls and clipboard in the app, then frame measurements in the local page for pending press, settle, Undo, failure, exit and interrupted moves. Check both themes, narrow widths and reduced motion.

[unified-ui.md](unified-ui.md) proposes further visual alignment. [claude-mode.md](claude-mode.md) proposes an additional host and item source. Neither proposal establishes behavior in the three built looks.
