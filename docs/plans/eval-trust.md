# Evals the release can trust

Status: building. Step 1 is in progress.

Every release relies on the two eval suites in `./scripts/eval.sh` (AGENTS.md, "Text a model reads"). An audit of both, checked by two adversarial reviews, found that a green run shows only that nothing broke badly on these fixtures. It does not show that a wording change is safe. This plan makes a run's result mean what the release takes it to mean.

## What a run gets wrong now

| Problem | Effect |
| --- | --- |
| The model suite's Claude calls load the person's own `CLAUDE.md` | `claude -p` without `--setting-sources ''` read the runner's private rules: a probe asked for its instructions and got their first line. Results depend on whose machine ran them. |
| The Codex calls load the person's `~/.codex/AGENTS.md` | The agent suite links it into each run's `CODEX_HOME`. The model suite's call, the product's own `codexAsk`, reads it too, despite `--ignore-user-config` and `project_doc_max_bytes=0`. |
| The model suite runs Sonnet at the CLI's default effort | The product runs it at `effort: 'low'` (`hooks/claude-host.ts`). The eval is kinder than the product. |
| The model suite grades with `applyUpdate` | The product applies `applyExchangeUpdate`, which keeps an item the person asked to explain open. The eval is stricter than the product there. |
| `--agent omp` in the model suite runs Claude and labels it omp | `run.ts` casts any value to an agent. An unknown `--case` name is dropped, and a selection with no cases passes. |
| A run records no commit, date or model id, and writes results only with `--out` | No log can say what it tested. |
| A failed call counts as a behavior failure | A timeout reads the same as a wrong answer. |
| A red case is rerun until it is green | 0.2.10's `done-message-blocked-task` went 5 of 8, then 16 of 16 on a rerun, with no rule for which result counts. |
| The bar is 6 of 8 or 4 of 5 | The regression AGENTS.md cites kept dismissed questions closed in 78% of runs (87166b6). It passes 6 of 8 three times in four. |
| The code drops some regressions before the checks see them | `repeatsClosed`, `matchOpen` and `isTakenUp` drop a NEW line that restates a closed or open item. A prompt change that makes the model re-add a dismissed question can pass. Grading the raw answer instead would fail today's prompt: 5d508fd measured 73 of 104 before the code. |
| Some checks are too loose | `numbered-questions-all-kept` passes when five questions are merged into one. `narrowed-question-new-options` checks neither the count nor the recommendation. The id check also flags "F1". |
| 0.2.10's rule to say how the agent took an answer has no check | Reverting it would pass. |
| Four cases flip between runs | `device-command-is-terminal`, `dialog-about-finding-escaped`, `done-message-independent-task` and `done-message-blocked-task` caused every red run in the last seven full logs. `set-aside-finding-stays-open` keeps a stale `min.codex: 0.4`. |
| The agent suite may not test the guidance | The tool descriptions and the case prompts already say much of what the guidance says, and no run has measured the suite without it. |

## Steps

### 1. Fix the harness

No model calls, except one targeted run per changed check.

- The model suite runs Claude with `--setting-sources ''` and `--effort low`, and Codex with a `CODEX_HOME` that holds only `auth.json`. The agent suite stops linking `AGENTS.md`.
- The model suite grades with `applyExchangeUpdate`, as the product does.
- Both runners reject an unknown agent, an unknown case and an empty selection.
- Every run writes its results, by default to `evals/results/`, which Git ignores. Each file records the commit, whether the tree had changes, the date, the CLI versions and the model each answer came from.
- A failed call is retried twice. A case whose calls keep failing is reported as not run, never as passed or failed.
- The model suite prints, for each case, how many NEW lines the code dropped. This is for reading only: it is not a check.
- The loose checks get exact counts. A check covers 0.2.10's answer rule. The id check matches only lowercase ids.

### 2. Measure the guidance

The agent suite gets `--no-guidance`. One run of Claude on all 14 cases, at 5 runs each, is 70 sessions. A case that passes without the guidance tests the tool descriptions and the prompt, not the guidance. The plan then marks it as such.

### 3. Mutation tests

Each mutant is applied in a throwaway worktree and never committed. Predictions are written here before the runs:

| Mutant | Cases | Prediction |
| --- | --- | --- |
| M1: remove the sentence in `systemText` saying a reason is not a recommendation (2312d4f) | `reason-not-recommendation`, Sonnet, 8 runs | Below the bar. History measured 3 of 8 without it. |
| `<decided>` removed from the inbox model's prompt | `dismissed-question-stays-closed`, `old-dismissed-question-stays-closed`, Sonnet, 8 runs | The cases pass, while the raw answers re-add the dismissed question. That proves the code masks the regression. If the cases fail, the code is not masking it. |

M2, restoring the old rule for unrelated items, waits for step 4, since its cases flip now. M4, softening the id rule, waits for step 2's result on the id cases.

### 4. Settle the flipping cases and add baselines

- Read the failure lines of the four flipping cases, and fix the fixtures where they are ambiguous. A case that needs a rule change in model-read text is a separate change, with its own full rerun and approval.
- Drop the stale Codex override.
- Run the key cases 20 times to set a baseline. These are the dismissed cases, the four flipping cases, and the cases for 0.2.10's changed rules. The baseline is stored with its commit, date and model ids. The runner then reports a case as below its baseline when a one-sided binomial test says so, beside the fixed bar.

## The rerun rule

A red case is not rerun until it is green. It gets one rerun at three times its runs. The bar applies to the combined count, and every attempt stays in the results.

## Not in these steps

- The agent suite on Haiku and Sonnet. A past id leak (30e03f0) showed only on Haiku.
- omp's inbox model, and its fallback to omp's `@smol` model.
- Agent cases showing the closed, carried-over and answer notes, and Codex's guidance delivered as the plugin delivers it, at session start.
- The Codex inbox model reading the person's `AGENTS.md` in the product.
