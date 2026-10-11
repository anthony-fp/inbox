#!/bin/sh
# Runs the inbox model's eval cases in evals/cases.json on Sonnet, the Codex model, or both, and exits 1 when a
# case passes in fewer runs than its bar. Each run calls a model, so check.sh leaves this out. Run it after a
# change to systemText or buildPrompt, and when a model alias moves.
#
# Needs the claude CLI for Sonnet and the codex CLI, or CODEX_CLI_PATH, for Codex.
#
# Usage: ./scripts/eval.sh [--agent claude|codex|both] [--runs N] [--case name,name] [--out answers.json]

set -eu

DIR=$(CDPATH='' cd "$(dirname "$0")/.." && pwd -P)
bundle=$(mktemp -d)
trap 'rm -rf "$bundle"' EXIT
"$DIR/codex/node_modules/.bin/esbuild" "$DIR/evals/run.ts" --bundle --platform=node --format=esm \
    --outfile="$bundle/run.mjs" --log-level=warning
node "$bundle/run.mjs" --cases "$DIR/evals/cases.json" "$@"
