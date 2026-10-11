# Should Done on a task wake the agent?

## Recommendation

Done sends the agent a short message when the agent is likely waiting on that task. It stays silent otherwise.

The message goes out when the Undo window closes, so Undo keeps working. Several Dones in that window go out as one message.

## How it works today

Done is a Mark: it changes the inbox and sends nothing (`hooks/presses.ts`, `docs/plans/inbox-ui.md`). The same is true in all three clients, since they share the `pressed()` reducer.

The agent learns about it only when the person next types. Beside that prompt it reads:

```
Closed since you last read the inbox:
- "<ask>" → done
```

So an agent that ended its turn waiting on a login or a manual step sits idle until the person types "done" in the chat as well. That double step is the problem.

Undo exists because Done sends nothing. A sent message cannot be taken back.

Other task actions that do send: Reply, Explain and a Run step. Dismiss and a matching shell command the person ran (closed as "you ran it") are silent.

## Scenarios

| Scenario | Wake? | Why |
| --- | --- | --- |
| The agent ended its turn waiting on this task: a login, an approval, a manual step | Yes | Otherwise it sits idle until the person types. |
| The agent is mid-turn | No send needed now | Its next prompt carries the close. A send would only queue behind the turn. |
| The task came from an earlier goal, many turns ago | No | Waking would restart finished work. |
| The task was independent of the agent's work, such as "check the pane in the light theme" | No | The agent has nothing to continue. |
| Several Dones in a row | One message | Separate messages would start several turns. |
| The person pressed Undo | No | Nothing was sent yet, because the send waits for the Undo window. |
| The task closed because the person ran its command | Same rule as Done | The agent learns the same fact either way. |

## Deciding "likely waiting"

The inbox has no field that says the agent is blocked on a task. What exists:

- A task (`kind: 'task'`) is defined to the inbox model as something "without which the agent cannot continue or finish". So most tasks are blockers by definition.
- `task.turn` says which turn raised it. A task raised in the agent's latest reply, with no turn since, is the clearest waiting case.
- Whether a turn is running now.

Proposed rule: wake when no turn is running and the task was raised in the most recent reply, or is named on the card's Now line. Everything else stays silent and the agent reads the close beside the next prompt, as today.

A sharper signal would be a field on the NEW line saying whether the agent's next step waits on the task. That is model-read text, so it needs an A/B run before it ships. Start with the turn-based rule and add the field only if the rule misfires.

## Message

```
Done: "<ask>". Continue with what was waiting on it.
```

For several: one line per task under "Done:".

## Open questions

- Should independent tasks, ones that block nothing, exist at all? The inbox model's definition says no, so they may be rare in practice.
- Should Codex use the same rule? It can: `codex queue` already queues behind a running turn.
