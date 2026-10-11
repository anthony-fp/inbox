# Done on a task

Status: built. Not yet tried in the real apps.

When the person presses Done on a task the agent is waiting on, the agent gets one short message once the row's Undo ends. Otherwise Done stays silent, and the agent reads the close beside the next prompt.

## The rule

`doneWake` in `hooks/presses.ts` decides. Both clients call it:

- The Claude mod calls it when the Undo time (`SETTLED_MS`) ends after a Done, and when a turn ends.
- The Codex server calls it when its settle window (`SETTLE_WINDOW_MS`) ends after a Done, and at each poll of the tab. The poll covers a server restart, which loses the timer.

A Done close goes out when all of these hold:

- **It was a Done press.** A task closed because the person ran its command ("you ran it") stays silent.
- **The agent waits on it.** The agent raised the task in its latest reply, and the person has sent no prompt since. A prompt since would have carried the close to the agent, as when the person types "done" before the Undo time ends.
- **Its Undo time has ended.** While any such Done is younger than that, nothing goes, so Done presses in a row go as one message.
- **No turn is running.** The agent reads the close beside the next prompt.

The message:

```
Done: <ask>
```

For several tasks, one line each under "Done:".

The wording is plain on purpose. The inbox model, which updates the inbox after each reply, closed an unrelated open question more often after a longer wording, "I've done the task you left for me: "<ask>"": 13 of 32 runs, against 4 of 24 for a typed message. "Done: <ask>" closed it in 4 of 24, the same as typed.

## Undo

The close is marked `isSentToAgent` before the message goes. Undo then reads stale, since the agent was told. A message that fails to send keeps the mark, and the agent reads the close beside the next prompt.

## Scenarios

| Scenario | Message? |
| --- | --- |
| The agent ended its turn waiting on this task: a login, an approval, a manual step | Yes |
| The agent is mid-turn | No. The next prompt carries the close. |
| The task came from an earlier reply, and the person has prompted since | No |
| The person typed "done" before the Undo time ended | No |
| Several Dones in a row | One message |
| The person pressed Undo | No |
| The task closed because the person ran its command | No |

## Left out

A task raised several replies ago that the agent still waits on stays silent. Matching it through the card's Now line was considered. That match is a loose word overlap, and after a Claude reload the mod no longer knows which closes the agent read, so it could tell the agent twice.

## Evidence

- **The inbox model.** `evals/cases.json` has `done-message-blocked-task` and `done-message-independent-task`: the message adds no item and leaves an unrelated question open. Codex passed 16 of 16. Sonnet passed 14 of 16; its misses closed the question as outside the card's goal, which a typed message also does.
- **The agent.** With the conversation before the message, a blocked agent went on to publish in 10 of 10 runs across Sonnet and Codex. An agent whose task blocked nothing replied in a line or two and started no work in 10 of 10.
- **Not yet tried in the real apps.** The rule is covered by `tests/hooks.test.ts` and `codex/tests/server.spec.ts`.
