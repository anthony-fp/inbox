# Submitting the inbox to the Claude Code plugin directory

Status: building. The fixes and the README section are made. The open questions wait on Pete, and only a resubmit confirms the fixes.

The directory scans a submitted plugin and reports findings at four levels
([pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)):

- **Block**: the plugin can't be submitted until it's fixed.
- **Policy hold**: the plugin can be submitted, and a reviewer reads it before it goes live.
- **Warning**: can be submitted as is.
- **Note**: information only.

`claude plugin validate` does not run the directory's rules, so only a resubmit confirms a fix.

## Fixes

| Finding | Fix |
|---|---|
| Permission hook answers `allow` (`hooks/register.tsx`, the two `tool.check` hooks) | Delete both hooks. They never run: the mod answers `record_finding` and `close` in `tool.call`, which settles the call before the permission check. Checked on Claude Code 2.1.300 with a probe mod under `claude -p --permission-mode default`: a `tool.check` that denies changes nothing, and with no `tool.check` the tool runs with no prompt. That holds with a catch-all `tool.call` hook that passes calls on, registered before or after, as the mod has. Not checked in the desktop app, which answers permission prompts through the Agent SDK. |
| Directory couldn't confirm the `PermissionRequest` hook leaves the decision with the user | Add `.catch(($, e, next) => next(e))`, so a throw in `openDialog` still passes the check on unchanged. Not confirmed to be what the scan needs. |
| `$` or `on` used in a way the directory couldn't follow (3) | Prettier splits one `on(` call and 13 `$.noun⏎.method()` chains across lines. The 13 chains now read `$.noun.method(` on one line; ten of them were delayed redraws and go through a `later()` helper. The `on('session.append', …)` call stays split: on one line it is 3 characters over Prettier's width, and shortening its matcher would change what it matches. The scan didn't say which 3 findings it meant; the resubmit will. |
| No `author` in plugin.json | Add `{ "name": "Pete Petrash" }`, plus `repository` and `license`. |
| No `version` in plugin.json | Add a version that matches the Codex plugin's, now `0.2.5`. Installs update only when the version goes up, so each release raises it in both manifests. |

## Disclose in the README

Each of these is a policy hold. The README's "What it runs, sends and changes" section covers them:

- Programs it starts: `gh` (read-only PR queries), `open` and `test -x` (opening a file or link you press), `herdr` (a sidebar line, only inside Herdr).
- Data sent out: conversation text to Anthropic through Claude Code's own model calls (the Sonnet update after each reply, and the catch-up); `gh` queries to GitHub under your `gh` sign-in. The `gh` sign-in is the likely "credential from the user's machine". Asking for a GitHub token through `userConfig` would be worse for the user, so this stays disclosed rather than changed.
- Prompts it submits: the text of a button you press, sent as your message.
- Context it adds: its instructions (`prompt.compose`), notes beside your prompt (`prompt.submit`, `session.append`).
- Hooks that observe: `tool.call` (notes what tools ran, opens a row for a question), `PermissionRequest` (opens a row while a permission prompt is open, then passes it on), `config.set` (reads the theme).
- Tools it adds and answers itself: `record_finding`, `close`, and the `/inbox` command.

## Leave as is

- **`types` in plugin.json** flagged as unknown. It's a documented manifest field for mods, and `claude plugin validate` reads it. The directory's scan lags here.
- **CLAUDE.md at the plugin root**, **the oversized `docs/reference/claude-code-mods.md`**, and **`npx -y` in `scripts/check.sh`** (the download-and-run findings). These exist because the plugin is the whole repo (`"source": "./"`). Each is a warning or a hold. Pete chose to keep shipping the whole repo.
- **Mod adds tools, commands or agents**: a note.

## Open questions for Pete

1. **Which findings block?** Confirm in the portal which of the unlabeled findings are blocks, and where the 3 `$` findings and the 7 credential findings point.
2. **Icon.** The portal hasn't saved the listing yet, so the icon is still open. The directory takes it only the first time the plugin is saved or submitted, so a square PNG, 512–2048 px, must be in place before that.
3. **Name.** `inbox` may be confused with other listings (4 findings). Pete chose to keep `inbox` for now. A later rename can change `displayName` alone, which changes only what people see. Changing `name` also changes the install command, the tool names Claude calls, and the key the saved state is stored under.
