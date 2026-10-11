# Audit of the texts the models read

Status: proposed. No wording has changed. Each change below needs the A/B run that `AGENTS.md` asks for, or is a code change Pete decides on.

## Verdict

The texts are careful about the rules they state: when to record a finding, when to close, and not answering for the user. The biggest gaps are in what they leave out.

1. The main agent is never told that the questions in its reply become inbox items. So it does not write them in a form the inbox model can turn into good items. I expect this to be the largest lever for predictive items. The A/B in theme 1 would confirm it.
2. Nothing can change an open item. When the agent sharpens a question or states a recommendation later, the row keeps its first ask, options and recommendation.
3. A finding the user dismissed disappears without a trace. Neither model hears it was dismissed, so the agent can record it again.

Fixing these three would do the most for Pete's goals: predictive items, each thing in one place, and every item current.

## How this was checked

Six reviewers each read every model-read text with one question:

- **Anticipation:** are items predictive and actionable?
- **Placement:** does each thing go to one place, without duplicates?
- **Lifecycle:** do items stay current?
- **Consistency:** do the texts and the two hosts agree?
- **Agent leverage:** do the texts teach the agent to use the inbox fully?
- **Prompt craft:** does each text suit the model that reads it?

A skeptic checked each of their 41 findings against the code, and against the measured results in `docs/plans/instructions.md`. 21 survived, and they group into the eight themes below. Where a theme also had a refuted finding, the theme says what that skeptic found. None has been A/B tested yet.

The real saved ledgers give a baseline, 23 sessions on the Claude side:

| Measure | Count |
| --- | --- |
| Questions with options | 21 of 21 |
| Questions with a recommended option | 7 of 21 |
| Tasks with a one-press step | 2 of 4 |
| Closed items marked answered, by a press or by the agent's `close` | 60 of 85 |
| Closed items closed by the inbox model | 5 of 85 |

The saved records do not say whether an answer came from a press or from the agent, so this baseline cannot show how often options are pressed. The A/B runs below measure the items directly instead.

## Themes, most valuable first

### 1. The agent does not know its reply makes the items

- **Where:** `guidanceText` in `hooks/ledger.ts`. Five of the six reviewers found this one independently.
- **What is wrong:** the inbox model builds every question, its options, its recommendation and its one-press steps from the agent's reply. It may copy a recommendation only when the reply states one, and a command only when the reply contains it. The guidance never tells the agent any of this. A reply that asks "How should I handle X?" gives the inbox model little to work with, and the row ends with no recommendation and no step.
- **Proposed wording,** one paragraph after the first:

  > A question you put to the user in a reply becomes an item in their inbox, answered with one press. Name each choice. If you recommend one, say so in a clause ("I'd go with B: it keeps the old API"). Put any command they must run, or text to paste, in its own code block.

- **Left out on purpose:** "ask only when you cannot continue". It would change how often the agent asks, which is a separate experiment.
- **A/B:** one fixture exchange with a real fork between two fixes and a step only the user can run, about 10 runs per version through both models. Count:
  - the share of questions with a recommendation;
  - the share of tasks with a run or copy step;
  - items per reply.

  The guard checks are a reply that asks nothing, and the dismissed-question fixture from `docs/plans/instructions.md`.

### 2. An open item cannot change

- **Where:**
  - `applyUpdate` and `ledgerBlocks` in `hooks/ledger.ts`;
  - the sentence in `systemText` that begins "When the reply restates, rewords or narrows an item";
  - `messages.explain` in `hooks/presses.ts`.
- **What is wrong:**
  - When a NEW line matches an open item, only its steps are merged. Its new ask, options and recommendation are dropped.
  - The inbox model sees each open item as id, kind, label and ask. It never sees the options or recommendation, so it cannot tell a reworded question from a changed one.
  - The Explain press asks why the question came up and what each choice means, but not which choice the agent would pick. So the reply most likely to carry a recommendation often carries none. When it does carry one, the merge in the first bullet drops it.
  - For a task, Explain asks about choices a task does not have.
