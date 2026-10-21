#!/bin/sh
# Runs model eval cases. Exits 0 when every case passed, 1 when a case passed in fewer runs than its bar or fell below
# its baseline, 2 when a case had too few runs that could be graded, and 3 when the run stopped because a session
# could reach more than the stand-in inbox. Each run calls a model, so check.sh leaves this out.
#
# The default suite is the inbox model: the cases in evals/cases.json on Sonnet, the Codex model, or both. Run it
# after a change to systemText or buildPrompt, and when a model alias moves.
#
# The agent suite is the agent that uses the inbox: the cases in evals/agent-cases.json on Claude Code with Opus,
# Codex, omp, or a set of them. Each run gives the agent the shipped guidance and a stand-in for the inbox, and
# checks its record and close calls and its reply. Claude Code and Codex get an MCP server named probe. omp gets an
# extension, evals/omp-probe.ts, that registers the two tools as native omp tools. Run it before a release, and
# after a change to guidanceText, a tool description or a tool answer.
#
# Needs the claude CLI for Sonnet and Opus, the codex CLI, or CODEX_CLI_PATH, for Codex, and the omp CLI and
# a Claude sign-in in omp (run omp, then /login) for omp.
#
# Usage: ./scripts/eval.sh [--suite model|agent] [--agent claude|codex|omp|both|all]
#                          [--claude-model opus|haiku|...] [--omp-model provider/model]
#                          [--runs N] [--case name,name] [--out results.json]
#                          [--with first-results.json] [--set-baseline]
# --agent both runs claude and codex. --agent all runs claude, codex and omp.
# --claude-model sets the model of the Claude agent in the agent suite. It defaults to opus.
# --omp-model sets the model of the omp agent. It defaults to Claude Opus 5.5, which omp lists from 18.12.3. A run
# fails when omp runs another model, as it does for a model its catalog lacks.
# --no-guidance runs the agent suite without the guidance, as a control: a case that still passes tests the tool
# descriptions and the case's own prompt, not the guidance.
# Runs default to 8 for the model suite and 5 for the agent suite.
# --with judges this run together with an earlier results file, for the rerun rule. It refuses a file that ran other
# code, text, cases, models or CLI versions.
# --set-baseline saves each selected case's count to evals/baselines.json, on a clean tree, from 20 or more runs
# that could all be graded.
#
# Every run writes its results, by default to evals/results/, which Git ignores: the commit, whether the tree had
# changes and their diff, the date, the CLI versions, a hash of what the run tested, and for each run the model that
# answered, its answer and its verdict. The agent suite also keeps each agent's raw output. A call that fails is tried
# twice more; a case whose calls keep failing is reported as not run. Neither suite reads your own CLAUDE.md or ~/.codex/AGENTS.md.

set -eu

DIR=$(CDPATH='' cd "$(dirname "$0")/.." && pwd -P)
suite=model
if [ "${1:-}" = "--suite" ]; then
    suite=${2:-}
    shift 2 || true
fi
bundle=$(mktemp -d)
trap 'rm -rf "$bundle"' EXIT
esbuild="$DIR/codex/node_modules/.bin/esbuild"
case "$suite" in
    model)
        "$esbuild" "$DIR/evals/run.ts" --bundle --platform=node --format=esm \
            --outfile="$bundle/run.mjs" --log-level=warning
        INBOX_EVAL_ROOT="$DIR" node "$bundle/run.mjs" --cases "$DIR/evals/cases.json" "$@"
        ;;
    agent)
        "$esbuild" "$DIR/evals/agent.ts" "$DIR/evals/probe.ts" "$DIR/evals/omp-probe.ts" --bundle --platform=node --format=esm \
            --outdir="$bundle" --out-extension:.js=.mjs --log-level=warning
        INBOX_EVAL_ROOT="$DIR" node "$bundle/agent.mjs" --cases "$DIR/evals/agent-cases.json" "$@"
        ;;
    *)
        echo "Unknown suite: $suite. Use model or agent." >&2
        exit 2
        ;;
esac
