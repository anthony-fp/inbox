# Inbox instructions: review and plan

Status: building. The decisions below are not settled.

Goal: each instruction the mod gives has one role, each rule is written in one
place, and findings reach the Findings tab at the right time and leave it with
a record.

## What each instruction is for

Claude reads seven kinds of text from the mod. The inbox model, the Sonnet call
that updates the inbox after each reply, reads two.

| Text | Read by | When | Role |
| --- | --- | --- | --- |
| `guidanceText`, the "# Inbox" system prompt section | Claude | Every turn | What the inbox shows; when to record a finding; the latest inbox line is the current state; when to close |
| `record_finding` description and fields | Claude | Every turn | What happens to a finding; the bar; the fields |
| `close` description and fields | Claude | Every turn | Where the id comes from; answer or reason |
| Inbox line (`inboxText`, `closedText`) | Claude | Beside a prompt, when the inbox changed | Open items and findings with ids; what closed since, with when to ask again |
| Answer line (`answerNote`) | Claude | Beside a prompt that answers numbered items | Which items the numbers mean |
| Start-of-context block (`carryText`) | Claude | At session start and after compaction | Goal, done, now, open items, findings, recently closed; a later inbox line replaces it |
| Button messages | Claude, as your message | When you press | One action on one item, finding or PR row |
| `systemText` | Inbox model | After each reply | Card, new items, closing items and findings |
| `catchUpPrompt` | A fork of the conversation | After a failed update, or a mid-conversation load | Same as `systemText`, over the whole conversation |

## Done

- Each rule is written once. `guidanceText` holds when to record and when to
  close. The tool descriptions hold only what a call needs.
- The mention rule: a workaround or a part Claude cannot check from where it
  is goes in the reply as well as in a finding. Other findings are mentioned
  only when they bear on what the user asked.
- The recording bar: Claude checks a finding once before recording it. A
  problem in its own change, a check it could run, progress, and anything only
  the user can do or decide are not findings. Claude fixes, runs, says or asks
  them instead, so a blocker reaches Needs you as a question or task.
- The bar excludes "anything the user already decided", not "anything already
  discussed".
- Claude reads "Closed" everywhere: the inbox line and the start-of-context
  block. The inbox line says that anything it does not list is closed.
- An expired question is told to Claude as "expired before the user answered.
  Ask it again if it still matters", not as settled. The inbox model no longer
  sees expired items among the settled ones, so a question asked again shows
  again.
- A dismissed question carries "Ask it again only if the user brings it up" on
  its own line.
- `record_finding` answers with the new finding's id, so Claude can close it
  in the same turn.
- Every way a finding leaves goes to Closed with its outcome, and the inbox
  line tells Claude, so a dismissed finding is not recorded again.
- Fix, File issue, Discuss and Reply keep the finding open until Claude
  closes it. Dismiss closes it.
- The inbox model closes a finding only with a `FIXED` line, when the
  conversation shows a change fixed it. A `CLOSED` line no longer closes one.
  The measurements are in `docs/plans/prompt-audit.md`.

## Still open

1. **The roadmap would replace Findings.** ROADMAP.md plans "Claude's calls
   replace Findings": the tab becomes a list of calls Claude made, shown as
   "question → choice, not alternative". That is a different purpose from the
   one agreed for Findings.
2. **Nothing measures misses.** A finding Claude never records leaves no
   trace.

The inbox model's input still calls closed items `<decided>`, "items the
person already settled". Renamed to `<closed>`, "items closed recently", the
model re-added a dismissed question in 4 of 5 runs.

## Proposed changes

1. Optional: at turn end, a reply that says it left something untested or
   unfixed, with no finding recorded that turn, is sent back once. It catches
   misses, at the cost of some false alarms.

## Decisions

1. Roadmap: drop "Claude's calls replace Findings", or keep it?
2. Turn-end check for unrecorded findings: build it, or leave it out?
