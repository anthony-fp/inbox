// Built by codex/build.mjs from codex/src and hooks/. Do not edit.

// src/hook-main.ts
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/hook.ts
import { spawn } from "node:child_process";
import { resolve as resolve2 } from "node:path";

// ../hooks/ledger.ts
var EMPTY = {
  card: null,
  items: [],
  closed: [],
  findings: [],
  closedFindings: [],
  prs: [],
  nextId: 1,
  turn: 0,
  batchTurn: 0
};
var EXPIRED = "expired, unanswered";
function readKind(kind) {
  return kind === "task" || kind === "do" ? "task" : "question";
}
function upgradeLedger(ledger) {
  const { notes, decided, ...rest } = ledger;
  return {
    ...rest,
    findings: [...rest.findings ?? [], ...notes ?? []],
    // reopenFinding puts these back, so a conversion added for findings must run on them too.
    closedFindings: rest.closedFindings ?? [],
    items: rest.items.map(upgradeItem),
    closed: (rest.closed ?? decided ?? []).map((d) => ({
      ...d,
      kind: readKind(d.kind),
      how: d.how ?? howFromOutcome(d.outcome),
      ...d.item ? { item: upgradeItem(d.item) } : {}
    }))
  };
}
function upgradeItem(item) {
  return { ...item, kind: readKind(item.kind), at: item.at ?? null, rec: recommendedOption(item.options, item.rec) };
}
function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function recommendedOption(options, rec) {
  if (!rec) return null;
  const named = new Set(words(rec));
  let best = null;
  for (const option of options) {
    const w = words(option);
    if (w.length > words(best ?? "").length && w.every((x) => named.has(x))) best = option;
  }
  const label = (text) => text.match(/^\s*\(?([a-z]|\d{1,2})\s*[:.)]/i)?.[1]?.toLowerCase();
  const byLabel = /^\s*(?:option\s+)?([a-z]|\d{1,2})\s*[.!]?\s*$/i.exec(rec)?.[1]?.toLowerCase();
  return best ?? (byLabel ? options.find((o) => label(o) === byLabel) ?? null : null);
}
function howFromOutcome(outcome) {
  if (outcome === "dismissed") return "dismissed";
  if (outcome === EXPIRED) return "expired";
  if (outcome === "done" || outcome === "you ran it") return "done";
  if (outcome.startsWith(CLOSED_BY_CLAUDE)) return "claude";
  return "update";
}
var CLOSED_BY_CLAUDE = "closed by Claude";

