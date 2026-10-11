# Live reload for the Codex tab

**Goal:** while `npm --prefix codex run dev` runs, a saved change to the tab shows in an open Codex Inbox tab within a few seconds. You don't reinstall, reopen the tab, or start a new chat. Changes to the server or hooks still need a build, a reinstall and a restart of the Codex app.

## Why a change takes so long to show today

Three copies of the tab's page sit between a saved file and the screen:

1. **The build.** `codex/build.mjs` inlines the tab's script into `tab.html` and bundles that page into `plugin/dist/server.mjs` as a string.
2. **The install.** `codex plugin add` copies `plugin/` into `~/.codex/plugins/cache/inbox/inbox/0.1.0/`, and Codex runs the server from there.
3. **The running server.** Codex starts a server process and keeps it running. That process holds the page from its start in memory. Live on 2026-10-10, two servers started at 13:21 were still running after a 13:25 reinstall. The open tab kept drawing the old buttons.

Codex also keeps its own copy of the page, keyed by the page's address, `ui://inbox/tab`. Live on 2026-10-10, a test build ran in a server started for a new chat, and the new chat's tab still drew the old page. The OpenAI docs say to treat the resource URI as a cache key and publish a new URI when the page changes.

## The design

1. **Dev build.** `npm --prefix codex run dev` (`build.mjs --dev`) rebuilds the page on every save into `codex/.dev/tab.html`, which Git ignores.
2. **Pointer file.** While it runs, the dev script writes `dev.json` into the plugin's data folder, `~/.codex/plugins/data/inbox-inbox/`. The file holds the path to that `tab.html`. The script deletes it on exit.
3. **Server.** On each call from the tab, the server checks for `dev.json`. When it exists, the server adds the dev page's address, a hash of the page, to the view as `devPage`. It reads the page again only when the file changes. A new app-only tool, `inbox_tab_page`, returns the page's text. With no `dev.json`, nothing changes.
4. **Tab.** The server stamps each page it serves with its address, as `window.__inboxPage`. When a poll brings a different `devPage`, the tab fetches the page through `inbox_tab_page` and replaces its own document.
5. **Server check.** A swapped-in page can be built from newer server sources than the server Codex is running. On 2026-10-10 the app's inbox servers had run since 16:14, through several reinstalls and new chats. A page that needed a view field added at 17:51 drew every row without its actions. So each build hashes the server's sources and stamps the hash into the server and into the tab page. The server sends it with each view as `serverBuild`. When it differs from the page's own, the tab says to quit and reopen Codex. A server built before this check sends none, which also counts as different.

The installed server reads the worktree's files only while `dev.json` exists, and only the one path it names.

## The simpler path, and why it falls short

With the per-build address, a rebuild and a reinstall show in the next new chat's tab. Running servers keep the old page in memory, so a tab that is already open stays old. Live reload is for changing the page while you watch it.

## Test results, 2026-10-10

- **Codex keeps the page by its address.** Under the old address, a new chat's tab drew the old page. Under a new address it drew the test build. Done: the address now carries a hash of the page (`tabUri` in `codex/src/server.ts`). After a reinstall, a new chat shows the new page with no app restart.
- **The tab can replace its own document.** The test tab fetched a page through a tool and wrote it over its own document. The new page's `ui/initialize` was answered, and its polls worked. A press after the swap was not tried. Polls and presses both go through `tools/call`.

So the design above works as written, and it is built.
