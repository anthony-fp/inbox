# Client parity

Status: building

Every feature works the same way for the person in every client, unless a host cannot do it. This plan records how the hosts differ today, and the steps that close the gaps.

## Terms

- **Host:** a program that runs the inbox for one agent. There are three: the Claude Code mod, Codex and omp. Their ids in `hooks/clients.ts` are `claude-code`, `codex` and `omp`.
- **Look:** one drawing of the inbox. There are four: the Claude Code terminal, the Claude desktop app's pane, the Codex tab and omp's panel. The mod draws the terminal and desktop looks.
- **Parity record:** `hooks/clients.ts`. For each host and feature it says `full`, `different` or `unsupported`, with a reason for the last two. `scripts/check-structure.mjs` fails when an entry that is not `full` has no row in "Differences on purpose" in `docs/looks.md`.
- **Catch-up:** rebuilding the ledger from the whole conversation, instead of from one reply's exchange.

## Decisions

- Every feature is designed for every client. A gap needs a real host limit as its reason. "Later" is not a reason.
- The choice between designs is made for the person's experience.
- Codex and omp get catch-up, as the mod has it. When a host first sees a session that already has turns, or after a failed update, the next update reads the whole conversation.
- Codex reads shell output, such as PR links and URL lines, from the rollout at Stop. It adds no PostToolUse hook.
- Which links a row may open stays a rule of each host.

## Steps

1. **Parity record and its check.** Add `hooks/clients.ts` with all three hosts and the check. Fix the drift in `docs/looks.md` and `docs/plans/omp-look.md`.
2. **One list for the `record` and `close` tools.** Export their name, description and schema once in `hooks/tools.ts`. Each host keeps its own registration. Run `./scripts/eval.sh --suite agent --agent all`.
3. **Shell output in every host.** One shared function in `hooks/session.ts` reads a command's output for local URLs and PR links. The mod calls it from its tool-call handler, Codex from the rollout at Stop, and omp from `tool_result`.
4. **Share `flattenConversation`.** Move the transcript flattening into a shared module, once a second host has a catch-up.
5. **Run `runSessionScript` against Codex storage.** Add a Codex spec beside `omp/tests/session.spec.ts`.
6. **Update policy and catch-up.** Add an optional catch-up member to the update host, and move the catch-up rule into shared code. Codex reads its rollout. omp needs a reader over its session entries, after an investigation. A dropped reply keeps the "may be missing" warning until a catch-up covers it.
7. **Move the mod onto `sessionView`.** `sessionView` needs a retry rule that each host supplies.
8. **The remaining gaps.** PR arrivals in the Codex tab, the PRs empty hint in omp, and the ledger of a forked conversation in Codex and omp. A gap that proves to be a host limit stays, with its reason in `hooks/clients.ts`.