// ../hooks/model-text.ts
var NL = "\n";
function guidanceText(host) {
  return `# Inbox
${host.intro}

When you ask the user to decide something, say which option you recommend and why, in one clause ("I'd go with B: it keeps the old API"). If you cannot recommend one, say what would decide it.

When you ask the user to do something, such as review a page, sign in or run a command, give them what they need in the same reply: the link, file path or command, what to do there, and how the result gets back to you. If the result would stay where you cannot read it, such as in their browser, give them a way to send it to you.

A finding is something you noticed that deserves the user's attention but is outside the current task: a bug, a risk, missing tests, tech debt, or a chance to improve something. Record it with mcp__inbox__record_finding the moment you notice it, then go on with the task; fixing it waits until the user asks. Record one too at two moments that are easy to pass over while focused on the task:
- You work around a problem instead of fixing it, such as copying files by hand because a tool does not reach them.
- Part of your change could not be tested or verified.
State those two in your reply as well. Mention any other finding only when it bears on what the user asked.

The latest "inbox:" text beside the user's prompt is the current state. It lists every open item and finding with its id, such as [i35] or [f12], and anything it does not list is closed. Check it before telling the user that something is open or waits on them. The ids are for the inbox tools only. The user never sees them, so never write one to the user, not even in parentheses: name an item or finding by what it says, as "the deploy task" or "the migration finding".

Close with mcp__inbox__close:
- When the user's message answers an open item, close it first, before other work, with their answer.
- When an item or finding is done or no longer applies, close it with a short reason, without waiting to be asked.
The answer to a question is the user's to give. Close a question with their answer, or once it no longer applies, and never with an answer of your own.`;
}
var START_TITLE = 'inbox: where this session stands, as of the last reply. An "inbox:" text beside a later prompt replaces this.';
var MAX_ACTIVITY = 40;
function addActivity(activity, line) {
  return !line || activity.length >= MAX_ACTIVITY || activity.includes(line) ? activity : [...activity, line];
}
function toolActivity(tool, input) {
  const text = (key) => typeof input[key] === "string" ? input[key] : "";
  switch (tool) {
    case "Bash":
      return `${input.run_in_background ? "started in background" : "ran"}: ${text("command").slice(0, 140)}`;
    case "Edit":
    case "Write":
      return `edited ${text("file_path")}`;
    case "Skill":
      return `used skill ${text("skill")}`;
    case "Agent":
      return `started agent: ${text("description")}`;
  }
  return tool.startsWith("mcp__") ? `called ${tool.slice(5)}` : null;
}
function surfaceAtStart(host) {
  return host.surface.charAt(0).toUpperCase() + host.surface.slice(1);
}
function screenText(host, isOpen, tab) {
  return isOpen ? `${surfaceAtStart(host)} is open beside the conversation, ${tab ? `on its ${tab} tab, ` : ""}listing every open item.` : `${surfaceAtStart(host)} is closed.`;
}
function latestBatch(ledger) {
  return ledger.batchTurn === 0 ? [] : ledger.items.filter((i) => i.turn === ledger.batchTurn);
}
function describe(item) {
  const parts = [`"${item.ask}"`];
  if (item.options.length > 0) parts.push(`options: ${item.options.join(" / ")}`);
  if (item.rec) parts.push(`recommended: ${item.rec}`);
  if (item.kind === "task") parts.push("an action for the user");
  return parts.join("; ");
}
function numberOf(label) {
  const m = label?.match(/(?:^|[^A-Za-z\d])(?:[QqDd#]\s?)?(\d{1,2})(?!\d)/);
  return m ? Number(m[1]) : null;
}
function answerableBatch(ledger, promptTurn) {
  return ledger.batchTurn === promptTurn - 1 ? latestBatch(ledger) : [];
}
function batchNumbers(batch) {
  const hasLabels = batch.some((i) => numberOf(i.label) !== null);
  const byNumber = /* @__PURE__ */ new Map();
  batch.forEach((item, at) => {
    const n = hasLabels ? numberOf(item.label) : at + 1;
    if (n !== null && !byNumber.has(n)) byNumber.set(n, item);
  });
  return byNumber;
}
var LINE_ANSWER = /(?:^|\n)\s*(?:[QqDd#]\s?)?(\d{1,2})\s*[.):\-–]\s*\S/g;
var INLINE_ANSWER = /\s(?:[QqDd#]\s?)?(\d{1,2})\s*[.)]\s+\S/g;
var ACCEPT_ALL = /^\s*(go|go ahead|yes|yep|yeah|sure|ok|okay|sgtm|lgtm|sounds good|do it|proceed|all good|ship it)\s*[.!]*\s*$/i;
var ACCEPT_RECS = /\b(all|both|everything|your)\b[^.\n]{0,40}\b(recommend\w*|recs?|suggest\w*|picks?|calls?)\b/i;
function answerNote(ledger, text) {
  const lines = [];
  const batch = answerableBatch(ledger, ledger.turn);
  if (batch.length > 0) {
    const numbers = /* @__PURE__ */ new Set();
    for (const m of text.matchAll(LINE_ANSWER)) numbers.add(Number(m[1]));
    if (/^\s*(?:[QqDd#]\s?)?\d{1,2}\s*[.):\-–]\s/.test(text)) {
      for (const m of text.matchAll(INLINE_ANSWER)) numbers.add(Number(m[1]));
    }
    const byNumber = batchNumbers(batch);
    for (const n of [...numbers].sort((a, b) => a - b)) {
      const item = byNumber.get(n);
      if (item) lines.push(`- ${n} \u2192 ${describe(item)}`);
    }
    if (lines.length === 0 && (ACCEPT_ALL.test(text) || ACCEPT_RECS.test(text))) {
      const withRecs = batch.filter((i) => i.rec);
      if (withRecs.length > 0) {
        return [
          "inbox: if the user is accepting your recommendations, these are the open ones:",
          ...withRecs.map((i) => `- ${i.label ?? "\u2022"} \u2192 ${describe(i)}`)
        ].join(NL);
      }
    }
  }
  return lines.length === 0 ? null : ["inbox: the user's message answers these open items from your earlier replies:", ...lines].join(NL);
}
function itemLine(item, withId) {
  return `- ${withId ? `[${item.id}] ` : ""}${item.label ? `(${item.label}) ` : ""}${describe(item)}`;
}
function findingLine(finding, withId) {
  return `- ${withId ? `[${finding.id}] ` : ""}${finding.kind}: ${finding.title}`;
}
function carryText(ledger, title, isOwn = false) {
  const findings = ledger.findings;
  if (!ledger.card && ledger.items.length === 0 && findings.length === 0) return null;
  const out = [title];
  if (ledger.card) {
    if (ledger.card.goal) out.push(`Goal: ${ledger.card.goal}`);
    if (ledger.card.done.length > 0) out.push(`Done: ${ledger.card.done.join("; ")}`);
    if (ledger.card.now) out.push(`Now: ${ledger.card.now}`);
    if (ledger.card.running.length > 0) out.push(`Running: ${ledger.card.running.join("; ")}`);
  }
  if (ledger.items.length > 0) {
    out.push("Waiting on the user:");
    for (const item of ledger.items) out.push(itemLine(item, isOwn));
  }
  if (findings.length > 0) {
    out.push(isOwn ? "Findings you recorded, still open:" : "Findings that session recorded, still open:");
    for (const f of findings) out.push(findingLine(f, isOwn));
  }
  if (ledger.closed.length > 0) {
    out.push("Recently closed:");
    for (const d of ledger.closed.slice(-6)) out.push(`- "${d.ask}" \u2192 ${outcomeText(d)}`);
  }
  return out.join(NL);
}
function inboxText(host, ledger, isOpen) {
  const out = ["inbox: what waits on the user, as of your last reply. Anything not listed here is closed."];
  if (ledger.items.length > 0) {
    out.push("Waiting on the user:");
    for (const item of ledger.items) out.push(itemLine(item, true));
  } else {
    out.push("Nothing is waiting on the user.");
  }
  if (ledger.findings.length > 0) {
    out.push("Findings you recorded, still open:");
    for (const f of ledger.findings) out.push(findingLine(f, true));
  }
  out.push(isOpen ? `The user has ${host.surface} open beside the conversation.` : `${surfaceAtStart(host)} is closed.`);
  return out.join(NL);
}
function outcomeText(d) {
  if (d.how === "dismissed") return "dismissed by the user";
  if (d.how === "expired") return "expired before the user answered";
  return d.outcome;
}
function closedText(closed) {
  if (closed.length === 0) return null;
  const advice = (d) => d.how === "dismissed" ? ". Ask it again only if the user brings it up." : d.how === "expired" ? ". Ask it again if it still matters." : "";
  return [
    "Closed since you last read the inbox:",
    ...closed.map((d) => `- "${d.ask}" \u2192 ${outcomeText(d)}${advice(d)}`)
  ].join(NL);
}
var TOLD_NOTHING = { inbox: null, closed: [] };
function promptNotes(host, ledger, prompt, told) {
  const notes = [];
  const answer = prompt.isPress ? null : answerNote(ledger, prompt.text);
  if (answer) notes.push(answer);
  const inbox = inboxText(host, ledger, prompt.isOpen);
  const toldClosed = new Set(told.closed);
  const closed = closedText(ledger.closed.filter((d) => !toldClosed.has(d.id)));
  const isEmpty = ledger.items.length === 0 && ledger.findings.length === 0;
  if (!closed && (inbox === told.inbox || isEmpty && told.inbox === null)) return { notes, told };
  notes.push(closed ? `${inbox}${NL}${closed}` : inbox);
  return { notes, told: { inbox, closed: ledger.closed.map((d) => d.id) } };
}

// ../hooks/prs.ts
var PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;
function prRefs(text) {
  return [...new Set([...text.matchAll(PR_URL)].map((m) => `${m[1]}#${m[2]}`))];
}

// ../hooks/presses.ts
var HANDOFF_IDS = /^(address|type|step-\d+|thread-address|pr-conflicts|pr-address-all)$/;
var PR_RENAMES = [
  [/^address-all-/, "pr-address-all"],
  [/^resolve-/, "pr-conflicts"]
];
var THREAD_RENAMES = [
  [/^address-/, "thread-address"],
  [/^draft-/, "thread-draft"],
  [/^discuss-/, "thread-discuss"]
];
var ROW_RENAMES = [
  [/^explain(-|$)/, "explain"],
  [/^(help-.+-|step-)\d+$/, (old) => `step-${old.split("-").pop()}`],
  [/^typed$/, "type"],
  [/^address(-|$)/, "address"],
  [/^discuss(-|$)/, "discuss"]
];
function upgradedLastAction(key, old) {
  const renames = key.startsWith("pr:") ? PR_RENAMES : key.includes(" thread ") ? THREAD_RENAMES : ROW_RENAMES;
  const found = renames.find(([pattern]) => pattern.test(old.action));
  const action = found ? typeof found[1] === "function" ? found[1](old.action) : found[1] : null;
  if (action === null) return null;
  const { isHandoff, ...kept } = old;
  const isHandedOff2 = isHandoff ?? HANDOFF_IDS.test(action);
  return {
    ...kept,
    kind: isHandedOff2 ? "handoff" : "talk",
    action,
    // Earlier builds saved "Explain sent" or "Sent to Claude to fix"; a last action is now the label pressed.
    text: /^Sent to (Claude|Codex) to /.test(old.text) ? "Address" : old.text.replace(/ sent$/, "")
  };
}
function upgradeLastActions(saved) {
  return Object.fromEntries(
    Object.entries(saved).flatMap(([key, entry]) => {
      const {
        tab: _tab,
        title: _title,
        index: _index,
        ...last
      } = entry;
      if ("kind" in last && last.kind) return [[key, last]];
      const upgraded2 = upgradedLastAction(key, last);
      return upgraded2 ? [[key, upgraded2]] : [];
    })
  );
}
function withArrival(lastActions, message, pressedAt, deliveryId) {
  const isWaiting = (a) => (a.delivery?.state === "queued" || a.delivery?.state === "unconfirmed") && a.delivery.message === message;
  const waiting = Object.values(lastActions).filter(
    (a) => isWaiting(a) && (deliveryId ? a.delivery?.id === deliveryId : a.delivery?.id === void 0)
  );
  if (waiting.length === 0) return lastActions;
  const at = pressedAt ?? Math.min(...waiting.map((a) => a.at));
  return Object.fromEntries(
    Object.entries(lastActions).map(([id, a]) => [
      id,
      isWaiting(a) && (deliveryId ? a.delivery?.id === deliveryId : a.delivery?.id === void 0 && a.at === at) ? { ...a, delivery: { state: "arrived" } } : a
    ])
  );
}
function withUnconfirmed(lastActions, message, pressedAt, deliveryId) {
  return Object.fromEntries(
    Object.entries(lastActions).map(([id, action]) => [
      id,
      action.delivery?.state === "queued" && action.delivery.message === message && (deliveryId ? action.delivery.id === deliveryId : pressedAt === void 0 || action.delivery.id === void 0 && action.at === pressedAt) ? { ...action, delivery: { ...action.delivery, state: "unconfirmed" } } : action
    ])
  );
}

// ../hooks/view.ts
var CHOICE_KEYS = [..."abcfghilm"];
var SETTLED_MS = 5120;
var TABS = [
  { id: "needsYou", label: "Needs you", hotkey: "1" },
  { id: "findings", label: "Findings", hotkey: "2" },
  { id: "prs", label: "PRs", hotkey: "3" }
];
var ROW_TABS = TABS.filter((t) => t.id !== "prs");

// ../hooks/pr-tab.ts
function linkedPrs(prs, refs) {
  return [...prs.filter((r) => !refs.includes(r)), ...refs];
}

// src/settle.ts
var POLL_MS = 3e3;
var SETTLE_WINDOW_MS = SETTLED_MS + 2 * POLL_MS;

// src/texts.ts
var CODEX = {
  agent: "Codex",
  surface: "the Inbox tab",
  band: null,
  findingsIn: "the Findings section of the Inbox tab",
  intro: "The inbox plugin shows the user what waits on them: your open questions and the tasks only they can do, and your findings, in the Inbox tab beside the conversation."
};

// src/core.ts
var TAB_OPEN_MS = 15e3;
function isTabOpen(s, now) {
  return now - s.tabSeenAt < TAB_OPEN_MS;
}
function startContext(s, source) {
  const carried = carryText(s.ledger, START_TITLE, true);
  const parts = [source === "resume" ? null : guidanceText(CODEX), carried].filter((x) => x !== null);
  return parts.length > 0 ? parts.join("\n\n") : null;
}
function cleared(s) {
  return {
    ...s,
    ledger: EMPTY,
    turn: { person: null, activity: [], press: null },
    told: { inbox: null, closed: [] },
    pending: [],
    lastActions: {}
  };
}
function notePrompt(s, text, now) {
  const matchingAt = s.sent.findIndex((x) => x.text === text);
  const matching = matchingAt >= 0 ? s.sent[matchingAt] : void 0;
  const sentAt = matching && (matching.phase === void 0 || matching.phase === "accepted") ? matchingAt : -1;
  const sentBy = sentAt >= 0 ? s.sent[sentAt]?.press ?? null : null;
  const sent = sentAt >= 0 ? s.sent[sentAt] : void 0;
  const eligible = sent?.deliveryId === null ? Object.fromEntries(
    Object.entries(s.lastActions).filter(
      ([_id, last]) => (last.delivery?.state === "queued" || last.delivery?.state === "unconfirmed") && last.delivery.id === void 0
    )
  ) : s.lastActions;
  const arrived = sent && sent.row !== null ? {
    ...s.lastActions,
    ...sent.deliveryId === null ? withUnconfirmed(eligible, text) : withArrival(eligible, text, sent.pressedAt ?? void 0, sent.deliveryId)
  } : s.lastActions;
  const lastActions = s.sent.slice(matchingAt + 1).reduce(
    (actions, later) => later.text === text && later.row !== null ? withUnconfirmed(actions, text, later.pressedAt ?? void 0, later.deliveryId) : actions,
    arrived
  );
  const ledger = { ...s.ledger, turn: s.ledger.turn + 1 };
  const r = promptNotes(CODEX, ledger, { text, isPress: sentAt >= 0, isOpen: isTabOpen(s, now) }, s.told);
  const person = s.turn.person === null ? text : `${s.turn.person}

${text}`;
  return {
    state: {
      ...s,
      ledger,
      told: r.told,
      lastActions,
      sent: sentAt >= 0 ? s.sent.filter((_x, i) => i !== sentAt) : s.sent,
      turn: { ...s.turn, person, press: sentBy ?? s.turn.press },
      presence: { ...s.presence, turnsStarted: s.presence.turnsStarted + 1 }
    },
    notes: r.notes
  };
}
function noteActivity(s, line) {
  const activity = addActivity(s.turn.activity, line);
  if (activity === s.turn.activity) return s;
  return { ...s, turn: { ...s.turn, activity } };
}
function activityOf(tool, input) {
  return toolActivity(tool, input);
}
function patchFiles(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}
function endTurn(s, reply, now) {
  const refs = prRefs(reply);
  const base = {
    ...s,
    ledger: refs.length > 0 ? { ...s.ledger, prs: linkedPrs(s.ledger.prs, refs) } : s.ledger,
    turn: { person: null, activity: [], press: null }
  };
  if (reply.trim() === "") return base;
  const ex = {
    person: s.turn.person,
    trigger: s.turn.person === null ? "unknown" : null,
    activity: s.turn.activity,
    reply,
    turn: s.ledger.turn,
    press: s.turn.press,
    screen: screenText(CODEX, isTabOpen(s, now), null)
  };
  return { ...base, pending: [...base.pending, { ex, turnsStarted: s.presence.turnsStarted }] };
}
var MAX_PROMPT_TURNS = 10;
function noteHook(s, hook, now, turnId) {
  const h = s.heard;
  const heard = hook === "start" ? { ...h, startAt: now } : hook === "prompt" ? {
    ...h,
    promptAt: now,
    prompts: h.prompts + 1,
    promptTurns: turnId ? [...h.promptTurns.filter((t) => t !== turnId), turnId].slice(-MAX_PROMPT_TURNS) : h.promptTurns
  } : { ...h, stopAt: now, stops: h.stops + 1 };
  return { ...s, heard };
}

// src/state.ts
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
var NOTHING_HEARD = {
  startAt: null,
  promptAt: null,
  prompts: 0,
  promptTurns: [],
  stopAt: null,
  stops: 0,
  promptMissedAt: null
};
var NO_PRS = { views: {}, branchRef: null, isFetching: false };
function emptyState(sessionId) {
  return {
    version: 1,
    sessionId,
    root: "",
    home: homedir(),
    cliPath: null,
    ledger: EMPTY,
    turn: { person: null, activity: [], press: null },
    told: TOLD_NOTHING,
    presence: { turnsStarted: 0, turnsApplied: 0, ledgerState: "current", isUpdating: false },
    pending: [],
    sent: [],
    lastActions: {},
    prViews: NO_PRS,
    tabSeenAt: 0,
    heard: NOTHING_HEARD
  };
}
function dataDir(env, pluginRoot) {
  const fromEnv = env.INBOX_DATA || env.PLUGIN_DATA;
  if (fromEnv) return fromEnv;
  const m = pluginRoot.match(/^(.*)\/plugins\/cache\/([^/]+)\/([^/]+)\/[^/]+$/);
  if (m) return `${m[1]}/plugins/data/${m[3]}-${m[2]}`;
  return join(homedir(), ".codex", "inbox-dev");
}
function fileName(sessionId) {
  if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error(`Not a session id: ${sessionId}`);
  return sessionId;
}
function statePath(dir, sessionId) {
  return join(dir, "sessions", `${fileName(sessionId)}.json`);
}
function upgraded(saved, sessionId) {
  if (saved.version !== void 0 && saved.version !== 1)
    throw new Error(`Unsupported inbox state version: ${saved.version}`);
  const base = emptyState(sessionId);
  const { checks: _checks, snapshots: _snapshots, recordedRuns: _runs, top: _top, ...kept } = saved;
  const { sentBack: _sentBack, ...turn } = saved.turn ?? {};
  return {
    ...base,
    ...kept,
    // The ledger's shape is the mod's, so a saved one converts the way the mod's does. It converts
    // before the defaults fill in, since an empty `closed` would hide an old `decided`.
    ledger: saved.ledger ? { ...base.ledger, ...upgradeLedger({ ...saved.ledger, items: saved.ledger.items ?? [] }) } : base.ledger,
    turn: { ...base.turn, ...turn },
    told: { ...base.told, ...saved.told },
    presence: { ...base.presence, ...saved.presence },
    pending: (saved.pending ?? []).map(({ ex: { checks: _exChecks, ...ex }, ...p }) => ({ ...p, ex })),
    // A message sent before the server kept its row changes no row when it arrives.
    sent: (saved.sent ?? []).map((x) => ({
      ...x,
      row: x.row ?? null,
      queuedId: x.queuedId ?? null,
      pressedAt: x.pressedAt ?? null,
      deliveryId: x.deliveryId ?? null,
      phase: x.phase ?? "accepted"
    })),
    lastActions: upgradeLastActions(saved.lastActions ?? {}),
    prViews: { ...NO_PRS, ...saved.prViews, isFetching: false },
    // A file saved before the hooks kept this record came from hooks that ran, so it reads as heard.
    // Its turns were not recorded, so `promptAt` is set too: a tool call then falls back to the time rule.
    heard: saved.heard ? { ...NOTHING_HEARD, ...saved.heard } : {
      ...NOTHING_HEARD,
      startAt: 0,
      promptAt: 0,
      prompts: saved.presence?.turnsStarted ?? 0,
      stops: saved.presence?.turnsStarted ?? 0
    }
  };
}
async function readState(dir, sessionId) {
  const saved = await readFile(statePath(dir, sessionId), "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  return saved === null ? emptyState(sessionId) : upgraded(JSON.parse(saved), sessionId);
}
var LOCK_WAIT_MS = 1e4;
var LOCK_CHILD = "held";
var sleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var LockBusyError = class extends Error {
};
var bootSession = null;
var ownIdentity = null;
function lockOwner(suffix) {
  const match = /^(\d+)-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}(?:-([a-f\d]{32}))?$/.exec(suffix);
  const pid = Number(match?.[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, identity: match?.[2] ?? null } : null;
}
function processIdentity(pid) {
  if (pid === process.pid && ownIdentity) return ownIdentity;
  try {
    const options = {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: "pipe",
      timeout: 1e3
    };
    const boot = bootSession ?? execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], options).trim();
    const started = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], options).trim();
    if (!boot || !started) return null;
    bootSession = boot;
    const identity = createHash("sha256").update(boot).update("\0").update(started).digest("hex").slice(0, 32);
    if (pid === process.pid) ownIdentity = identity;
    return identity;
  } catch {
    return null;
  }
}
function isLive(owner, generation, observedLiveAt) {
  try {
    process.kill(owner.pid, 0);
  } catch (err) {
    return err.code !== "ESRCH";
  }
  if (owner.identity === null) return true;
  const checkedAt = observedLiveAt.get(generation);
  if (checkedAt !== void 0 && Date.now() - checkedAt < 250) return true;
  const identity = processIdentity(owner.pid);
  if (identity !== null && identity !== owner.identity) return false;
  observedLiveAt.set(generation, Date.now());
  return true;
}
async function lockTarget(path) {
  return readlink(path).catch((err) => {
    if (err.code === "ENOENT" || err.code === "EINVAL") return null;
    throw err;
  });
}
async function removeOwnedLock(path, target, owner, source) {
  const identity = processIdentity(process.pid);
  const claimed = `${owner}.recover-${process.pid}-${randomUUID()}${identity ? `-${identity}` : ""}`;
  const isDirectory = await lstat(source).then(
    (s) => s.isDirectory(),
    (err) => {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  );
  if (!isDirectory) return false;
  try {
    await rename(source, claimed);
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  if (await lockTarget(path) === target) await unlink(path);
  await rmdir(claimed);
  return true;
}
async function recoverLock(path, observedLiveAt) {
  const target = await lockTarget(path);
  if (!target || !isAbsolute(target)) return false;
  const owner = basename(target) === LOCK_CHILD ? dirname(target) : target;
  if (target !== owner && target !== join(owner, LOCK_CHILD)) return false;
  const prefix = `${basename(path)}.owner-`;
  if (!basename(owner).startsWith(prefix)) return false;
  if (await realpath(dirname(owner)).catch(() => null) !== dirname(path)) return false;
  const holder = lockOwner(basename(owner).slice(prefix.length));
  if (!holder || isLive(holder, owner, observedLiveAt)) return false;
  if (await removeOwnedLock(path, target, owner, owner)) return true;
  const recoverPrefix = `${basename(owner)}.recover-`;
  const entries = await readdir(dirname(path));
  for (const entry of entries) {
    if (!entry.startsWith(recoverPrefix)) continue;
    const recovering = lockOwner(entry.slice(recoverPrefix.length));
    if (!recovering || isLive(recovering, entry, observedLiveAt)) continue;
    if (await removeOwnedLock(path, target, owner, join(dirname(path), entry))) return true;
  }
  return false;
}
async function withLock(path, fn, waitMs = LOCK_WAIT_MS) {
  path = resolve(path);
  await mkdir(dirname(path), { recursive: true });
  path = join(await realpath(dirname(path)), basename(path));
  const identity = processIdentity(process.pid);
  const owner = `${path}.owner-${process.pid}-${randomUUID()}${identity ? `-${identity}` : ""}`;
  const target = join(owner, LOCK_CHILD);
  await mkdir(owner);
  const until = Date.now() + waitMs;
  const observedLiveAt = /* @__PURE__ */ new Map();
  try {
    for (; ; ) {
      try {
        await symlink(target, path);
        break;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        if (await recoverLock(path, observedLiveAt)) continue;
        if (Date.now() > until) throw new LockBusyError(`Timed out waiting for ${path}`);
        await sleep(15);
      }
    }
    return await fn();
  } finally {
    await removeOwnedLock(path, target, owner, owner);
  }
}
async function updateState(dir, sessionId, change) {
  const path = statePath(dir, sessionId);
  return withLock(`${path}.lock`, async () => {
    const current = await readState(dir, sessionId);
    const checkpoint = async (state) => {
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, path);
    };
    const next = await change(current, checkpoint);
    await checkpoint(next);
    return next;
  });
}

// src/transcript.ts
import { open } from "node:fs/promises";
async function isNonInteractiveRun(path) {
  if (path === null) return true;
  try {
    const file = await open(path, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buf, 0, buf.length, 0);
      const first = buf.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
      const meta = JSON.parse(first);
      return meta.type === "session_meta" && (meta.payload?.originator === "codex_exec" || meta.payload?.source === "exec");
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

// src/hook.ts
async function handleHook(input, deps) {
  const id = input.session_id;
  const { dir, env, now } = deps;
  if (!id || !env.INBOX_IN_EXEC && await isNonInteractiveRun(input.transcript_path)) return null;
  const cliPath = env.CODEX_CLI_PATH || null;
  const withCli = (s) => cliPath && s.cliPath !== cliPath ? { ...s, cliPath } : s;
  switch (input.hook_event_name) {
    case "SessionStart": {
      const root = input.cwd ?? "";
      const s = await updateState(
        dir,
        id,
        (s2) => noteHook(withCli({ ...input.source === "clear" ? cleared(s2) : s2, root }), "start", now())
      );
      const context = startContext(s, input.source);
      return context ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } } : null;
    }
    case "UserPromptSubmit": {
      let notes = [];
      await updateState(dir, id, (s) => {
        const r = notePrompt(withCli(s), input.prompt ?? "", now());
        notes = r.notes;
        return input.agent_id ? r.state : noteHook(r.state, "prompt", now(), input.turn_id);
      });
      return notes.length === 0 ? null : { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: notes.join("\n\n") } };
    }
    case "PreToolUse": {
      const tool = input.tool_name ?? "";
      const toolInput = input.tool_input ?? {};
      const command = typeof toolInput.command === "string" ? toolInput.command : "";
      if (tool === "apply_patch") {
        const files = patchFiles(command).map((f) => resolve2(input.cwd || "/", f));
        await updateState(dir, id, (s) => files.reduce((x, f) => noteActivity(x, `edited ${f}`), s));
        return null;
      }
      const line = activityOf(tool, toolInput);
      if (line) await updateState(dir, id, (s) => noteActivity(s, line));
      return null;
    }
    case "Stop": {
      const reply = input.last_assistant_message ?? "";
      const written = await updateState(dir, id, (s) => noteHook(endTurn(withCli(s), reply, now()), "stop", now()));
      if (written.pending.length > 0) deps.startUpdate(id);
      return null;
    }
  }
  return null;
}
function detachedUpdate(dir, env, script) {
  return (sessionId) => {
    const child = spawn(process.execPath, [script, sessionId], {
      detached: true,
      stdio: "ignore",
      env: { ...env, INBOX_DATA: dir }
    });
    child.unref();
  };
}

// src/hook-main.ts
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const dist = dirname2(fileURLToPath(import.meta.url));
  const dir = dataDir(process.env, dirname2(dist));
  const out = await handleHook(JSON.parse(raw), {
    dir,
    env: process.env,
    now: Date.now,
    startUpdate: detachedUpdate(dir, process.env, join2(dist, "update.mjs"))
  });
  if (out) process.stdout.write(JSON.stringify(out));
}
main().catch(() => process.exit(0));
