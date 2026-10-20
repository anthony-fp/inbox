/**
 * The parity record: how each host supports each feature. `full` means the host does what the shared flow
 * describes. `different` means the person gets the feature another way. `unsupported` means the person gets none of it.
 * `docs/looks.md` explains each feature that is not `full` in "Differences on purpose", in a row whose first column
 * names the feature id in backticks. `scripts/check-structure.mjs` fails when such a row is missing, and reads this file
 * with the TypeScript AST, so write each entry as an object literal.
 */

/** A host. Terminal and desktop share `claude-code`, since both run the mod. */
export type ClientId = 'claude-code' | 'codex' | 'omp'

export type FeatureId =
  | 'catch-up'
  | 'failed-update-recovery'
  | 'ledger-behind-state'
  | 'dialog-outcome'
  | 'tool-output-urls'
  | 'pr-link-from-output'
  | 'pr-arrivals'
  | 'prs-empty-hint'
  | 'link-open-rule'
  | 'fork-ledger'
  | 'band-and-stop-rows'
  | 'exchange-trigger'
  | 'settle-window'

export type Support = { kind: 'full' } | { kind: 'different' | 'unsupported'; reason: string }

export type Client = { support: Record<FeatureId, Support> }

export const CLIENTS: Record<ClientId, Client> = {
  'claude-code': {
    support: {
      'catch-up': { kind: 'full' },
      'failed-update-recovery': { kind: 'full' },
      'ledger-behind-state': { kind: 'full' },
      'dialog-outcome': { kind: 'full' },
      'tool-output-urls': { kind: 'full' },
      'pr-link-from-output': { kind: 'full' },
      'pr-arrivals': { kind: 'full' },
      'prs-empty-hint': { kind: 'full' },
      'link-open-rule': { kind: 'full' },
      'fork-ledger': { kind: 'full' },
      'band-and-stop-rows': { kind: 'full' },
      'exchange-trigger': { kind: 'full' },
      'settle-window': { kind: 'full' },
    },
  },
  codex: {
    support: {
      'catch-up': {
        kind: 'unsupported',
        reason: 'Not built in Codex yet; client-parity step 6 builds it from the rollout transcript.',
      },
      'failed-update-recovery': {
        kind: 'different',
        reason:
          'Codex retries a failed exchange once at the next Stop, then drops it, and a later successful update clears the warning that a reply may be missing. Not built in Codex yet; client-parity step 6 builds recovery with catch-up.',
      },
      'ledger-behind-state': {
        kind: 'unsupported',
        reason: 'Not built in Codex yet; client-parity step 6 sets `behind` when a session starts with earlier turns.',
      },
      'dialog-outcome': {
        kind: 'different',
        reason:
          "Codex's dialog tool returns at once and the answer arrives as the person's next prompt, so a dialog is noted as open and its outcome is never recorded.",
      },
      'tool-output-urls': {
        kind: 'unsupported',
        reason:
          "Not built in Codex yet; client-parity step 3 reads the turn's shell output from the rollout at Stop, not through a PostToolUse hook.",
      },
      'pr-link-from-output': {
        kind: 'unsupported',
        reason:
          'Not built in Codex yet; client-parity step 3 reads `gh pr create` output from the rollout at Stop. Until then a PR is linked only from the reply text.',
      },
      'pr-arrivals': {
        kind: 'unsupported',
        reason:
          'Not built in Codex yet; client-parity step 8 builds it. `TAB_IDS` in `codex/src/arrivals.ts` has no PRs tab, so a new PR does not move the tab.',
      },
      'prs-empty-hint': {
        kind: 'different',
        reason: 'The Codex app calls a chat a conversation, so its hint says conversation where the mod says session.',
      },
      'link-open-rule': {
        kind: 'different',
        reason:
          'The maintainer chose to keep each host rule. The mod opens a link with any scheme. Codex opens only https links and treats anything else as a path.',
      },
      'fork-ledger': {
        kind: 'unsupported',
        reason:
          "Not built in Codex yet; client-parity step 8 builds it or records the limit. A forked chat's parent id appears in MCP call metadata, which `codex/src/server.ts:turnOf` reads, and no hook names it.",
      },
      'band-and-stop-rows': {
        kind: 'unsupported',
        reason: 'Codex has no line above its prompt, and shows no stops.',
      },
      'exchange-trigger': {
        kind: 'different',
        reason:
          'A Codex hook names no source for a turn that has no prompt, so the exchange reads unknown. The mod reads the prompt origin.',
      },
      'settle-window': {
        kind: 'different',
        reason: 'The tab only learns of a close at its next poll, so the settle window adds two polls.',
      },
    },
  },
  omp: {
    support: {
      'catch-up': {
        kind: 'unsupported',
        reason:
          'Not built in omp yet; client-parity step 6 builds it from omp session entries, after an investigation of what they hold.',
      },
      'failed-update-recovery': {
        kind: 'different',
        reason:
          'omp retries a failed exchange once at the next agent end, then drops it, and a later successful update clears the warning that a reply may be missing. Not built in omp yet; client-parity step 6 builds recovery with catch-up.',
      },
      'ledger-behind-state': {
        kind: 'unsupported',
        reason: 'Not built in omp yet; client-parity step 6 sets `behind` when a session starts with earlier turns.',
      },
      'dialog-outcome': { kind: 'full' },
      'tool-output-urls': {
        kind: 'unsupported',
        reason:
          "Not built in omp yet; client-parity step 3 reads a shell result in omp's `tool_result` handler, which now handles only `ask`.",
      },
      'pr-link-from-output': {
        kind: 'unsupported',
        reason:
          'Not built in omp yet; client-parity step 3 reads `gh pr create` output. Until then a PR is linked only from the reply text.',
      },
      'pr-arrivals': { kind: 'full' },
      'prs-empty-hint': {
        kind: 'unsupported',
        reason:
          'Not built in omp yet; client-parity step 8 adds the hint. The PRs tab shows "No PRs" with no hint line.',
      },
      'link-open-rule': {
        kind: 'different',
        reason:
          'The maintainer chose to keep each host rule. The mod opens a link with any scheme. omp opens only https links and treats anything else as a path.',
      },
      'fork-ledger': {
        kind: 'unsupported',
        reason:
          "Not built in omp yet; client-parity step 8 builds it. omp's `session_switch` event reports a fork and the session file it came from, and the host's handler reads neither.",
      },
      'band-and-stop-rows': {
        kind: 'different',
        reason:
          "omp's band cannot take keys, so Resume is a button in the panel. omp classes a stop from the request's HTTP status and message, so it never names billing or a reset time.",
      },
      'exchange-trigger': {
        kind: 'different',
        reason:
          "omp's `before_agent_start` event carries only the prompt text, so every turn has words and none reads as started by something else.",
      },
      'settle-window': { kind: 'full' },
    },
  },
}