- **The other direction:** an open item is matched only when its wording overlaps closely. A narrowed question in new words, such as "Staging only for now?" after "Deploy to staging or production?", is added as a second item instead, and the first stays open.
- **Proposed change:** this is a capability change, so it needs Pete's decision.
  - Add an output line `UPDATE: <id> | <options> | <rec>` for an open item whose choices or recommendation changed.
  - Show each open item's options and recommendation in `<open>`.
  - Have Explain ask "and which you would pick" for a question, and "what I need to do" for a task.
- **Risk:** the line about restated items is the one that keeps the model from adding a question twice. An earlier A/B kept restated items out of NEW in 10 of 10 runs, so that guard must stay at 10 of 10.

### 3. Dismissed findings vanish

- **Where:** `addFinding`, `closedText` and `promptNotes` in `hooks/ledger.ts`, and `recordFinding` in `hooks/tools.ts`.
- **What is wrong:**
  - Closed findings are saved, but no text tells either model about them. When the person dismisses a finding, the agent sees it gone from the inbox line with no reason given.
  - `addFinding` checks a new finding only against open findings, and only by exact title. A reworded finding the person dismissed is recorded again, and `recordFinding` answers "Recorded as fN".
- **Proposed change:** this is Proposed change 1 in `docs/plans/instructions.md`, built through to the text the models read.
  - `closedText` lists closed findings the way it lists items: "dismissed by the user. Record it again only if the user brings it up."
  - `addFinding` also refuses a recent dismissed finding with the same meaning, matching the way items are matched.
  - `recordFinding` then says why it did not record.
- **A/B:** dismiss a finding, then give the agent a turn where the same issue shows up again. Count how often it is recorded again.

### 4. A closing line can invent a decision

- **Where:** the `CLOSED` line in `systemText`, and `isLapsed`.
- **What is wrong:**
  - `CLOSED` asks for "what was decided" when the person answered, when the work finished, and when the item stopped mattering. When the agent went ahead on its own default, the model writes a decision the person never made. That outcome reaches the agent as the person's answer.
  - The pane shows an item as lapsed only when the outcome starts with words like "no longer applies". `systemText` never asks for those words.
- **Proposed wording:**

  > CLOSED: <id> | the outcome, at most 8 words. When the person answered, write their answer. When the work is done, write "done: <what>". When nobody decided and the item no longer applies, write "no longer applies: <why>". Never write a choice the person did not make.

- **Risk:** this is the section where a one-word change once made the model re-add dismissed questions. Run the dismissed-question fixture as the guard.

### 5. Who closes a finding

- **What is wrong:** three texts state the rule, each with a different test:
  - the guidance tells the agent to close a finding that is "done or no longer applies";
  - `systemText` lets the inbox model close one the person "dealt with or set aside";
  - `CATCH_UP` closes one that is "no longer relevant".
- **This is already measured.** In `docs/plans/instructions.md`, the inbox model's rule closed a finding the person had only put off, in 3 of 3 runs, and rewording it caused regressions.
- **Proposed change:** none in wording. This adds evidence for the open Decision 3 in that plan: have the code ignore `CLOSED` lines for findings, then drop the finding half of the rule.

### 6. Ids go missing where the agent must close

- **Where:** `messages` in `hooks/presses.ts`, and `recordClose` in `hooks/tools.ts`.
- **What is wrong:**
  - Address, Discuss, a typed reply to a finding and Run leave the row open until the agent closes it. Their messages name the row by its title only.
  - The inbox line with the ids is repeated only when the inbox changed, and after one of these presses it usually has not.
  - When `close` gets an unknown id, it answers that the open ones are "listed beside the user's latest message", which is often false. That id may also have been closed already by a press.
- **How much this matters:** three skeptics refuted the press-message half. Each message quotes the row's title or ask exactly as the inbox line lists it, so the agent can match it to an id while that line is still in context. The real risk is after a compaction or in a long session.
- **Proposed change:**
  - When `close` fails, its answer lists what is open now and says when the id is already closed. This is a code change to a tool result, so a small A/B covers it.
  - Add the row's id to the note sent beside the press, not to the message itself. The message reads as the person's own words.

### 7. A finding asked as a question shows twice

