// Built by codex/build.mjs from codex/src and hooks/. Do not edit.

// src/server-main.ts
import { stat } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/state.ts
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
function dataDir(env, pluginRoot) {
  const fromEnv = env.INBOX_DATA || env.PLUGIN_DATA;
  if (fromEnv) return fromEnv;
  const m = pluginRoot.match(/^(.*)\/plugins\/cache\/([^/]+)\/([^/]+)\/[^/]+$/);
  if (m) return `${m[1]}/plugins/data/${m[3]}-${m[2]}`;
  return join(homedir(), ".codex", "inbox-dev");
}
async function devBuild(dir2) {
  try {
    const d = JSON.parse(await readFile(join(dir2, "dev.json"), "utf8"));
    if (typeof d.pid !== "number") return null;
    process.kill(d.pid, 0);
    return d;
  } catch {
    return null;
  }
}

// src/server-main.ts
var here = dirname2(fileURLToPath(import.meta.url));
var dir = dataDir(process.env, dirname2(here));
async function handlerPath() {
  const server = (await devBuild(dir))?.server;
  const isBuilt = server ? await stat(server).then(
    () => true,
    () => false
  ) : false;
  return server && isBuilt ? server : join2(here, "server-handler.mjs");
}
var current = null;
var lastLoaded = null;
var loadError = null;
function load(url, path) {
  const handle = import(url).then((m) => m.createHandler(dir, () => loadError));
  handle.then(
    (h) => {
      lastLoaded = h;
      loadError = null;
    },
    (err) => {
      loadError = `${path}: ${err instanceof Error ? err.message : String(err)}`;
      process.stderr.write(`inbox: could not load ${loadError}
`);
    }
  );
  return handle;
}
async function currentHandler() {
  const path = await handlerPath();
  const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: -1 }));
  const key = `${pathToFileURL(path).href}?v=${mtimeMs}`;
  if (current?.key !== key) current = { key, handle: load(key, path) };
  const { handle } = current;
  try {
    return await handle;
  } catch (err) {
    if (lastLoaded) return lastLoaded;
    throw err;
  }
}
var reply = (r) => process.stdout.write(`${JSON.stringify(r)}
`);
var ready = Promise.resolve();
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const handler = ready.then(currentHandler);
  ready = handler.catch(() => void 0);
  void handler.then(
    (handle) => handle(message).then((r) => {
      if (r) reply(r);
    }),
    (err) => {
      if (message.id === void 0) return;
      const why = err instanceof Error ? err.message : String(err);
      reply({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: `The inbox server could not load: ${why}` }
      });
    }
  );
});
