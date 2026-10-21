# Evals the release can trust

Status: building. Steps 1 to 3 are done. Step 4 runs on the 0.2.10 candidate.

Every release relies on the two eval suites in `./scripts/eval.sh` (AGENTS.md, "Text a model reads"). An audit of both, checked by two adversarial reviews, found that a green run shows only that nothing broke badly on these fixtures. It does not show that a wording change is safe. This plan makes a run's result mean what the release takes it to mean.

## What a run gets wrong now

| Problem | Effect |
| --- | --- |
| The model suite's Claude calls load the person's own `CLAUDE.md` | `claude -p` without `--setting-sources ''` read the runner's private rules: a probe asked for its instructions and got their first line. Results depend on whose machine ran them. |
| The Codex calls load the person's `~/.codex/AGENTS.md` | The agent suite links it into each run's `CODEX_HOME`. The model suite's call, the product's own `codexAsk`, reads it too, despite `--ignore-user-config` and `project_doc_max_bytes=0`. So does every user's inbox model in Codex. |
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
| The agent suite may not test the guidance | The tool descriptions and the case prompts already say much of what the guidance says, and no run has measured the suite without it. Step 2 measured it: 14 of 15 cases pass without the guidance. |

## Steps

### 1. Fix the harness

No model calls, except one targeted run per changed check.

- The model suite runs Claude with `--setting-sources ''` and `--effort low`. The agent suite stops linking `AGENTS.md`.
- `codexAsk` runs the inbox model in its own `CODEX_HOME`, which holds only a link to the person's `auth.json`. This fixes the product too, so the model suite tests the product's own isolation.
- The model suite grades with `applyExchangeUpdate`, as the product does.
- Both runners reject an unknown agent, an unknown case and an empty selection.
- Every run writes its results, by default to `evals/results/`, which Git ignores. Each file records the commit, whether the tree had changes, the date, the CLI versions and the model each answer came from.
- A failed call is retried twice. A case whose calls keep failing is reported as not run, never as passed or failed.
- The model suite prints, for each case, how many NEW lines the code dropped. This is for reading only: it is not a check.
- The loose checks get exact counts. A check covers 0.2.10's answer rule. The id check matches only lowercase ids, of any length.
- A check pairs each `new` pattern with its own item, so one merged item cannot pass two.
- A session that can reach more than the stand-in inbox stops the whole run, with no retry. A runner that throws records the run as not graded. Results are written as each run lands, so a run cut short keeps them. A run with a case not graded exits 2, a stopped run 3.
- Each results file records a hash of every text the models read and of the cases file, and the diff when the tree had changes. `--with` judges a rerun together with the first run and refuses one that tested other text.
- The model suite records each call's time and output tokens, and notes runs past the mod's 45 s limit and 1600 tokens. It lists the asks of NEW lines the code dropped.

### 2. Measure the guidance

The agent suite gets `--no-guidance`. One run of Claude on all 15 cases, at 5 runs each, is 75 sessions. A case that passes without the guidance tests the tool descriptions and the prompt, not the guidance.

Result, on 0195b98 with a clean tree (`evals/results/agent-no-guidance-2026-10-21T06-35-46.075Z.json`): 14 of the 15 cases pass without the guidance. Only `no-finding-user-only` fails, 2 of 5: Claude listed the options without asking a question. `record-question` passed 4 of 5 and missed the same way once. Every other case passed 5 of 5.

So the agent suite tests one rule of the guidance, that the agent asks in its reply as a direct question. The tool descriptions in `hooks/tools.ts` and the inbox text carry the rest. A change to `guidanceText` that breaks any other rule would pass this suite. A change to a tool description is what the suite does test. Cases that fail without the guidance are follow-up work: see "Not in these steps".

### 3. Mutation tests

Each mutant is applied in a throwaway worktree and never committed. Predictions are written here before the runs:

| Mutant | Cases | Prediction |
| --- | --- | --- |
| M1: remove the sentence in `systemText` saying a reason is not a recommendation (2312d4f) | `reason-not-recommendation`, Sonnet, 8 runs | Below the bar. History measured 3 of 8 without it. |
| `<decided>` removed from the inbox model's prompt | `dismissed-question-stays-closed`, `old-dismissed-question-stays-closed`, Sonnet, 8 runs | The cases pass, while the raw answers re-add the dismissed question. That proves the code masks the regression. If the cases fail, the code is not masking it. |

Results, on 0195b98 with each mutant applied:

| Mutant | Result |
| --- | --- |
| M1 | 5 of 8: below the bar, as predicted. The failures are the reason read as a recommendation. The margin is one run. |
| `<decided>` removed | 16 of 16 passed, as predicted. Every raw answer re-added the dismissed question, and the code dropped all 16. |

The dismissed cases now also check `{"dropped": 0}`: the code must drop no NEW line. Today's prompt passes it 32 of 32, on Sonnet and Codex. With `<decided>` removed, Sonnet fails both cases 0 of 8, and Codex fails `old-dismissed-question-stays-closed` 0 of 8. Codex still passes `dismissed-question-stays-closed` 8 of 8 without the block, so that case does not test the rule on Codex.

M2, restoring the old rule for unrelated items, waits for step 4, since its cases flip now. M4, softening the id rule, is dropped: step 2 showed the id cases pass with no guidance at all, so removing the id rule from the guidance cannot fail them.

### 4. Settle the flipping cases and add baselines

- Read the failure lines of the four flipping cases, and fix the fixtures where they are ambiguous. A case that needs a rule change in model-read text is a separate change, with its own full rerun and approval.
- Drop the stale Codex override.
- Run the key cases 20 times to set a baseline. These are the dismissed cases, the four flipping cases, and the cases for 0.2.10's changed rules. The baseline is stored with its commit, date and model ids. The runner then reports a case as below its baseline when a one-sided binomial test says so, beside the fixed bar.

## The rerun rule

A red case is not rerun until it is green. It gets one rerun at three times its runs. The bar applies to the combined count, and every attempt stays in the results.

## Not in these steps

- Agent cases that fail without the guidance, one for each of its rules, so a change to `guidanceText` is tested.

- The agent suite on Haiku and Sonnet. A past id leak (30e03f0) showed only on Haiku.
- omp's inbox model, and its fallback to omp's `@smol` model.
- Agent cases showing the closed, carried-over and answer notes, and Codex's guidance delivered as the plugin delivers it, at session start.