- **Where:** the `NEW` rule in `systemText`, and the closing section of the guidance.
- **What is wrong:** the guidance asks the agent to state a workaround in its reply. The reply often ends by asking whether to fix it, and that question becomes an item. The finding stays open beside it, so the person sees two rows with two sets of buttons.
- **No frequency data yet.** The saved ledgers do not show this case.
- **Proposed wording,** in the guidance:

  > If you ask the user to decide on a finding you recorded, close the finding in the same turn with the reason "asked as a question".

### 8. Codex reads the inbox in two shapes

- **Where:** `inboxToolText` in `codex/src/texts.ts`.
- **What is wrong:** the Codex `inbox` tool builds its own list with different group names. It also prints the pane's row handle, which means nothing to a model. The `inbox:` text and the tool can therefore drift apart.
- **Proposed change:** build the tool's text from `inboxText`. This is a code change, plus an A/B on Codex.

## Pete's goals and what reaches them

| Goal | Themes | What wording cannot reach |
| --- | --- | --- |
| Predictive, anticipatory actions | 1, 2 | |
| Each thing in the right place, once | 3, 7, 8 | |
| Every item current | 2, 4, 5, 6 | |
| The right things at the right time | None | Items expire by turn count, not time. Nothing tells the agent what changed while the person was away. These need new behavior, not new wording. |
| Agents use the inbox to steer the project | 1 | The agent cannot add a question, a task or a card line directly, only through its reply. A tool for that is a design question for Pete. |

## What was read

| Text | Where | Reader | Result |
| --- | --- | --- | --- |
| The guidance | `hooks/ledger.ts:guidanceText` | Claude, Codex | Themes 1, 6, 7 |
| `record_finding` and `close`, their fields and results | `hooks/tools.ts` | Claude, Codex | Themes 3, 6 |
| The inbox model's instructions and input | `hooks/ledger.ts:systemText`, `hooks/ledger.ts:buildPrompt` | Inbox model | Themes 2, 4, 5, 7 |
| The catch-up prompts | `hooks/ledger.ts:catchUpPrompt`, `hooks/ledger.ts:transcriptCatchUpPrompt` | Inbox model or a fork | Theme 5 |
| `inbox:` texts beside a prompt | `hooks/ledger.ts:inboxText`, `hooks/ledger.ts:closedText`, `hooks/ledger.ts:answerNote` | Claude, Codex | Themes 3, 6 |
| The start and compaction block | `hooks/ledger.ts:carryText` | Claude, Codex | No issue |
| Activity and screen lines | `hooks/ledger.ts:toolActivity`, `hooks/ledger.ts:dialogLine`, `hooks/ledger.ts:screenText` | Inbox model | No issue |
| Row press messages | `hooks/presses.ts:messages` | Claude, Codex | Themes 2, 6 |
| PR press messages | `hooks/prs.ts:prompts` | Claude | Read, no issue found |
| Codex tool texts | `codex/src/texts.ts` | Codex | Theme 8 |
| Codex hook context | `codex/src/hook.ts` | Codex | No issue. It passes the shared texts through. |

## Checked and not a problem

The skeptics refuted 20 findings, for these reasons:

- **Already handled.** After a compaction, `carryText` keeps the ids and the recently closed items. The no-recommendation case is the agent's to fix, not the inbox model's to guess.
- **Re-proposed a measured change.** Three proposed rewording the finding-closing rule, which `docs/plans/instructions.md` measured and rejected.
- **Unproven.** A missing example of the line format, the catch-up prompt's order, and the card's list rules. No failure was shown for any of them.

## Proposed order

1. Theme 1. It is wording only, it touches only the agent's guidance, and it has the biggest effect on predictive items.
2. Theme 3 and theme 6's close result. These are code changes with small model-read edits.
3. Theme 2. It needs a decision on the `UPDATE` line.
4. Theme 4. It needs the most careful A/B.
5. Theme 5 waits on Decision 3 in `docs/plans/instructions.md`.
6. Themes 7 and 8.

Theme 1's wording goes in `guidanceText`, which builds the guidance for both agents. That function comes from step 5 of `docs/plans/three-looks.md`, which is written but not yet committed.
