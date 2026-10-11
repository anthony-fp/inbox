// Built by codex/build.mjs from codex/src and hooks/. Do not edit.

// src/server-main.ts
import { readFile as readFile2, stat as stat3 } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// src/server.ts
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, stat as stat2 } from "node:fs/promises";

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
var MAX_CLOSED = 12;
var EXPIRED = "expired, unanswered";
var MAX_FINDINGS = 30;
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
function words(text2) {
  return text2.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function recommendedOption(options, rec) {
  if (!rec) return null;
  const named = new Set(words(rec));
  let best = null;
  for (const option of options) {
    const w = words(option);
    if (w.length > words(best ?? "").length && w.every((x) => named.has(x))) best = option;
  }
  return best;
}
function howFromOutcome(outcome) {
  if (outcome === "dismissed") return "dismissed";
  if (outcome === EXPIRED) return "expired";
  if (outcome === "done" || outcome === "you ran it") return "done";
  if (outcome.startsWith(CLOSED_BY_CLAUDE)) return "claude";
  return "update";
}
function sameAsk(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}
function closedRecord(item, closing, now) {
  const { id, kind, ask, label } = item;
  return { id, kind, ask, ...label ? { label } : {}, ...closing, at: now, item };
}
function closedFindingRecord(finding, closing, now) {
  return { ...finding, ...closing, closedAt: now };
}
var CLOSED_BY_CLAUDE = "closed by Claude";
function closeByAgent(host, ledger, id, how, now) {
  const closing = "answer" in how ? { how: "answered", outcome: how.answer } : { how: "claude", outcome: `closed by ${host.agent}: ${how.reason}` };
  if (ledger.items.some((i) => i.id === id)) return { ledger: closeItem(ledger, id, closing, now), closed: "item" };
  if (ledger.findings.some((f) => f.id === id))
    return { ledger: closeFinding(ledger, id, closing, now), closed: "finding" };
  return { ledger, closed: null };
}
function closeItem(ledger, id, closing, now) {
  return {
    ...ledger,
    items: ledger.items.filter((i) => i.id !== id),
    closed: [...ledger.closed, ...ledger.items.filter((i) => i.id === id).map((i) => closedRecord(i, closing, now))].slice(
      -MAX_CLOSED
    )
  };
}
function closeFinding(ledger, id, closing, now) {
  const finding = ledger.findings.find((f) => f.id === id);
  if (!finding) return ledger;
  return {
    ...ledger,
    findings: ledger.findings.filter((f) => f.id !== id),
    closedFindings: [...ledger.closedFindings, closedFindingRecord(finding, closing, now)].slice(-MAX_CLOSED)
  };
}
function idNumber(id) {
  return Number(id.match(/\d+/)?.[0] ?? Number.NaN);
}
function inIdOrder(open, entry) {
  const at = open.findIndex((x) => idNumber(x.id) > idNumber(entry.id));
  return at < 0 ? [...open, entry] : [...open.slice(0, at), entry, ...open.slice(at)];
}
function reopenItem(ledger, id) {
  const item = ledger.closed.findLast((c) => c.id === id)?.item;
  if (!item || ledger.items.some((i) => i.id === id)) return ledger;
  return { ...ledger, items: inIdOrder(ledger.items, item), closed: ledger.closed.filter((c) => c.id !== id) };
}
function reopenFinding(ledger, id) {
  const record = ledger.closedFindings.findLast((f) => f.id === id);
  if (!record || ledger.findings.some((f) => f.id === id)) return ledger;
  const { how: _how, outcome: _outcome, closedAt: _closedAt, ...finding } = record;
  return {
    ...ledger,
    findings: inIdOrder(ledger.findings, finding),
    closedFindings: ledger.closedFindings.filter((f) => f.id !== id)
  };
}
function latestBatch(ledger) {
  return ledger.batchTurn === 0 ? [] : ledger.items.filter((i) => i.turn === ledger.batchTurn);
}
function numberOf(label) {
  const m = label?.match(/(\d+)/);
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
function questionNumbers(ledger, promptTurn) {
  const numbers = /* @__PURE__ */ new Map();
  for (const [n, item] of batchNumbers(answerableBatch(ledger, promptTurn)))
    if (item.kind === "question") numbers.set(item.id, n);
  return numbers;
}
function addFinding(ledger, finding) {
  const findings = ledger.findings;
  const same = findings.find((f) => sameAsk(f.title, finding.title));
  if (same) return { ledger, id: same.id, isAdded: false };
  const id = `f${ledger.nextId}`;
  return {
    ledger: {
      ...ledger,
      findings: [...findings, { ...finding, id }].slice(-MAX_FINDINGS),
      nextId: ledger.nextId + 1
    },
    id,
    isAdded: true
  };
}
function isLapsed(d) {
  if (d.how === "dismissed" || d.how === "expired" || d.how === "claude") return true;
  return d.how === "update" && /^(no longer applies|replaced|superseded|moot)/i.test(d.outcome);
}
var TOLD_NOTHING = { inbox: null, closed: [] };

// ../hooks/presses.ts
function clipLabel(text2, max) {
  return text2.length > max ? `${text2.slice(0, max - 1)}\u2026` : text2;
}
function baseName(path) {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}
function helpLabel(help) {
  const label = help.kind === "open" ? `Open ${baseName(help.path)}` : help.kind === "copy" ? `Copy ${help.name ?? "snippet"}` : help.kind === "run" ? `Run ${help.name ?? help.command}` : help.kind === "terminal" ? `Copy ${help.name ?? help.command}` : `Open ${help.name ?? new URL(help.url).host}`;
  return clipLabel(label, 32);
}
function localPath(raw, root, home) {
  if (raw.startsWith("~/")) return home + raw.slice(1);
  if (raw.startsWith("/")) return raw;
  return `${root.replace(/\/$/, "")}/${raw.replace(/^\.\//, "")}`;
}
var LAUNCHES = /\.(app|command|tool|terminal|workflow|scpt|scptd|applescript|pkg|mpkg|dmg|webloc|inetloc|fileloc|prefpane|kext)$/i;
function openCommands(path, isFile, isExecutable) {
  if (!isFile || isExecutable || LAUNCHES.test(path)) return { argv: ["open", "-R", path], fallback: null };
  return { argv: ["open", path], fallback: ["open", "-t", path] };
}
function steps(helps) {
  const copy = helps.find((h) => h.kind === "copy");
  const open = helps.find((h) => h.kind === "open");
  if (!copy || !open || copy.kind !== "copy" || open.kind !== "open")
    return helps.map((h) => ({ label: helpLabel(h), step: [h] }));
  return helps.filter((h) => h !== copy).map(
    (h) => h === open ? { label: clipLabel(`Copy ${copy.name ?? "snippet"} and open ${baseName(open.path)}`, 48), step: [copy, open] } : { label: helpLabel(h), step: [h] }
  );
}
function stepsOf(item, extraSteps) {
  return [...steps(item.helps), ...extraSteps];
}
function isHandedOff(last, turns) {
  const pressed2 = last?.kind === "handoff" && last.delivery?.state !== "failed" ? last.turnsStarted : void 0;
  return pressed2 !== void 0 && pressed2 <= turns.turnsStarted && turns.turnsApplied <= pressed2;
}
function actionId(p) {
  return p.action === "step" ? `step-${p.step}` : p.action;
}
function pressText(p) {
  switch (p.action) {
    case "answer":
      return p.option;
    case "type":
      return "Reply";
    case "step":
      return p.label;
    default:
      return capitalized(p.action);
  }
}
function capitalized(text2) {
  return text2.charAt(0).toUpperCase() + text2.slice(1);
}
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
function isUndoable(how) {
  return how === "done" || how === "dismissed";
}
var STALE_TEXT = "This changed before your press. Nothing was sent.";
function noteText(note) {
  return note === "sample" ? "Sample entry: nothing was sent." : STALE_TEXT;
}
function helpEffect(item, help) {
  switch (help.kind) {
    case "run":
      return { kind: "send", text: messages.run(item, help.command), by: { id: item.id, action: "run" } };
    case "open":
      return { kind: "open", target: help.path, name: baseName(help.path) };
    case "link":
      return { kind: "open", target: help.url, name: help.name ?? help.url };
    case "copy":
      return { kind: "copy", text: help.text, name: help.name ?? "snippet", isCommand: false };
    case "terminal":
      return { kind: "copy", text: help.command, name: help.name ?? clipLabel(help.command, 32), isCommand: true };
  }
}
function stepEffects(item, step) {
  return step.step.map((h) => helpEffect(item, h));
}
function pendingResult(effects, at) {
  return {
    state: "pending",
    parts: effects.flatMap(
      (e) => e.kind === "send" ? [] : [{ kind: e.kind, name: e.name, isCommand: e.kind === "copy" && e.isCommand, error: null }]
    ),
    at
  };
}
function finishedResult(pending, errors, at) {
  const parts = pending.parts.map((part, n) => ({ ...part, error: errors[n] ?? null }));
  return { state: parts.some((part) => part.error !== null) ? "failed" : "done", parts, at };
}
function localLast(last, pressed2, result) {
  return last && last.kind !== "local" ? { ...last, result } : { kind: "local", ...pressed2, at: result.at, result };
}
function withResult(lastActions, rowId, pendingAt, result) {
  const last = lastActions[rowId];
  if (last?.result?.state !== "pending" || last.result.at !== pendingAt) return lastActions;
  return { ...lastActions, [rowId]: { ...last, result } };
}
function applyPress(ledger, last, p, ctx) {
  const r = pressed(ledger, last, p, ctx);
  return "stale" in r || !r.last ? r : { ...r, last: withQueued(r.last, r.effects) };
}
function withQueued(last, effects) {
  const send = effects.find((e) => e.kind === "send");
  return send ? { ...last, delivery: { state: "queued", message: send.text } } : last;
}
function retryOf(id, last) {
  if (!/^[if]\d+$/.test(id)) return null;
  const step = /^step-(\d+)$/.exec(last.action);
  if (step) return { action: "step", id, step: Number(step[1]), label: last.text };
  switch (last.action) {
    case "answer":
      return { action: "answer", id, option: last.text };
    case "explain":
    case "address":
    case "discuss":
      return { action: last.action, id };
    default:
      return null;
  }
}
function recordPress(kind, action, text2, ctx) {
  return { kind, action, text: text2, at: ctx.now, turnsStarted: ctx.turnsStarted };
}
function pressed(ledger, last, p, ctx) {
  const stale = { stale: true };
  const record = (kind) => recordPress(kind, actionId(p), pressText(p), ctx);
  const unchanged = { ledger, last: null, effects: [] };
  if (p.action === "undo") {
    if (ledger.items.some((i) => i.id === p.id) || ledger.findings.some((f) => f.id === p.id)) return stale;
    const closed = ledger.closed.findLast((c) => c.id === p.id);
    if (closed?.item && isUndoable(closed.how)) return { ...unchanged, ledger: reopenItem(ledger, p.id) };
    const closedFinding = ledger.closedFindings.findLast((f) => f.id === p.id);
    if (closedFinding && isUndoable(closedFinding.how)) return { ...unchanged, ledger: reopenFinding(ledger, p.id) };
    return stale;
  }
  const finding = ledger.findings.find((f) => f.id === p.id);
  if (finding) {
    const sendFinding = (kind, text2) => ({
      ledger,
      last: record(kind),
      effects: [{ kind: "send", text: text2, by: null }]
    });
    switch (p.action) {
      case "address":
        return sendFinding("handoff", messages.finding(finding, "address"));
      case "discuss":
        return sendFinding("talk", messages.finding(finding, "discuss"));
      case "type": {
        const words2 = p.text.trim();
        return words2 ? sendFinding("handoff", messages.finding(finding, "typed", words2)) : unchanged;
      }
      case "dismiss":
        return {
          ledger: closeFinding(ledger, p.id, { how: "dismissed", outcome: "dismissed" }, ctx.now),
          last: null,
          effects: []
        };
      default:
        return stale;
    }
  }
  const item = ledger.items.find((i) => i.id === p.id);
  if (!item) return stale;
  const answered = (answer) => ({
    ledger: closeItem(ledger, item.id, { how: "answered", outcome: answer }, ctx.now),
    last: record("mark"),
    effects: [{ kind: "send", text: messages.answer(item, answer), by: { id: item.id, action: "answer" } }]
  });
  switch (p.action) {
    case "answer":
      return item.options.includes(p.option) ? answered(p.option) : stale;
    case "type": {
      const words2 = p.text.trim();
      if (!words2) return unchanged;
      if (item.kind === "question") return answered(words2);
      return {
        ledger,
        last: record("handoff"),
        effects: [{ kind: "send", text: messages.taskReply(item, words2), by: null }]
      };
    }
    case "explain":
      return {
        ledger,
        last: record("talk"),
        effects: [{ kind: "send", text: messages.explain(item), by: { id: item.id, action: "explain" } }]
      };
    case "done":
      return { ledger: closeItem(ledger, item.id, { how: "done", outcome: "done" }, ctx.now), last: null, effects: [] };
    case "dismiss":
      return {
        ledger: closeItem(ledger, item.id, { how: "dismissed", outcome: "dismissed" }, ctx.now),
        last: null,
        effects: []
      };
    case "step": {
      const step = stepsOf(item, ctx.extraSteps)[p.step];
      if (!step || step.label !== p.label) return stale;
      const effects = stepEffects(item, step);
      if (effects.some((e) => e.kind === "send")) return { ledger, last: record("handoff"), effects };
      return {
        ledger,
        last: localLast(last, { action: actionId(p), text: pressText(p) }, pendingResult(effects, ctx.now)),
        effects
      };
    }
    // Address and Discuss are a finding's.
    default:
      return stale;
  }
}
function findingBody(finding) {
  return [
    `${finding.kind === "issue" ? "Issue" : "Opportunity"}: ${finding.title}`,
    finding.detail,
    ...finding.path ? [`File: ${finding.path}`] : []
  ];
}
var messages = {
  answer: (item, answer) => `Re "${item.ask}": ${answer}`,
  /** Asks what an item is about. The item stays open, since nothing was decided. */
  explain: (item) => {
    const what = item.kind === "task" ? "this task you left for me" : "this question you asked me";
    const options = item.options.length > 0 ? `
Options: ${item.options.join(" / ")}` : "";
    return `Remind me what ${what} is about: why it came up, and what each choice would mean. Don't act on it yet.
"${item.ask}"${options}`;
  },
  run: (item, command) => `For "${item.ask}", run this:
\`\`\`
${command}
\`\`\``,
  taskReply: (item, words2) => `Re the task you left for me, "${item.ask}": ${words2}`,
  /** Sends a finding back to the agent: to fix it, to talk it through first, or with the person's own words. */
  finding: (finding, how, words2 = "") => {
    const opening = how === "address" ? "Please address this finding you recorded:" : how === "discuss" ? "Let's talk through this finding you recorded before changing anything:" : "About this finding you recorded:";
    return [opening, ...findingBody(finding), ...how === "typed" ? ["", words2] : []].join("\n");
  }
};

// ../hooks/tools.ts
var FINDING_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["issue", "opportunity"],
      description: "issue: something wrong or risky. opportunity: something that could be better."
    },
    title: { type: "string", description: "What it is, in at most 12 plain words." },
    detail: { type: "string", description: "Why it matters and what you would do, in one or two sentences." },
    path: { type: "string", description: "The file it is about, if one." }
  },
  required: ["kind", "title", "detail"]
};
var CLOSE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "The id of the open item or finding, such as i35 or f32." },
    answer: {
      type: "string",
      description: "The user's answer, in their words and at most 8, when their own message answered it."
    },
    reason: {
      type: "string",
      description: 'Otherwise, why it is closed, in at most 8 words, such as "no longer applies: Inbox kept".'
    }
  },
  required: ["id"]
};
function findingDescription(host) {
  return `Record a finding for the user. It waits in ${host.findingsIn} until it is closed, and from there the user can ask you to address it or discuss it. Record what a careful senior engineer would flag to a teammate, and leave out style nits and anything the user already decided.`;
}
var CLOSE_DESCRIPTION = `Close an open item or finding by its id, such as i35 or f12, as listed in the latest "inbox:" text beside the user's prompt. Pass the user's answer when their message answered it, and a reason otherwise.`;
function cut(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function recordFinding(host, ledger, input, now) {
  const title = cut(input.title, 120);
  const detail = cut(input.detail, 600);
  if (title === "" || detail === "") return { ledger, result: "Not recorded: a finding needs a title and a detail." };
  const path = cut(input.path, 300);
  const r = addFinding(ledger, {
    kind: input.kind === "opportunity" ? "opportunity" : "issue",
    title,
    detail,
    path: path || null,
    at: now
  });
  return {
    ledger: r.ledger,
    result: r.isAdded ? `Recorded as ${r.id}. The user sees it in ${host.findingsIn}.` : `Already recorded as ${r.id}.`
  };
}
function recordClose(host, ledger, input, now) {
  const id = cut(input.id, 80).replace(/^\[|\]$/g, "");
  const answer = cut(input.answer, 80);
  const reason = cut(input.reason, 80);
  if (id === "" || answer === "" && reason === "")
    return { ledger, result: "Not closed: give the id, and the user's answer or a reason." };
  const r = closeByAgent(host, ledger, id, answer ? { answer } : { reason }, now);
  if (r.closed === "item")
    return { ledger: r.ledger, result: `Closed ${id}. The user sees it in ${host.surface} with its outcome.` };
  if (r.closed === "finding") return { ledger: r.ledger, result: `Closed finding ${id}.` };
  return {
    ledger,
    result: `Not closed: no open item or finding has the id ${id}. The open ones are listed beside the user's latest message.`
  };
}

// ../hooks/view.ts
var OPTIONS_FOLD_AT = 5;
var CHOICE_KEYS = [..."abcfghilm"];
var SETTLED_MS = 5120;
var UPDATE_FAILED = "Last update failed. Items from that reply may be missing.";
var UPDATE_RETRIES = " It retries after your next message.";
function needsYouOrder(ledger) {
  const latest = new Set(latestBatch(ledger).map((i) => i.id));
  const questions = ledger.items.filter((i) => i.kind === "question");
  return {
    questions: [
      ...questions.filter((i) => latest.has(i.id)),
      ...questions.filter((i) => !latest.has(i.id)).sort((a, b) => b.turn - a.turn)
    ],
    tasks: ledger.items.filter((i) => i.kind === "task").sort((a, b) => a.turn - b.turn)
  };
}
function feedbackOf(id, last, note, now) {
  const result = last?.result;
  if (note && now - note.at < SETTLED_MS && note.at >= Math.max(last?.at ?? 0, result?.at ?? 0))
    return { is: "note", note: note.note, at: note.at };
  if (result && (result.state !== "done" || now - result.at < SETTLED_MS)) return { is: "local", result };
  if (!last || last.kind === "local") return null;
  const delivery = last.delivery;
  if (delivery?.state === "queued") return { is: "queued", label: last.text, at: last.at };
  if (delivery?.state === "failed") return { is: "notSent", reason: delivery.reason, retry: retryOf(id, last) };
  return { is: "done", label: last.text, at: last.at };
}
function stepKind(step) {
  return step.step.some((h) => h.kind === "run") ? "handoff" : "local";
}
var TABS = [
  { id: "needsYou", label: "Needs you", hotkey: "1" },
  { id: "findings", label: "Findings", hotkey: "2" },
  { id: "prs", label: "PRs", hotkey: "3" }
];
var ROW_TABS = TABS.filter((t) => t.id !== "prs");
var FOLLOW_UPS = /* @__PURE__ */ new Set(["type", "explain", "discuss", "dismiss"]);
var ACTION_KEYS = {
  done: "d",
  address: "a",
  type: "t",
  explain: "e",
  discuss: "e",
  dismiss: "x"
};
function actionsOf(row, last, state) {
  const { id, item, steps: steps2 } = row;
  const action = (press, label, kind, flags = {}) => ({
    press,
    // The type action opens a field for new words each time, an open or copy
    // only shows its result, and a press whose message failed did nothing, so none reads "again".
    label: press.action !== "type" && last?.kind !== "local" && last?.delivery?.state !== "failed" && last?.action === actionId(press) ? `${label} again` : label,
    kind,
    isPrimary: flags.isPrimary ?? false,
    isFolded: flags.isFolded ?? false,
    isFollowUp: FOLLOW_UPS.has(press.action),
    ...ACTION_KEYS[press.action] ? { hotkey: ACTION_KEYS[press.action] } : {}
  });
  if (state.is === "settled") return state.canUndo ? [action({ action: "undo", id }, "Undo", "view")] : [];
  const stepActions = steps2.map((s, n) => action({ action: "step", id, step: n, label: s.label }, s.label, stepKind(s)));
  if (!item)
    return [
      action({ action: "address", id }, "Address", "handoff"),
      action({ action: "discuss", id }, "Discuss", "talk"),
      action({ action: "type", id, text: "" }, "Reply", "handoff"),
      action({ action: "dismiss", id }, "Dismiss", "mark")
    ];
  if (item.kind === "task")
    return [
      ...stepActions,
      action({ action: "done", id }, "Done", "mark"),
      action({ action: "type", id, text: "" }, "Reply", "handoff"),
      action({ action: "explain", id }, "Explain", "talk")
    ];
  const isFolding = item.options.length > OPTIONS_FOLD_AT;
  const options = item.rec && item.options.includes(item.rec) ? [item.rec, ...item.options.filter((o) => o !== item.rec)] : item.options;
  return [
    ...options.map(
      (option, n) => action({ action: "answer", id, option }, clipLabel(option, 32), "mark", {
        isPrimary: option === item.rec,
        isFolded: isFolding && n >= OPTIONS_FOLD_AT - 1
      })
    ),
    ...stepActions,
    action({ action: "type", id, text: "" }, "Reply", "mark"),
    action({ action: "explain", id }, "Explain", "talk"),
    action({ action: "dismiss", id }, "Dismiss", "mark")
  ];
}
function inboxView({
  ledger,
  lastActions,
  notes,
  turns,
  extraSteps,
  settleWindowMs,
  status,
  now
}) {
  const isSettling = (at) => now - at < settleWindowMs;
  const isOpen = (id) => ledger.items.some((i) => i.id === id) || ledger.findings.some((f) => f.id === id);
  const settledItems = new Map(
    ledger.closed.filter((d) => d.item && isSettling(d.at) && !isOpen(d.id)).map((d) => [d.id, d])
  );
  const settledFindings = new Map(
    ledger.closedFindings.filter((f) => isSettling(f.closedAt) && !isOpen(f.id)).map((f) => [f.id, f])
  );
  const placed = [...settledFindings.keys()].reduce(reopenFinding, [...settledItems.keys()].reduce(reopenItem, ledger));
  const { questions, tasks } = needsYouOrder(placed);
  const numbers = questionNumbers(ledger, ledger.turn + 1);
  const stateOf = (id) => {
    const closed2 = settledItems.get(id) ?? settledFindings.get(id);
    if (closed2) {
      const at = "closedAt" in closed2 ? closed2.closedAt : closed2.at;
      const last = lastActions[id];
      return {
        is: "settled",
        label: capitalized(closed2.outcome),
        at,
        canUndo: isUndoable(closed2.how),
        // Dismissed, expired or closed by the agent: drawn muted, as the Closed fold draws it.
        isLapsed: isLapsed(closed2),
        // Queued only while the answer press that closed the row waits to reach Claude. Claude's own close sends nothing.
        isQueued: closed2.how === "answered" && last?.kind === "mark" && last.at === at && last.delivery?.state === "queued"
      };
    }
    return isHandedOff(lastActions[id], turns) ? { is: "handedOff" } : { is: "open" };
  };
  const rowOf = (row) => {
    const state = stateOf(row.id);
    return {
      ...row,
      state,
      feedback: state.is === "settled" ? null : feedbackOf(row.id, lastActions[row.id], notes[row.id], now),
      actions: actionsOf(row, lastActions[row.id], state)
    };
  };
  const itemRow = (item) => {
    const n = numbers.get(item.id);
    const row = rowOf({
      id: item.id,
      type: item.kind,
      // A question no typed number reaches takes a task's bullet: a "?" reads as a missing number.
      handle: n === void 0 ? "\u2022" : `${n})`,
      title: item.ask,
      at: item.at,
      item,
      finding: null,
      steps: stepsOf(item, extraSteps[item.id] ?? [])
    });
    return item.kind === "question" && row.state.is === "handedOff" ? { ...row, state: { is: "open" } } : row;
  };
  const questionRows = questions.map(itemRow);
  const taskRows = tasks.map(itemRow);
  const counted = [...questionRows, ...taskRows].filter((r) => r.state.is === "open");
  const findingRows = [...placed.findings].reverse().map(
    (finding) => rowOf({
      id: finding.id,
      type: "finding",
      handle: "\u2022",
      title: finding.title,
      at: finding.at,
      item: null,
      finding,
      steps: []
    })
  );
  const closed = [...ledger.closed].reverse();
  return {
    needsYou: {
      count: counted.length,
      topId: counted[0]?.id ?? null,
      questions: questionRows,
      tasks: taskRows,
      closed: { questions: closed.filter((d) => d.kind === "question"), tasks: closed.filter((d) => d.kind === "task") }
    },
    findings: {
      count: findingRows.filter((r) => r.state.is === "open").length,
      rows: findingRows,
      closed: [...ledger.closedFindings].reverse()
    },
    status
  };
}
function perTurnStatus(ledger, update) {
  let changedAt = ledger.card?.updatedAt ?? null;
  for (const t of [
    ...ledger.items.map((i) => i.at),
    ...ledger.closed.map((d) => d.at),
    ...ledger.findings.map((f) => f.at),
    ...ledger.closedFindings.map((f) => f.closedAt)
  ])
    if (typeof t === "number" && (changedAt === null || t > changedAt)) changedAt = t;
  return {
    changedAt,
    isUpdating: update.isUpdating,
    error: update.isFailed && !update.isUpdating ? UPDATE_FAILED + (update.retries ? UPDATE_RETRIES : "") : null
  };
}

// src/settle.ts
var POLL_MS = 3e3;
var PRESS_TIMEOUT_MS = 6e4;
var SETTLE_WINDOW_MS = SETTLED_MS + 2 * POLL_MS;

// src/texts.ts
var CODEX = {
  agent: "Codex",
  surface: "the Inbox tab",
  band: null,
  findingsIn: "the Findings section of the Inbox tab"
};
var INBOX_DESCRIPTION = "What waits on the user in this conversation: open questions, tasks and findings, as text. Call it only when the user asks to see the inbox or what waits on them. It does not open the Inbox tab; the user opens that from the side panel.";
var VIEW_DESCRIPTION = "For the Inbox tab only: what the tab shows for this conversation, or its demo. Do not call it; to tell the user what waits on them, call inbox.";
function inboxToolText(v) {
  const isOpen = (r) => r.state.is === "open";
  const groups = [
    ["Questions:", v.needsYou.questions.filter(isOpen)],
    ["Tasks:", v.needsYou.tasks.filter(isOpen)],
    ["Findings:", v.findings.rows.filter(isOpen)]
  ];
  const needs = v.needsYou.count;
  const findings = v.findings.count;
  if (needs === 0 && findings === 0) return "Nothing waits on the user.";
  const counts = [
    needs > 0 ? `${needs} ${needs === 1 ? "waits" : "wait"} on the user` : null,
    findings > 0 ? findings === 1 ? "1 finding" : `${findings} findings` : null
  ].filter((x) => x !== null);
  const out = [counts.join(" \xB7 ")];
  for (const [title, rows] of groups) {
    if (rows.length === 0) continue;
    out.push(title);
    for (const r of rows) out.push(rowLine(r));
  }
  out.push("Open the Inbox tab to act on these.");
  return out.join("\n");
}
function rowLine(r) {
  if (r.finding) return `${r.handle} [${r.id}] ${r.finding.kind}: ${r.title}`;
  const item = r.item;
  const options = item && item.options.length > 0 ? `; options: ${item.options.join(" / ")}` : "";
  const rec = item?.rec ? `; recommended: ${item.rec}` : "";
  return `${r.handle} [${r.id}] "${r.title}"${options}${rec}`;
}

// src/core.ts
function isPromptMissed(h, turnId) {
  if (turnId !== null && (h.promptTurns.length > 0 || h.promptAt === null)) return !h.promptTurns.includes(turnId);
  return h.promptAt === null || h.stopAt !== null && h.promptAt < h.stopAt;
}
function noteToolCall(s, turnId, now) {
  return isPromptMissed(s.heard, turnId) ? { ...s, heard: { ...s.heard, promptMissedAt: now } } : s;
}
function heardState(h) {
  if (h.startAt === null && h.promptAt === null && h.stopAt === null) return "none";
  const isMissed = h.promptMissedAt !== null && (h.promptAt === null || h.promptMissedAt >= h.promptAt);
  const turns = h.promptTurns.length > 0 ? h.promptTurns.length : h.prompts;
  return h.startAt === null || isMissed || turns >= 2 && h.stops === 0 ? "partial" : "heard";
}
function withoutStalePending(lastActions, now) {
  const isStale = (last) => last.result?.state === "pending" && now - last.result.at > PRESS_TIMEOUT_MS;
  return Object.fromEntries(
    Object.entries(lastActions).map(([id, last]) => {
      if (!isStale(last)) return [id, last];
      const { result: _result, ...rest } = last;
      return [id, rest];
    })
  );
}
function viewOf(s, now) {
  const l = s.ledger;
  const lastActions = withoutStalePending(s.lastActions, now);
  const update = {
    isUpdating: s.presence.isUpdating || s.pending.length > 0,
    isFailed: s.presence.ledgerState === "failed",
    // applied() drops a failed exchange; nothing reruns it.
    retries: false
  };
  return {
    ...inboxView({
      ledger: l,
      lastActions,
      // The tab keeps its own row notes.
      notes: {},
      turns: s.presence,
      extraSteps: {},
      // The tab times each settled row from its first poll, so the server lists a close for longer.
      settleWindowMs: SETTLE_WINDOW_MS,
      status: perTurnStatus(l, update),
      now
    }),
    heard: heardState(s.heard),
    done: l.card?.done ?? [],
    running: l.card?.running ?? [],
    lastActions,
    at: now
  };
}

// ../hooks/demo.ts
var MIN = 6e4;
var REPO = "https://github.com/petekp/inbox";
function demoView(now) {
  return {
    ledger: {
      card: {
        goal: "Give the inbox pane keyboard shortcuts and a cleaner tab bar",
        done: ["Tabs switch with 1, 2 and 3", "Answer keys moved to letters", "PR #31 opened"],
        now: "Waiting on where the Keys list goes and a gh sign-in",
        running: ["live test session: tmux attach -t inbox-live"],
        updatedAt: now - 2 * MIN
      },
      items: [
        {
          id: "d11",
          kind: "question",
          label: "1",
          ask: "Show the Keys list in a footer, or under the tab bar?",
          options: ["Footer", "Under the tab bar"],
          rec: "Footer",
          helps: [],
          turn: 14,
          at: now - 12 * MIN
        },
        {
          id: "d12",
          kind: "question",
          label: "2",
          ask: "Keep findings open until you confirm a fix?",
          options: ["Keep it open", "Close it"],
          rec: "Keep it open",
          helps: [],
          turn: 14,
          at: now - 12 * MIN
        },
        {
          id: "d13",
          kind: "question",
          label: "3",
          ask: "Expire questions after 20 prompts, not 12?",
          options: ["Yes", "No"],
          rec: "No",
          helps: [],
          turn: 14,
          at: now - 12 * MIN
        },
        {
          id: "d14",
          kind: "task",
          label: null,
          ask: "Sign in to gh for the PRs tab",
          options: [],
          rec: null,
          helps: [{ kind: "terminal", command: "gh auth login", name: "gh auth login" }],
          turn: 14,
          at: now - 5 * MIN
        },
        {
          id: "d15",
          kind: "question",
          label: null,
          ask: "Which theme should the README screenshot use?",
          options: [],
          rec: null,
          helps: [],
          turn: 11,
          at: now - 40 * MIN
        },
        {
          id: "d16",
          kind: "task",
          label: null,
          ask: "Check the pane in the light theme",
          options: [],
          rec: null,
          helps: [{ kind: "copy", text: "/theme", name: "theme command" }],
          turn: 14,
          at: now - 5 * MIN
        },
        {
          id: "d18",
          kind: "task",
          label: null,
          ask: "Run the load script and send back its output lines",
          options: [],
          rec: null,
          helps: [{ kind: "run", command: "./scripts/load.sh", name: "load script" }],
          turn: 14,
          at: now - 4 * MIN
        },
        {
          id: "d17",
          kind: "task",
          label: null,
          ask: "Run /reload-plugins in your other sessions",
          options: [],
          rec: null,
          helps: [],
          turn: 12,
          at: now - 25 * MIN
        }
      ],
      closed: [
        {
          id: "d5",
          kind: "question",
          ask: "Rename the Waiting tab?",
          outcome: "Needs you",
          how: "answered",
          at: now - 90 * MIN
        },
        {
          id: "d6",
          kind: "question",
          ask: "Commit the reload fix and the rename as two commits?",
          outcome: "yes",
          how: "answered",
          at: now - 60 * MIN
        },
        {
          id: "d9",
          kind: "task",
          ask: "Update Claude Code to 2.1.292",
          outcome: "done",
          how: "done",
          at: now - 45 * MIN
        },
        {
          id: "d7",
          kind: "question",
          ask: "Keep the darker body behind the section cards?",
          outcome: "closed by Claude: no longer applies: the body matches the tab bar",
          how: "claude",
          at: now - 30 * MIN
        },
        {
          id: "d8",
          kind: "question",
          ask: "Add a fourth Session tab?",
          outcome: "dismissed",
          how: "dismissed",
          at: now - 20 * MIN
        },
        {
          id: "d10",
          kind: "question",
          ask: "Draw the tabs on the pane\u2019s own background?",
          outcome: "Yes, as part of the title bar",
          how: "answered",
          at: now,
          // Closed as the demo starts, so it shows settled in its place first.
          item: {
            id: "d10",
            kind: "question",
            label: null,
            ask: "Draw the tabs on the pane\u2019s own background?",
            options: ["Yes, as part of the title bar", "No, on a card"],
            rec: "Yes, as part of the title bar",
            helps: [],
            turn: 14,
            at: now - 12 * MIN
          }
        }
      ],
      findings: [
        {
          id: "d20",
          kind: "opportunity",
          title: "One contrast check could cover all six themes",
          detail: "A capture of the pane in each theme holds every cell\u2019s colors. A script could flag any text under 4.5:1 and run in check.sh.",
          path: "scripts/check.sh",
          at: now - 3 * 60 * MIN
        },
        {
          id: "d21",
          kind: "opportunity",
          title: "Catch-up could read only the turns it missed",
          detail: "After a reload, the catch-up call reads the whole conversation. Starting from the last turn the ledger applied would cut its tokens on long sessions.",
          path: "hooks/ledger.ts",
          at: now - 90 * MIN
        },
        {
          id: "d22",
          kind: "issue",
          title: "Hotkeys vanish on selected rows in ANSI",
          detail: "The engine draws hotkeys in the same blue the selected row uses as its background, so a: and b: disappear there.",
          path: "hooks/register.tsx",
          at: now - 45 * MIN
        },
        {
          id: "d23",
          kind: "issue",
          title: "Selected tab is unreadable in dark ANSI",
          detail: "The selected tab is drawn on ANSI white with the default light text. Its name needs a dark color there, or an inverse style.",
          path: "hooks/register.tsx",
          at: now - 30 * MIN
        }
      ],
      closedFindings: [
        {
          id: "d19",
          kind: "issue",
          title: "The band redraws every second while idle",
          detail: "The clock tick redraws the band even when nothing on it changed.",
          path: "hooks/register.tsx",
          at: now - 4 * 60 * MIN,
          how: "claude",
          outcome: "closed by Claude: fixed in the tick handler",
          closedAt: now - 2 * 60 * MIN
        }
      ],
      prs: ["petekp/inbox#31", "petekp/inbox#29", "petekp/inbox#33"],
      nextId: 24,
      turn: 14,
      batchTurn: 14
    },
    stop: null,
    prViews: {
      branchRef: "petekp/inbox#31",
      isFetching: false,
      views: {
        "petekp/inbox#31": {
          ref: "petekp/inbox#31",
          number: 31,
          title: "Switch tabs with 1, 2 and 3, and letter the answers",
          url: `${REPO}/pull/31`,
          isDraft: false,
          state: "OPEN",
          base: "main",
          mergeable: "CONFLICTING",
          reviewDecision: "CHANGES_REQUESTED",
          checks: [
            { name: "prettier", bucket: "pass", url: `${REPO}/actions/runs/1` },
            { name: "plugin tests", bucket: "fail", url: `${REPO}/actions/runs/2` },
            { name: "lint", bucket: "fail", url: `${REPO}/actions/runs/3` },
            { name: "plugin validate", bucket: "pending", url: null }
          ],
          threads: [
            {
              id: "DT1",
              author: "sam",
              reply: null,
              isWaiting: true,
              isOutdated: false,
              isLinesChanged: false,
              path: "hooks/register.tsx",
              line: 1147,
              body: "Why do the answer keys skip d? A question has no Done action.",
              replies: 0,
              url: `${REPO}/pull/31#discussion_r1`,
              at: now - 3 * 60 * MIN
            },
            {
              id: "DT2",
              author: "sam",
              reply: {
                author: "robin",
                body: "Agreed, the footer reads better than a list under the tabs.",
                url: `${REPO}/pull/31#discussion_r3`,
                at: now - 5 * 60 * MIN
              },
              isWaiting: true,
              isOutdated: true,
              isLinesChanged: false,
              path: "README.md",
              line: 87,
              body: "Should the Keys list live in the footer?",
              replies: 1,
              url: `${REPO}/pull/31#discussion_r2`,
              at: now - 26 * 60 * MIN
            },
            {
              id: "DT3",
              author: "robin",
              reply: {
                author: "you",
                body: "Done in the latest push.",
                url: `${REPO}/pull/31#discussion_r5`,
                at: now - 2 * 60 * MIN
              },
              isWaiting: false,
              isOutdated: false,
              isLinesChanged: false,
              path: "hooks/register.tsx",
              line: 2296,
              body: "Can the tab width come from the label alone now?",
              replies: 1,
              url: `${REPO}/pull/31#discussion_r4`,
              at: now - 26 * 60 * MIN
            },
            {
              id: "DT4",
              author: "review-bot",
              reply: null,
              isWaiting: true,
              isOutdated: true,
              isLinesChanged: true,
              path: "hooks/prs.ts",
              line: 114,
              body: "Outdated threads still count as waiting on the person.",
              replies: 0,
              url: `${REPO}/pull/31#discussion_r6`,
              at: now - 50 * MIN
            }
          ],
          fetchedAt: now - MIN,
          error: null
        },
        "petekp/inbox#29": {
          ref: "petekp/inbox#29",
          number: 29,
          title: "Count turns to tell when a reload cut off an update",
          url: `${REPO}/pull/29`,
          isDraft: false,
          state: "OPEN",
          base: "main",
          mergeable: "MERGEABLE",
          reviewDecision: "APPROVED",
          checks: [
            { name: "prettier", bucket: "pass", url: null },
            { name: "plugin tests", bucket: "pass", url: null }
          ],
          threads: [],
          fetchedAt: now - MIN,
          error: null
        },
        "petekp/inbox#33": {
          ref: "petekp/inbox#33",
          number: 33,
          title: "Draw the tabs on the pane\u2019s own background",
          url: `${REPO}/pull/33`,
          isDraft: true,
          state: "OPEN",
          base: "main",
          mergeable: "MERGEABLE",
          reviewDecision: "",
          checks: [
            { name: "prettier", bucket: "pass", url: null },
            { name: "plugin tests", bucket: "pending", url: null }
          ],
          threads: [],
          fetchedAt: now - MIN,
          error: null
        }
      }
    },
    lastActions: {
      d18: {
        kind: "handoff",
        action: "step-0",
        text: "Run load script",
        at: now - 1 * MIN,
        turnsStarted: 14
      },
      "petekp/inbox#31 thread DT1": {
        kind: "handoff",
        action: "thread-address",
        text: "Address",
        at: now - 2 * MIN,
        turnsStarted: 14
      }
    },
    notes: {},
    turns: { turnsStarted: 14, turnsApplied: 14 }
  };
}

// src/state.ts
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var NOTHING_HEARD = {
  startAt: null,
  promptAt: null,
  prompts: 0,
  promptTurns: [],
  stopAt: null,
  stops: 0,
  promptMissedAt: null
};
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
function statePath(dir2, sessionId) {
  return join(dir2, "sessions", `${fileName(sessionId)}.json`);
}
function upgraded(saved, sessionId) {
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
    sent: (saved.sent ?? []).map((x) => ({ ...x, row: x.row ?? null, queuedId: x.queuedId ?? null })),
    lastActions: upgradeLastActions(saved.lastActions ?? {}),
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
async function readState(dir2, sessionId) {
  const saved = await readFile(statePath(dir2, sessionId), "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  return saved === null ? emptyState(sessionId) : upgraded(JSON.parse(saved), sessionId);
}
var LOCK_WAIT_MS = 1e4;
var LOCK_STALE_MS = 15e3;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withLock(path, fn, waitMs = LOCK_WAIT_MS) {
  await mkdir(dirname(path), { recursive: true });
  const until = Date.now() + waitMs;
  for (; ; ) {
    try {
      await mkdir(path);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const age = await stat(path).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0
      );
      if (age > LOCK_STALE_MS) await rmdir(path).catch(() => void 0);
      else if (Date.now() > until) throw new Error(`Timed out waiting for ${path}`);
      else await sleep(15);
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(path).catch(() => void 0);
  }
}
async function updateState(dir2, sessionId, change) {
  const path = statePath(dir2, sessionId);
  return withLock(`${path}.lock`, async () => {
    const current = await readState(dir2, sessionId).catch(async () => {
      await rename(path, `${path}.unreadable-${Date.now()}`);
      return emptyState(sessionId);
    });
    const next = await change(current);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, path);
    return next;
  });
}

// src/demo.ts
function demoState(now) {
  const d = demoView(now);
  const s = emptyState("demo");
  return {
    ...s,
    root: "/demo",
    ledger: d.ledger,
    lastActions: d.lastActions,
    presence: { ...s.presence, ...d.turns },
    // The samples show no not-heard text: their hooks count as run.
    heard: { ...s.heard, startAt: now }
  };
}

// src/server.ts
function tabUri(tabHtml) {
  return `ui://inbox/tab-${createHash("sha256").update(tabHtml).digest("hex").slice(0, 12)}`;
}
var TAB_MIME = "text/html;profile=mcp-app";
var APP_ONLY = { ui: { visibility: ["app"] } };
var MAX_SENT = 20;
var toolsFor = (uri) => [
  { name: "record_finding", description: findingDescription(CODEX), inputSchema: FINDING_SCHEMA },
  { name: "close", description: CLOSE_DESCRIPTION, inputSchema: CLOSE_SCHEMA },
  // No resourceUri: Codex mounts every model-called MCP App inline in the transcript.
  { name: "inbox", description: INBOX_DESCRIPTION, inputSchema: { type: "object", properties: {} } },
  {
    // The side panel names the tab from this title. Entrypoints ignore `visibility`, so the tab still opens.
    name: "inbox_view",
    title: "Inbox",
    description: VIEW_DESCRIPTION,
    inputSchema: { type: "object", properties: { demo: { type: "boolean" } } },
    _meta: {
      ui: { resourceUri: uri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] }
    }
  },
  {
    name: "inbox_press",
    description: "A press in the Inbox tab.",
    inputSchema: {
      type: "object",
      properties: { press: { type: "object" }, thread: { type: "string" }, demo: { type: "boolean" } },
      required: ["press"]
    },
    _meta: APP_ONLY
  },
  {
    name: "inbox_tab_page",
    description: "The tab page the dev build keeps built.",
    inputSchema: { type: "object", properties: {} },
    _meta: APP_ONLY
  }
];
function stamped(tabHtml) {
  return tabHtml.replace(
    "</head>",
    () => `<script>window.__inboxPage = ${JSON.stringify(tabUri(tabHtml))}</script></head>`
  );
}
function sessionOf(params) {
  const meta = params?._meta ?? {};
  const turn = meta["x-codex-turn-metadata"] ?? {};
  const id = turn.session_id ?? meta.thread_id ?? meta.threadId;
  return typeof id === "string" && id ? id : null;
}
function turnOf(params) {
  const meta = params?._meta ?? {};
  const turn = meta["x-codex-turn-metadata"];
  if (typeof turn !== "object" || turn === null) return void 0;
  const t = turn;
  const isOtherThread = typeof t.thread_id === "string" && t.thread_id !== t.session_id;
  if (t.parent_thread_id || t.forked_from_thread_id || isOtherThread) return void 0;
  return typeof t.turn_id === "string" && t.turn_id ? t.turn_id : null;
}
var text = (t) => ({ content: [{ type: "text", text: t }] });
function makeServer(deps) {
  const { dir: dir2, now } = deps;
  const uri = tabUri(deps.tabHtml);
  const tools = toolsFor(uri);
  async function queue(s, message) {
    const cli = s.cliPath ?? await deps.fallbackCli();
    const r = await deps.exec([cli, "queue", "--thread", s.sessionId, "--message", message], {
      cwd: s.root || "/",
      timeoutMs: 15e3
    });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `codex queue exited ${r.code}`);
    return /Queued message (\S+)/.exec(r.stdout)?.[1] ?? null;
  }
  const pressOn = (s, p) => applyPress(s.ledger, s.lastActions[p.id], p, { now: now(), turnsStarted: s.presence.turnsStarted, extraSteps: [] });
  const served = (s, id) => ({
    ...viewOf(s, now()),
    thread: id,
    ...deps.build ? { serverBuild: deps.build } : {}
  });
  async function onPress(id, p, thread) {
    let copy = null;
    let local = null;
    let error = null;
    let note = thread === id ? null : "stale";
    let s = await updateState(dir2, id, async (s2) => {
      if (note) return s2;
      const r = pressOn(s2, p);
      if ("stale" in r) {
        note = "stale";
        return s2;
      }
      let next = {
        ...s2,
        ledger: r.ledger,
        lastActions: r.last ? { ...s2.lastActions, [p.id]: r.last } : s2.lastActions,
        // Codex was told of the close; with the id out of `told`, a second close of the row is reported too.
        told: p.action === "undo" ? { ...s2.told, closed: s2.told.closed.filter((id2) => id2 !== p.id) } : s2.told
      };
      if (r.last?.result?.state === "pending") local = { effects: r.effects, pending: r.last.result };
      for (const e of r.effects) {
        if (e.kind === "send") {
          try {
            const queuedId = await queue(next, e.text);
            next = {
              ...next,
              sent: [...next.sent, { text: e.text, press: e.by, at: now(), row: p.id, queuedId }].slice(-MAX_SENT)
            };
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            error = `Not sent: ${reason}`;
            copy = null;
            const failed = r.last && { ...r.last, delivery: { state: "failed", reason } };
            return failed ? { ...s2, lastActions: { ...s2.lastActions, [p.id]: failed } } : s2;
          }
        } else if (e.kind === "copy") copy = { text: e.text, name: e.name };
      }
      return next;
    }).catch(async (err) => {
      error = `Not sent: ${err instanceof Error ? err.message : String(err)}`;
      return readState(dir2, id);
    });
    const ran = local;
    if (ran) {
      const errors = [];
      for (const e of ran.effects)
        if (e.kind !== "send") errors.push(e.kind === "open" ? await open(s, e.target) : null);
      const result = finishedResult(ran.pending, errors, now());
      s = await updateState(dir2, id, (s2) => ({
        ...s2,
        lastActions: withResult(s2.lastActions, p.id, ran.pending.at, result)
      }));
    }
    return { view: served(s, id), copy, error, note };
  }
  async function open(s, target) {
    const run2 = (argv2) => deps.exec(argv2, { cwd: "/", timeoutMs: 1e4 });
    const failure = (r2) => r2.stderr.trim() || `open exited ${r2.code}`;
    if (/^https:\/\//.test(target)) {
      const r2 = await run2(["open", target]);
      return r2.code === 0 ? null : failure(r2);
    }
    const path = localPath(target, s.root || "/", s.home);
    const info = await stat2(path).catch(() => null);
    if (!info) return "it no longer exists";
    const isExecutable = info.isFile() && await access(path, constants.X_OK).then(
      () => true,
      () => false
    );
    const { argv, fallback } = openCommands(path, info.isFile(), isExecutable);
    const r = await run2(argv);
    const retry = r.code !== 0 && fallback ? await run2(fallback) : r;
    return retry.code === 0 ? null : failure(retry);
  }
  const demos = /* @__PURE__ */ new Map();
  const demoOf = (id) => {
    const s = demos.get(id) ?? demoState(now());
    demos.set(id, s);
    return s;
  };
  function onDemoPress(id, p, thread) {
    const s = demoOf(id);
    const r = thread === id ? pressOn(s, p) : { stale: true };
    if ("stale" in r) return { view: served(s, id), copy: null, error: null, note: "stale" };
    const isLocal = r.last?.result !== void 0;
    let lastActions = s.lastActions;
    if (r.last && !isLocal) {
      const { delivery: _delivery, ...sample } = r.last;
      lastActions = { ...lastActions, [p.id]: sample };
    }
    const next = { ...s, ledger: r.ledger, lastActions };
    demos.set(id, next);
    return {
      view: served(next, id),
      copy: null,
      error: null,
      note: r.effects.length > 0 ? "sample" : null
    };
  }
  async function callTool(name, args, id, turn) {
    if (!id) return { ...text("Not done: this call carries no session id."), isError: true };
    const heard = (s) => turn === void 0 ? s : noteToolCall(s, turn, now());
    switch (name) {
      case "record_finding":
      case "close": {
        let result = "";
        await updateState(dir2, id, (s) => {
          const r = (name === "close" ? recordClose : recordFinding)(CODEX, s.ledger, args, now());
          result = r.result;
          return heard({ ...s, ledger: r.ledger });
        });
        return text(result);
      }
      case "inbox": {
        const s = turn === void 0 ? await readState(dir2, id) : await updateState(dir2, id, heard);
        return text(inboxToolText(viewOf(s, now())));
      }
      case "inbox_view": {
        const devPage = await deps.devPage?.();
        const dev = devPage ? { devPage: tabUri(devPage) } : {};
        if (args.demo === true)
          return { ...text("Inbox demo"), structuredContent: { ...served(demoOf(id), id), ...dev } };
        const s = await updateState(dir2, id, (s2) => ({ ...s2, tabSeenAt: now() }));
        return { ...text("Inbox view"), structuredContent: { ...served(s, id), ...dev } };
      }
      case "inbox_tab_page": {
        const devPage = await deps.devPage?.();
        if (!devPage) return { ...text("Not done: no dev build is running."), isError: true };
        return { ...text("Tab page"), structuredContent: { html: stamped(devPage) } };
      }
      case "inbox_press": {
        const p = args.press;
        const r = args.demo === true ? onDemoPress(id, p, args.thread) : await onPress(id, p, args.thread);
        return { ...text(r.error ?? (r.note ? noteText(r.note) : "Done")), structuredContent: r };
      }
    }
    return { ...text(`Unknown tool: ${name}`), isError: true };
  }
  return async (m) => {
    const { id, method, params } = m;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "inbox", version: "0.1.0" }
        });
      case "tools/list":
        return ok({ tools });
      case "tools/call": {
        const name = String(params?.name ?? "");
        const args = params?.arguments ?? {};
        try {
          return ok(await callTool(name, args, sessionOf(params), turnOf(params)));
        } catch (err) {
          return ok({ ...text(`Failed: ${err instanceof Error ? err.message : String(err)}`), isError: true });
        }
      }
      case "resources/list":
        return ok({ resources: [{ uri, name: "Inbox", mimeType: TAB_MIME }] });
      case "resources/templates/list":
        return ok({ resourceTemplates: [] });
      case "resources/read":
        return ok({ contents: [{ uri, mimeType: TAB_MIME, text: stamped(deps.tabHtml) }] });
      case "ping":
        return ok({});
    }
    if (id === void 0) return null;
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  };
}

// src/tab.html
var tab_default = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Inbox</title>\n    <style>\n      /* The host\'s variables when Codex passes them; otherwise the pane\'s own colors. */\n      :root {\n        color-scheme: light;\n        --bg: var(--color-background-primary, #ffffff);\n        --text: var(--color-text-primary, #1f1f1f);\n        --muted: var(--color-text-secondary, #595959);\n        --key: #243bf5;\n        --needs-you: #745417;\n        --findings: #7b00e8;\n        --done: #25652f;\n        --error: #a5293d;\n        --error-mark: #a5293d;\n        --sans: var(--font-sans, -apple-system, system-ui, sans-serif);\n        --mono: var(--font-mono, ui-monospace, \'SF Mono\', Menlo, monospace);\n        /* Surfaces are mixed from the host\'s colors, so they follow its theme. */\n        --card: color-mix(in srgb, var(--text) 4.5%, var(--bg));\n        --raised: color-mix(in srgb, var(--text) 9%, var(--bg));\n        --selected: color-mix(in srgb, #4c9aff 20%, var(--card));\n        /* A closed row\'s age, dimmer than --muted and still 4.5:1 on the card. */\n        --age: color-mix(in srgb, var(--muted) 90%, var(--bg));\n        --hover: color-mix(in srgb, var(--key) 14%, transparent);\n        --soft: color-mix(in oklab, var(--text) 8%, transparent);\n        --soft-hover: color-mix(in oklab, var(--text) 10%, transparent);\n        /* A closed row under the pointer: half --soft, so a list swept by the pointer stays quiet. */\n        --row-hover: color-mix(in oklab, var(--soft) 50%, transparent);\n        /* The Codex app\'s timing: --transition-duration-basic with ease, --cubic-move, --cubic-enter. */\n        --quick: 150ms ease;\n        --move: 200ms cubic-bezier(0.65, 0, 0.35, 1);\n        --enter: 300ms cubic-bezier(0.19, 1, 0.22, 1);\n        /* Where a row\'s mark sits, and where its text starts. */\n        --mark-x: 18px;\n        --text-x: 44px;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root:not([data-theme=\'light\']) {\n          color-scheme: dark;\n          --bg: var(--color-background-primary, #171717);\n          --text: var(--color-text-primary, #ececec);\n          --muted: var(--color-text-secondary, #a8a8a8);\n          --key: #b1b9f9;\n          --needs-you: #ffc107;\n          --findings: #cab0ff;\n          --done: #7ecd8f;\n          --error: #ffa3b0;\n          --error-mark: #ff6b80;\n          --card: color-mix(in srgb, var(--text) 5.5%, var(--bg));\n          --raised: color-mix(in srgb, var(--text) 11%, var(--bg));\n          --selected: color-mix(in srgb, #7fa6d9 15%, var(--card));\n          --age: color-mix(in srgb, var(--muted) 85%, var(--bg));\n          --soft: color-mix(in oklab, var(--text) 12%, transparent);\n          --soft-hover: color-mix(in oklab, var(--text) 14%, transparent);\n        }\n      }\n      :root[data-theme=\'dark\'] {\n        color-scheme: dark;\n        --key: #b1b9f9;\n        --needs-you: #ffc107;\n        --findings: #cab0ff;\n        --done: #7ecd8f;\n        --error: #ffa3b0;\n        --error-mark: #ff6b80;\n        --card: color-mix(in srgb, var(--text) 5.5%, var(--bg));\n        --raised: color-mix(in srgb, var(--text) 11%, var(--bg));\n        --selected: color-mix(in srgb, #7fa6d9 15%, var(--card));\n        --age: color-mix(in srgb, var(--muted) 85%, var(--bg));\n        --soft: color-mix(in oklab, var(--text) 12%, transparent);\n        --soft-hover: color-mix(in oklab, var(--text) 14%, transparent);\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        margin: 0;\n        background: var(--bg);\n        color: var(--text);\n        font: 13px/20px var(--sans);\n        -webkit-font-smoothing: antialiased;\n      }\n      button {\n        font: inherit;\n        color: inherit;\n        background: none;\n        border: none;\n        padding: 0;\n        text-align: left;\n      }\n      :focus-visible {\n        outline: 1.5px solid var(--key);\n        outline-offset: 1px;\n        border-radius: 4px;\n      }\n      .muted {\n        color: var(--muted);\n      }\n      .tone-needsYou {\n        color: var(--needs-you);\n      }\n      .tone-findings {\n        color: var(--findings);\n      }\n      .tone-done {\n        color: var(--done);\n      }\n      .tone-error {\n        color: var(--error);\n      }\n      .notice {\n        padding: 10px 16px;\n        color: var(--error);\n        overflow-wrap: anywhere;\n      }\n      .notice .key {\n        color: var(--text);\n      }\n\n      /* Tabs: the shown one a raised panel, the others text on the background. */\n      nav {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 4px 16px;\n        padding: 12px 12px 0;\n      }\n      .tabs {\n        display: flex;\n        gap: 4px;\n      }\n      .tab {\n        padding: 6px 12px;\n        border-radius: 6px;\n        color: var(--muted);\n      }\n      .tab:hover {\n        color: var(--text);\n      }\n      .tab.shown {\n        background: var(--raised);\n        color: var(--text);\n        font-weight: 600;\n      }\n      .tab .count {\n        font-weight: 600;\n        margin-left: 6px;\n      }\n      .status {\n        margin-left: auto;\n        color: var(--muted);\n        font-size: 12px;\n      }\n      .status-line {\n        flex-basis: 100%;\n        padding: 0 4px;\n        font-size: 12px;\n        overflow-wrap: anywhere;\n      }\n\n      main {\n        display: flex;\n        flex-direction: column;\n        gap: 8px;\n        padding: 12px 12px 4px;\n      }\n      section {\n        background: var(--card);\n        border-radius: 8px;\n        padding: 10px 0;\n      }\n      .group-title {\n        padding: 0 14px 6px var(--mark-x);\n        font-weight: 500;\n      }\n      .group-title .count {\n        color: var(--muted);\n        margin-left: 6px;\n      }\n\n      /* Rows. */\n      .row {\n        display: flex;\n        padding: var(--row-pad) 14px var(--row-pad) var(--mark-x);\n      }\n      /* An open row keeps a closed row\'s padding, so its line does not move as it opens. */\n      .row.selected {\n        background-color: var(--selected);\n      }\n      /* A row that just appeared, in its tab\'s color. */\n      .row.new {\n        box-shadow: inset 3px 0 0 var(--bar);\n      }\n      .tone-bar-needsYou {\n        --bar: var(--needs-you);\n      }\n      .tone-bar-findings {\n        --bar: var(--findings);\n      }\n      /* Marks center in a badge\'s width, so a ?, a \u2022 and a number line up. */\n      .mark {\n        flex: none;\n        width: calc(var(--text-x) - var(--mark-x));\n        padding-right: 8px;\n        text-align: center;\n        color: var(--muted);\n      }\n      .mark .number {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        min-width: 18px;\n        height: 18px;\n        padding: 0 5px;\n        border-radius: 999px;\n        background: var(--soft);\n        color: var(--text);\n        font-size: 11px;\n        font-weight: 500;\n        line-height: 1;\n        font-variant-numeric: tabular-nums;\n        vertical-align: 1px;\n      }\n      .mark.done {\n        color: var(--done);\n      }\n      .mark.issue {\n        color: var(--needs-you);\n      }\n      .mark.opportunity {\n        color: var(--done);\n      }\n      .mark.error {\n        color: var(--error-mark);\n      }\n      .content {\n        flex: 1;\n        min-width: 0;\n        display: flex;\n        flex-direction: column;\n      }\n      /* Its space above is padding, not a gap, so the row\'s height grows smoothly when the panel mounts. Its 2px below,\n         with the row\'s padding, matches the space from the row\'s top edge to its title\'s text. */\n      .panel {\n        display: flex;\n        flex-direction: column;\n        gap: 8px;\n        padding: 8px 0 2px;\n      }\n      .content > .tight,\n      .content.tight {\n        display: flex;\n        flex-direction: column;\n        gap: 0;\n      }\n      .line {\n        display: flex;\n        width: 100%;\n        min-width: 0;\n      }\n      .line .text {\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: nowrap;\n      }\n      .line .text.two {\n        white-space: normal;\n        display: -webkit-box;\n        -webkit-line-clamp: 2;\n        -webkit-box-orient: vertical;\n      }\n      .line .after {\n        flex: none;\n        white-space: pre;\n        color: var(--muted);\n      }\n      .row.collapsed .line .after:not(.tone-error),\n      .row.collapsed .meta .age,\n      .closed-list .age {\n        color: var(--age);\n      }\n      .row.collapsed:hover .line .after:not(.tone-error),\n      .row.collapsed:hover .meta .age {\n        color: var(--muted);\n      }\n      .line .after.tone-error {\n        color: var(--error);\n      }\n      /* Open, and while closing, the title shows in full where it stood, with the age following its last word. */\n      .row.selected .line,\n      .row.closing .line {\n        display: block;\n      }\n      .row.selected .line .text,\n      .row.closing .line .text {\n        display: inline;\n        white-space: normal;\n      }\n      .row.selected .line .after,\n      .row.closing .line .after {\n        white-space: normal;\n      }\n      .row.collapsed:hover {\n        background-color: var(--row-hover);\n      }\n      /* After a click, rows slide under a pointer that has not moved, so nothing they bring under it lights up. */\n      .still .row.collapsed:not(:active):hover {\n        background-color: transparent;\n      }\n      .still .fold:not(:active):hover {\n        color: var(--muted);\n      }\n      .title {\n        font-weight: 600;\n      }\n      .title .after {\n        font-weight: 400;\n        color: var(--muted);\n      }\n      .meta {\n        font-size: 12px;\n      }\n      .body {\n        overflow-wrap: anywhere;\n      }\n      .body p {\n        margin: 0;\n      }\n      .body p + p {\n        margin-top: 4px;\n      }\n      /*\n       * Actions are Codex\'s own pill buttons, size sm: the recommended option is solid, the row\'s other\n       * answers are a soft gray fill, and the follow-ups are plain text. Keys are an extra, so no key text shows.\n       */\n      .keys {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n      }\n      .key {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        gap: 5px;\n        min-height: 26px;\n        padding: 3px 11px;\n        border-radius: 999px;\n        background: var(--soft);\n        font-weight: 400;\n        text-align: center;\n        white-space: nowrap;\n      }\n      .key:not(:disabled):hover {\n        background: var(--soft-hover);\n      }\n      .key:focus-visible {\n        outline-width: 2px;\n        outline-offset: 2px;\n        border-radius: 999px;\n      }\n      .key.primary {\n        background: var(--text);\n        color: var(--bg);\n      }\n      .key.primary:not(:disabled):hover {\n        background: color-mix(in srgb, var(--text) 82%, var(--bg));\n      }\n      .key .icon {\n        flex: none;\n        width: 14px;\n        height: 14px;\n      }\n      /* A follow-up is plain text: muted, the text color under the pointer, with no fill and no padding. */\n      .key.ghost {\n        padding: 0;\n        background: none;\n        color: var(--muted);\n      }\n      .key.ghost:not(:disabled):hover {\n        background: none;\n        color: var(--text);\n      }\n      .keys.follow-ups {\n        column-gap: 16px;\n      }\n      .key-groups {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 4px 16px;\n      }\n      .key-groups > .keys {\n        min-width: 0;\n      }\n      .actions {\n        display: flex;\n        flex-direction: column;\n        gap: 4px;\n      }\n      form {\n        display: flex;\n        align-items: center;\n        gap: 6px;\n      }\n      /* Codex\'s own fields: its border color, a 10px radius, and a heavier gray border on focus, not a colored ring. */\n      input {\n        flex: 1;\n        min-width: 0;\n        min-height: 28px;\n        font: inherit;\n        color: inherit;\n        background: transparent;\n        border: 1px solid color-mix(in oklab, var(--text) 15%, transparent);\n        border-radius: 10px;\n        padding: 4px 10px;\n      }\n      input::placeholder {\n        color: var(--muted);\n      }\n      /* The radius again, since :focus-visible sets 4px. */\n      input:focus,\n      textarea:focus {\n        outline: none;\n        border-color: color-mix(in oklab, var(--text) 32%, transparent);\n        border-radius: 10px;\n      }\n      textarea {\n        width: 100%;\n        font: 12px var(--mono);\n        color: inherit;\n        background: transparent;\n        border: 1px solid color-mix(in oklab, var(--text) 15%, transparent);\n        border-radius: 10px;\n      }\n\n      .empty-line {\n        color: var(--muted);\n      }\n      .fold {\n        display: block;\n        margin: 8px 0 0 calc(var(--mark-x) - 2px);\n        padding: 1px 4px;\n        border-radius: 5px;\n        color: var(--muted);\n      }\n      .fold:hover {\n        color: var(--text);\n      }\n      .fold .icon {\n        width: 12px;\n        height: 12px;\n        margin-right: 4px;\n        vertical-align: -1px;\n      }\n      /* The closed items sit under the fold\'s label. */\n      .closed-list {\n        --mark-x: 34px;\n        --text-x: 60px;\n        padding-top: 4px;\n      }\n      .outcome {\n        font-weight: 600;\n      }\n      .outcome.lapsed {\n        font-weight: 400;\n        color: var(--muted);\n      }\n      /* A row that just closed keeps a closed row\'s height, so the list does not change its rhythm. */\n      .settled-head {\n        display: flex;\n        align-items: center;\n        min-width: 0;\n      }\n      /* A row that settles while open fades its fill out as its height shrinks over the panel. */\n      .row.settled.was-open {\n        transition: background-color var(--move);\n        @starting-style {\n          background-color: var(--selected);\n        }\n      }\n      .settled-line {\n        display: flex;\n        flex: 1;\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: nowrap;\n      }\n      .settled-line.wraps {\n        display: block;\n        white-space: normal;\n      }\n      .settled .what {\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n      }\n      .settled .outcome-label {\n        flex: none;\n        max-width: 50%;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: pre;\n        color: var(--muted);\n      }\n      .settled-line.wraps .outcome-label {\n        white-space: normal;\n      }\n      /* Undo\'s fill is the time it has left. The pill keeps the line\'s height, so the row does not grow. */\n      .key.undo {\n        flex: none;\n        position: relative;\n        isolation: isolate;\n        overflow: hidden;\n        margin: -3px 0 -3px 12px;\n        background: color-mix(in oklab, var(--soft) 45%, transparent);\n      }\n      .time-left {\n        position: absolute;\n        inset: 0;\n        z-index: -1;\n        background: var(--soft);\n        transform-origin: left;\n        animation-name: empty;\n        animation-timing-function: linear;\n        animation-fill-mode: forwards;\n      }\n      .key.undo:not(:disabled):hover .time-left {\n        background: var(--soft-hover);\n      }\n      .time-left.paused {\n        animation-play-state: paused;\n      }\n      @keyframes empty {\n        from {\n          transform: scaleX(1);\n        }\n        to {\n          transform: scaleX(0);\n        }\n      }\n      /* The page is at least the pane\'s height. The footer sits at its bottom, and an empty tab\'s text fills the space above it. */\n      #app {\n        display: flex;\n        flex-direction: column;\n        min-height: 100vh;\n      }\n      .empty {\n        flex: 1;\n        display: flex;\n        flex-direction: column;\n        justify-content: center;\n        padding: 32px;\n        text-align: center;\n      }\n      .empty .title {\n        margin-bottom: 4px;\n      }\n      footer {\n        margin-top: auto;\n        display: flex;\n        flex-wrap: wrap;\n        justify-content: space-between;\n        gap: 4px 16px;\n        padding: 8px 16px 16px;\n        color: var(--muted);\n        font-size: 12px;\n      }\n      .demo-toggle {\n        padding: 0 6px;\n        border-radius: 5px;\n        color: var(--muted);\n      }\n      .demo-toggle:hover {\n        color: var(--text);\n        background: var(--hover);\n      }\n      .demo-note {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 4px 12px;\n        margin: 12px 12px 0;\n        padding: 6px 12px;\n        border-radius: 6px;\n        background: var(--raised);\n        color: var(--text);\n      }\n      /*\n       * Motion, with the Codex app\'s own timing, only for what enters or leaves. Hover, press and\n       * selection fills change at once. What a draw mounts fades in from @starting-style, and heights\n       * move in the script, around each draw. A row\'s own parts do not fade: a row that settles or is\n       * undone swaps them in place, where a fade from nothing reads as a flicker.\n       */\n      /* The new-row bar fades out. */\n      .row {\n        transition: box-shadow var(--enter);\n      }\n      /* A panel does not fade: it stays opaque, clipped by its row\'s height, so a row closing and the row\n         opening in its place move as one. */\n      .status-line,\n      .demo-note,\n      .empty,\n      main,\n      form {\n        transition: opacity var(--quick);\n        @starting-style {\n          opacity: 0;\n        }\n      }\n      @media (prefers-reduced-motion: reduce) {\n        *,\n        *::before,\n        *::after {\n          transition-duration: 0s !important;\n        }\n        /* With no motion, Undo stays full and does not count down. */\n        .time-left {\n          animation: none;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <div id="app" class="notice muted">Loading\u2026</div>\n    <script>\n      "use strict";(()=>{var be,y,gt,xn,I,ct,mt,ht,Pe,pe,z,yt,Oe,Ne,Ie,Rn,me={},he=[],Sn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,we=Array.isArray;function A(e,t){for(var n in t)e[n]=t[n];return e}function Me(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function $n(e,t,n){var o,i,s,r={};for(s in t)s=="key"?o=t[s]:s=="ref"?i=t[s]:r[s]=t[s];if(arguments.length>2&&(r.children=arguments.length>3?be.call(arguments,2):n),typeof e=="function"&&e.defaultProps!=null)for(s in e.defaultProps)r[s]===void 0&&(r[s]=e.defaultProps[s]);return fe(e,r,o,i,null)}function fe(e,t,n,o,i){var s={type:e,props:t,key:n,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:i??++gt,__i:-1,__u:0};return i==null&&y.vnode!=null&&y.vnode(s),s}function L(e){return e.children}function ge(e,t){this.props=e,this.context=t}function M(e,t){if(t==null)return e.__?M(e.__,e.__i+1):null;for(var n;t<e.__k.length;t++)if((n=e.__k[t])!=null&&n.__e!=null)return n.__e;return typeof e.type=="function"?M(e):null}function Tn(e){if(e.__P&&e.__d){var t=e.__v,n=t.__e,o=[],i=[],s=A({},t);s.__v=t.__v+1,y.vnode&&y.vnode(s),De(e.__P,s,t,e.__n,e.__P.namespaceURI,32&t.__u?[n]:null,o,n??M(t),!!(32&t.__u),i),s.__v=t.__v,s.__.__k[s.__i]=s,vt(o,s,i),t.__e=t.__=null,s.__e!=n&&bt(s)}}function bt(e){if((e=e.__)!=null&&e.__c!=null)return e.__e=e.__c.base=null,e.__k.some(function(t){if(t!=null&&t.__e!=null)return e.__e=e.__c.base=t.__e}),bt(e)}function ut(e){(!e.__d&&(e.__d=!0)&&I.push(e)&&!ye.__r++||ct!=y.debounceRendering)&&((ct=y.debounceRendering)||mt)(ye)}function ye(){try{for(var e,t=1;I.length;)I.length>t&&I.sort(ht),e=I.shift(),t=I.length,Tn(e)}finally{I.length=ye.__r=0}}function wt(e,t,n,o,i,s,r,d,c,u,f){var g,a,p,b,h,w,_=o&&o.__k||he,m=t.length;for(c=Ln(n,t,_,c,m),g=0;g<m;g++)(p=n.__k[g])!=null&&(a=p.__i!=-1&&_[p.__i]||me,p.__i=g,w=De(e,p,a,i,s,r,d,c,u,f),b=p.__e,p.ref&&a.ref!=p.ref&&(a.ref&&Fe(a.ref,null,p),f.push(p.ref,p.__c||b,p)),h==null&&b!=null&&(h=b),4&p.__u?(c=_t(p,c,e),a.__e&&(a.__e=null)):typeof p.type=="function"&&w!==void 0?c=w:b&&(c=b.nextSibling),p.__u&=-7);return n.__e=h,c}function Ln(e,t,n,o,i){var s,r,d,c,u,f=n.length,g=f,a=0;for(e.__k=new Array(i),s=0;s<i;s++)(r=t[s])!=null&&typeof r!="boolean"&&typeof r!="function"?(typeof r=="string"||typeof r=="number"||typeof r=="bigint"||r.constructor==String?r=e.__k[s]=fe(null,r,null,null,null):we(r)?r=e.__k[s]=fe(L,{children:r},null,null,null):r.constructor===void 0&&r.__b>0?r=e.__k[s]=fe(r.type,r.props,r.key,r.ref?r.ref:null,r.__v):e.__k[s]=r,c=s+a,r.__=e,r.__b=e.__b+1,d=null,(u=r.__i=En(r,n,c,g))!=-1&&(g--,(d=n[u])&&(d.__u|=2)),d==null||d.__v==null?(u==-1&&(i>f?a--:i<f&&a++),typeof r.type!="function"&&(r.__u|=4)):u!=c&&(u==c-1?a--:u==c+1?a++:(u>c?a--:a++,r.__u|=4))):e.__k[s]=null;if(g)for(s=0;s<f;s++)(d=n[s])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=M(d)),Rt(d,d));return o}function _t(e,t,n){var o,i;if(typeof e.type=="function"){for(o=e.__k,i=0;o&&i<o.length;i++)o[i]&&(o[i].__=e,t=_t(o[i],t,n));return t}e.__e!=t&&(t&&e.type&&!t.parentNode&&(t=M(e)),t=n.insertBefore(e.__e,t||null));do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function En(e,t,n,o){var i,s,r,d=e.key,c=e.type,u=t[n],f=u!=null&&(2&u.__u)==0;if(u===null&&d==null||f&&d==u.key&&c==u.type)return n;if(o>(f?1:0)){for(i=n-1,s=n+1;i>=0||s<t.length;)if((u=t[r=i>=0?i--:s++])!=null&&(2&u.__u)==0&&d==u.key&&c==u.type)return r}return-1}function pt(e,t,n){t[0]=="-"?e.setProperty(t,n??""):e[t]=n==null?"":typeof n!="number"||Sn.test(t)?n:n+"px"}function ue(e,t,n,o,i){var s,r;e:if(t=="style")if(typeof n=="string")e.style.cssText=n;else{if(typeof o=="string"&&(e.style.cssText=o=""),o)for(t in o)n&&t in n||pt(e.style,t,"");if(n)for(t in n)o&&n[t]==o[t]||pt(e.style,t,n[t])}else if(t[0]=="o"&&t[1]=="n")s=t!=(t=t.replace(yt,"$1")),r=t.toLowerCase(),t=r in e||t=="onFocusOut"||t=="onFocusIn"?r.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+s]=n,n?o?n[z]=o[z]:(n[z]=Oe,e.addEventListener(t,s?Ie:Ne,s)):e.removeEventListener(t,s?Ie:Ne,s);else{if(i=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&n==1?"":n))}}function ft(e){return function(t){if(this.l){var n=this.l[t.type+e];if(t[pe]==null)t[pe]=Oe++;else if(t[pe]<n[z])return;return n(y.event?y.event(t):t)}}}function De(e,t,n,o,i,s,r,d,c,u){var f,g,a,p,b,h,w,_,m,$,Q,O,X,dt,ce,Ce,T=t.type;if(t.constructor!==void 0)return null;128&n.__u&&(c=!!(32&n.__u),s=[d=t.__e=n.__e]),(f=y.__b)&&f(t);e:if(typeof T=="function"){g=r.length;try{if(m=t.props,$=T.prototype&&T.prototype.render,Q=(f=T.contextType)&&o[f.__c],O=f?Q?Q.props.value:f.__:o,n.__c?_=(a=t.__c=n.__c).__=a.__E:($?t.__c=a=new T(m,O):(t.__c=a=new ge(m,O),a.constructor=T,a.render=Cn),Q&&Q.sub(a),a.state||(a.state={}),a.__n=o,p=a.__d=!0,a.__h=[],a._sb=[]),$&&a.__s==null&&(a.__s=a.state),$&&T.getDerivedStateFromProps!=null&&(a.__s==a.state&&(a.__s=A({},a.__s)),A(a.__s,T.getDerivedStateFromProps(m,a.__s))),b=a.props,h=a.state,a.__v=t,p)$&&T.getDerivedStateFromProps==null&&a.componentWillMount!=null&&a.componentWillMount(),$&&a.componentDidMount!=null&&a.__h.push(a.componentDidMount);else{if($&&T.getDerivedStateFromProps==null&&m!==b&&a.componentWillReceiveProps!=null&&a.componentWillReceiveProps(m,O),t.__v==n.__v||!a.__e&&a.shouldComponentUpdate!=null&&a.shouldComponentUpdate(m,a.__s,O)===!1){t.__v!=n.__v&&(a.props=m,a.state=a.__s,a.__d=!1),t.__e=n.__e,t.__k=n.__k,t.__k.some(function(q){q&&(q.__=t)}),he.push.apply(a.__h,a._sb),a._sb=[],a.__h.length&&r.push(a),d=M(n);break e}a.componentWillUpdate!=null&&a.componentWillUpdate(m,a.__s,O),$&&a.componentDidUpdate!=null&&a.__h.push(function(){a.componentDidUpdate(b,h,w)})}if(a.context=O,a.props=m,a.__P=e,a.__e=!1,X=y.__r,dt=0,$)a.state=a.__s,a.__d=!1,X&&X(t),f=a.render(a.props,a.state,a.context),he.push.apply(a.__h,a._sb),a._sb=[];else do a.__d=!1,X&&X(t),f=a.render(a.props,a.state,a.context),a.state=a.__s;while(a.__d&&++dt<25);a.state=a.__s,a.getChildContext!=null&&(o=A(A({},o),a.getChildContext())),$&&!p&&a.getSnapshotBeforeUpdate!=null&&(w=a.getSnapshotBeforeUpdate(b,h)),ce=f!=null&&f.type===L&&f.key==null?xt(f.props.children):f,d=wt(e,we(ce)?ce:[ce],t,n,o,i,s,r,d,c,u),a.base=t.__e,t.__u&=-161,a.__h.length&&r.push(a),_&&(a.__E=a.__=null)}catch(q){if(r.length=g,t.__v=null,c||s!=null){if(q.then){for(t.__u|=c?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;s!=null&&(s[s.indexOf(d)]=null),t.__e=d}else if(s!=null)for(Ce=s.length;Ce--;)Me(s[Ce])}else t.__e=n.__e;t.__k==null&&(t.__k=n.__k||[]),q.then||kt(t),y.__e(q,t,n)}}else s==null&&t.__v==n.__v?(t.__k=n.__k,t.__e=n.__e):d=t.__e=An(n.__e,t,n,o,i,s,r,c,u);return(f=y.diffed)&&f(t),128&t.__u?void 0:d}function kt(e){e&&(e.__c&&(e.__c.__e=!0),e.__k&&e.__k.some(kt))}function vt(e,t,n){for(var o=0;o<n.length;o++)Fe(n[o],n[++o],n[++o]);y.__c&&y.__c(t,e),e.some(function(i){try{e=i.__h,i.__h=[],e.some(function(s){s.call(i)})}catch(s){y.__e(s,i.__v)}})}function xt(e){return typeof e!="object"||e==null||e.__b>0?e:we(e)?e.map(xt):e.constructor!==void 0?null:A({},e)}function An(e,t,n,o,i,s,r,d,c){var u,f,g,a,p,b,h,w=n.props||me,_=t.props,m=t.type;if(m=="svg"?i="http://www.w3.org/2000/svg":m=="math"?i="http://www.w3.org/1998/Math/MathML":i||(i="http://www.w3.org/1999/xhtml"),s!=null){for(u=0;u<s.length;u++)if((p=s[u])&&"setAttribute"in p==!!m&&(m?p.localName==m:p.nodeType==3)){e=p,s[u]=null;break}}if(e==null){if(m==null)return document.createTextNode(_);e=document.createElementNS(i,m,_.is&&_),d&&(y.__m&&y.__m(t,s),d=!1),s=null}if(m==null)w===_||d&&e.data==_||(e.data=_);else{if(s=m=="textarea"&&_.defaultValue!=null?null:s&&be.call(e.childNodes),!d&&s!=null)for(w={},u=0;u<e.attributes.length;u++)w[(p=e.attributes[u]).name]=p.value;for(u in w)p=w[u],u=="dangerouslySetInnerHTML"?g=p:u=="children"||u in _||u=="value"&&"defaultValue"in _||u=="checked"&&"defaultChecked"in _||ue(e,u,null,p,i);for(u in _)p=_[u],u=="children"?a=p:u=="dangerouslySetInnerHTML"?f=p:u=="value"?b=p:u=="checked"?h=p:d&&typeof p!="function"||w[u]===p||ue(e,u,p,w[u],i);if(f)d||g&&(f.__html==g.__html||f.__html==e.innerHTML)||(e.innerHTML=f.__html),t.__k=[];else if(g&&(e.innerHTML=""),wt(t.type=="template"?e.content:e,we(a)?a:[a],t,n,o,m=="foreignObject"?"http://www.w3.org/1999/xhtml":i,s,r,s?s[0]:n.__k&&M(n,0),d,c),s!=null)for(u=s.length;u--;)Me(s[u]);d&&m!="textarea"||(u="value",m=="progress"&&b==null?e.removeAttribute("value"):b!=null&&(b!==e[u]||m=="progress"&&!b||m=="option"&&b!=w[u])&&ue(e,u,b,w[u],i),u="checked",h!=null&&h!=e[u]&&ue(e,u,h,w[u],i))}return e}function Fe(e,t,n){try{if(typeof e=="function"){var o=typeof e.__u=="function";o&&e.__u(),o&&t==null||(e.__u=e(t))}else e.current=t}catch(i){y.__e(i,n)}}function Rt(e,t,n){var o,i;if(y.unmount&&y.unmount(e),(o=e.ref)&&(o.current&&o.current!=e.__e||Fe(o,null,t)),(o=e.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(s){y.__e(s,t)}o.base=o.__P=o.__n=null}if(o=e.__k)for(i=0;i<o.length;i++)o[i]&&Rt(o[i],t,n||typeof e.type!="function");n||Me(e.__e),e.__c=e.__=e.__e=void 0}function Cn(e,t,n){return this.constructor(e,n)}function St(e,t,n){var o,i,s,r;t==document&&(t=document.documentElement),y.__&&y.__(e,t),i=(o=typeof n=="function")?null:n&&n.__k||t.__k,s=[],r=[],De(t,e=(!o&&n||t).__k=$n(L,null,[e]),i||me,me,t.namespaceURI,!o&&n?[n]:i?null:t.firstChild?be.call(t.childNodes):null,s,!o&&n?n:i?i.__e:t.firstChild,o,r),vt(s,e,r),e.props.children=null}be=he.slice,y={__e:function(e,t,n,o){for(var i,s,r;t=t.__;)if((i=t.__c)&&!i.__)try{if((s=i.constructor)&&s.getDerivedStateFromError!=null&&(i.setState(s.getDerivedStateFromError(e)),r=i.__d),i.componentDidCatch!=null&&(i.componentDidCatch(e,o||{}),r=i.__d),r)return i.__E=i}catch(d){e=d}throw e}},gt=0,xn=function(e){return e!=null&&e.constructor===void 0},ge.prototype.setState=function(e,t){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=A({},this.state),typeof e=="function"&&(e=e(A({},n),this.props)),e&&A(n,e),e!=null&&this.__v&&(t&&this._sb.push(t),ut(this))},ge.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),ut(this))},ge.prototype.render=L,I=[],mt=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,ht=function(e,t){return e.__v.__b-t.__v.__b},ye.__r=0,Pe=Math.random().toString(8),pe="__d"+Pe,z="__a"+Pe,yt=/(PointerCapture)$|Capture$/i,Oe=0,Ne=ft(!1),Ie=ft(!0),Rn=0;function _e(e){return e.how==="dismissed"||e.how==="expired"||e.how==="claude"?!0:e.how==="update"&&/^(no longer applies|replaced|superseded|moot)/i.test(e.outcome)}function D(e){let t=Math.round(e/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let n=Math.round(t/60);return n<48?`${n}h ago`:`${Math.round(n/24)}d ago`}function ke(e,t){return e.length>t?`${e.slice(0,t-1)}\\u2026`:e}function In(e){return e.replace(/\\/+$/,"").split("/").pop()??e}function ve(e){return e.charAt(0).toUpperCase()+e.slice(1)}function $t(e){if(!e)return;if(e.step.some(n=>n.kind==="run"))return"run";let t=e.step[0]?.kind;return t==="copy"||t==="terminal"?"copy":t==="open"||t==="link"?"open":void 0}var On="This changed before your press. Nothing was sent.";function J(e){return e==="sample"?"Sample entry: nothing was sent.":On}function Mn(e,t){switch(t.kind){case"run":return{kind:"send",text:Fn.run(e,t.command),by:{id:e.id,action:"run"}};case"open":return{kind:"open",target:t.path,name:In(t.path)};case"link":return{kind:"open",target:t.url,name:t.name??t.url};case"copy":return{kind:"copy",text:t.text,name:t.name??"snippet",isCommand:!1};case"terminal":return{kind:"copy",text:t.command,name:t.name??ke(t.command,32),isCommand:!0}}}function Tt(e,t){return t.step.map(n=>Mn(e,n))}function Lt(e,t){return{state:"pending",parts:e.flatMap(n=>n.kind==="send"?[]:[{kind:n.kind,name:n.name,isCommand:n.kind==="copy"&&n.isCommand,error:null}]),at:t}}function Dn(e){return[`${e.kind==="issue"?"Issue":"Opportunity"}: ${e.title}`,e.detail,...e.path?[`File: ${e.path}`]:[]]}var Fn={answer:(e,t)=>`Re "${e.ask}": ${t}`,explain:e=>{let t=e.kind==="task"?"this task you left for me":"this question you asked me",n=e.options.length>0?`\nOptions: ${e.options.join(" / ")}`:"";return`Remind me what ${t} is about: why it came up, and what each choice would mean. Don\'t act on it yet.\n"${e.ask}"${n}`},run:(e,t)=>`For "${e.ask}", run this:\n\\`\\`\\`\n${t}\n\\`\\`\\``,taskReply:(e,t)=>`Re the task you left for me, "${e.ask}": ${t}`,finding:(e,t,n="")=>[t==="address"?"Please address this finding you recorded:":t==="discuss"?"Let\'s talk through this finding you recorded before changing anything:":"About this finding you recorded:",...Dn(e),...t==="typed"?["",n]:[]].join(`\n`)};var Ue=[..."abcfghilm"],S="\\u2002\\xB7\\u2002",Et={issue:{label:"Issue",mark:"\\u25B2",tone:"needsYou"},opportunity:{label:"Opportunity",mark:"\\u2726",tone:"done"}},Hn=3,R=5120,Ve=1500,qe=400;function At(e,t){return e>0&&t-e<qe}function Z(e){return[...e.needsYou.questions,...e.needsYou.tasks,...e.findings.rows]}function Ct(e){return e.filter(t=>t.state.is==="settled").map(t=>t.id)}function ee(e,t){return e.filter(n=>!t.has(n.id)).slice(0,Hn)}function Pt(e){return e?.is==="notSent"||e?.is==="local"&&e.result.state==="failed"}function Nt(e){return e.is==="done"||e.is==="queued"}var Un=e=>e==="terminal"?"Run it in a terminal, or type ! and paste.":"Run it in Terminal.",He={open:{pending:"Opening",done:"Opened",failed:"open"},copy:{pending:"Copying",done:"Copied",failed:"copy"}};function Vn(e,t){let o=e.parts.length>1&&e.parts.every(r=>r.kind==="open"&&r.error===null&&/^PR #\\d+$/.test(r.name))?[{...e.parts[0],name:`${e.parts.length} PRs`}]:e.parts;if(e.state==="pending")return`${o.map(r=>`${He[r.kind].pending} ${r.name}`).join(S)}\\u2026`;let i=o.map(r=>r.error===null?`${He[r.kind].done} ${r.name}`:`Could not ${He[r.kind].failed} ${r.name}: ${r.error}`).join(S);if(e.state==="failed")return i;let s=o.some(r=>r.kind==="copy"&&r.isCommand);return`\\u2713 ${i}${s?`. ${Un(t)}`:""}`}function We(e,t){return e.is==="note"?J(e.note):e.is==="local"?Vn(e.result,t):e.is==="queued"?`Queued: ${e.label}`:e.is==="notSent"?`Not sent: ${e.reason}`:`\\u2713 ${e.label}`}var qn=[{id:"needsYou",label:"Needs you",hotkey:"1"},{id:"findings",label:"Findings",hotkey:"2"},{id:"prs",label:"PRs",hotkey:"3"}],Ye=qn.filter(e=>e.id!=="prs");function W(e,t){return e==="needsYou"?{title:"Nothing needs you.",hint:`${t}\'s questions and the tasks only you can do show up here.`}:{title:"No findings yet",hint:`${t} flags issues and opportunities it spots beyond your task.`}}var Wn=["needsYou","findings"];function Yn(e){return{needsYou:[...e.needsYou.questions,...e.needsYou.tasks].map(t=>t.id),findings:e.findings.rows.map(t=>t.id)}}function It(e,t){let n=Yn(t);return{seen:{needsYou:new Set(n.needsYou),findings:new Set(n.findings)},added:{needsYou:e?n.needsYou.filter(o=>!e.needsYou.has(o)):[],findings:e?n.findings.filter(o=>!e.findings.has(o)):[]}}}function Ot(e,t,n,o){let i=r=>r.some(d=>d.state.is!=="settled"||n.has(d.id)),s=(r,d)=>o.has(r)&&ee(d,n).length>0;return t==="findings"?!i(e.findings.rows)&&!s("finding",e.findings.closed):e.heard==="heard"&&!i(e.needsYou.questions)&&!i(e.needsYou.tasks)&&!s("question",e.needsYou.closed.questions)&&!s("task",e.needsYou.closed.tasks)}function Mt(e,t,n,o){let i=t?Wn.find(s=>s!==e&&n[s].length>0):void 0;return i?{tab:i,id:o[i].find(s=>n[i].includes(s))??null}:null}var xe=3e3,Dt=6e4,no=R+2*xe;function Ft(e){return Ct(Z(e))}function Ht(e,t,n){return new Map(t.map(o=>[o,e.get(o)??n]))}var te=200;function Ut(e,t,n=new Set,o=new Map){let i=(s,r)=>{let d=o.get(s);return n.has(s)||t-r<R||t-(d??r+R)<te};return new Set([...e].filter(([s,r])=>i(s,r)).map(([s])=>s))}var F={entering:300,opening:200,closing:200,settling:200,leaving:te,closed:0,open:0,settled:0,undoing:0},jn={closed:"closed",opening:"open",open:"open",closing:"closed",settling:"settled",settled:"settled",undoing:"settled",leaving:"gone"};function Gn(e,t){return e==="entering"?t==="closed"||t==="open":jn[e]===t}function Vt(e,t){return e==="entering"?t==="open"?"open":"closed":Bn[e]}var Bn={opening:"open",closing:"closed",settling:"settled",leaving:null};function ne(e){return F[e]>0}function qt(e,t,n,o=!1,i=!1){let s=Kn(e,t,n,o,i);if(s===null)return null;if(i&&ne(s)){let r=Vt(s,t==="undoing"?"settled":t);return r===null?null:{state:Wt(r,t),since:n}}return s===e?.state?e:{state:s,since:n}}function Kn(e,t,n,o,i){if(!e)return t==="gone"?null:(t==="closed"||t==="open")&&o&&!i?"entering":t;let{state:s,since:r}=e,d=t==="undoing"?"settled":t;if(!Gn(s,d))return Qn(s,d);if(ne(s)&&n-r>=F[s]){let c=Vt(s,d);return c===null?null:Wt(c,t)}return s==="settled"||s==="undoing"?t==="undoing"?"undoing":"settled":s}function Wt(e,t){return e==="settled"&&t==="undoing"?"undoing":e}function Qn(e,t){switch(t){case"open":return"opening";case"closed":return e==="leaving"?"entering":"closing";case"settled":return"settling";case"gone":return"leaving"}}var Xn=0;function l(e,t,n,o,i,s){t||(t={});var r,d,c=t;if("ref"in c)for(d in c={},t)d=="ref"?r=t[d]:c[d]=t[d];var u={type:e,props:c,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Xn,__i:-1,__u:0,__source:i,__self:s};if(typeof e=="function"&&(r=e.defaultProps))for(d in r)c[d]===void 0&&(c[d]=r[d]);return y.vnode&&y.vnode(u),u}var Jn={check:"M20 6 9 17l-5-5",play:"M7 4.5v15l12-7.5z",copy:"M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",open:"M7 17 17 7M8 7h9v9",retry:"M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",undo:"M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",right:"m9 18 6-6-6-6",down:"m6 9 6 6 6-6"};function nt({name:e}){return l("svg",{class:"icon",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",children:l("path",{d:Jn[e]})})}function Zn(e){let t=$t(e);return t==="run"?"play":t}var x=null,K=!1,Te=null,Zt=!1,st=0,en=0,v="needsYou",U={needsYou:null,findings:null},E=null,Ge=!1,re=new Map,Yt=new Set,Y=new Set,Be=new Map,N=new Map,Ke=new Map,le=new Map,j=null,C=new Map,Qe=null,ot=new Map,G=new Set,B=new Set,Re=new Set,P=new Map,Xe=new Map,it=new Map,de=new Set,Se=new Map,tn=0,ze,nn=null,sn=0,jt=0,Je=!1,es=0,ae=new Map;function on(e,t,n){return new Promise((o,i)=>{let s=++es,r=n===void 0?void 0:window.setTimeout(()=>{ae.delete(s)&&i(new Error(`The inbox did not answer in ${Math.round(n/1e3)} s`))},n);ae.set(s,{resolve:o,reject:i,timer:r}),parent.postMessage({jsonrpc:"2.0",id:s,method:e,params:t},"*")})}window.addEventListener("message",e=>{let t=e.data;if(!(!t||t.jsonrpc!=="2.0")){if(t.id!=null&&!t.method&&ae.has(t.id)){let n=ae.get(t.id);ae.delete(t.id),clearTimeout(n.timer),t.error?n.reject(t.error):n.resolve(t.result);return}t.method==="ui/notifications/host-context-changed"&&rn(t.params??{}),t.id!=null&&t.method&&parent.postMessage({jsonrpc:"2.0",id:t.id,result:{}},"*")}});function rn(e){e.theme&&(document.documentElement.dataset.theme=e.theme);for(let[t,n]of Object.entries(e.styles?.variables??{}))document.documentElement.style.setProperty(t,n)}async function rt(e,t={},n){let o=await on("tools/call",{name:e,arguments:t},n);if(!o||o.isError||o.structuredContent===void 0)throw new Error(o?.isError&&o.content?.[0]?.text||"The answer had nothing to show");return o.structuredContent}function an(e,t){if(t<jt)return;jt=t,Te=null,st=0,en=Date.now();let n=C;C=Ht(C,Ft(e),Date.now()),[...C.keys()].some(s=>!n.has(s))&&V(R),x=e;let o=It(Qe,e);Qe=o.seen;let i=[...o.added.needsYou,...o.added.findings];for(let s of i)ot.set(s,Date.now()),G.add(s);i.length>0&&V(Ve),ts(e,o.added),k()}function ts(e,t){let n=Ee(),o=Le(e,n),i=Mt(v,Ot(e,v,n,Y),t,{needsYou:o.byTab.needsYou.map(s=>s.id),findings:o.byTab.findings.map(s=>s.id)});i&&(v=i.tab,i.id&&lt(i.tab,i.id))}var ln=3*xe;async function at(){let e=++sn;try{let t=await rt("inbox_view",{demo:K},ln);t.devPage&&t.devPage!==ss&&os(),Zt=t.serverBuild!=="1a4481eabe60",an(t,e)}catch(t){x?st++:Te=ns(t),k()}}function ns(e){let t=typeof e=="object"&&e!==null&&typeof e.message=="string"?e.message:String(e),n=ke(t.replace(/^(Failed|Not done): /,"").replace(/\\s+/g," ").trim(),120)||"No reason given";return ve(/[.!?\u2026]$/.test(n)?n:`${n}.`)}var ss=window.__inboxPage,je=!1;async function os(){if(!je){je=!0;try{let{html:e}=await rt("inbox_tab_page",{},ln),t=window.setTimeout(()=>{},0);for(let n=1;n<=t;n++)clearTimeout(n);document.open(),document.write(e),document.close()}catch{je=!1}}}async function dn(){Je||await at(),setTimeout(dn,xe)}function is(e,t){return Z(e).some(n=>n.id===t&&n.state.is!=="settled")}function rs(e,t){return Z(e).some(n=>n.id===t&&n.feedback?.is==="notSent")}async function H(e,t,n,o="Sending\\u2026"){t.action!=="undo"&&gn(e),Be.set(e,o),N.delete(e),Ke.delete(e),le.delete(e),k(),Je=!0;let i=++sn;try{let s=await rt("inbox_press",{press:t,thread:x?.thread,demo:K},Dt);s.copy&&await as(e,s.copy),s.view&&an(s.view,i),s.error&&!(x&&rs(x,e))&&N.set(e,s.error),!s.error&&s.note!=="stale"&&n?.(),s.note&&x&&is(x,e)?(Ke.set(e,{text:J(s.note),at:Date.now()}),V(R),s.note==="stale"&&t.action==="type"&&(E=e)):s.note&&(j={text:J(s.note),at:Date.now()},V(R))}catch{N.set(e,"Not sent: the inbox did not answer.")}finally{Je=!1,Be.delete(e),k()}}async function as(e,t){try{await navigator.clipboard.writeText(t.text)}catch{N.set(e,`Could not copy ${t.name}: this tab has no clipboard access`),le.set(e,t)}}function ls(e){gn(e),E=e,Ge=!0,k()}function cn(e){let{id:t,item:n}=e,o=e.actions.filter(g=>Yt.has(t)||!g.isFolded),i=e.actions.length-o.length,s=o.map(g=>g.press.action).lastIndexOf("answer"),r=[],d=[],c=e.feedback?.is==="notSent"?e.feedback.retry:null;c&&r.push({label:"Try again",icon:"retry",run:()=>{H(t,c)}});let u=0,f=()=>u<Ue.length?{hotkey:Ue[u++]}:{};for(let[g,a]of o.entries()){let p=a.press,b=a.label;if(p.action==="answer"&&n)r.push({...f(),label:b,isPrimary:a.isPrimary,run:()=>{H(t,p)}}),g===s&&i>0&&r.push({label:`All ${n.options.length} options`,run:()=>{Yt.add(t),k()}});else if(p.action==="step"){let h=e.steps[p.step],w=a.kind==="local"&&n&&h?We({is:"local",result:Lt(Tt(n,h),Date.now())},"html"):void 0,_=Zn(h);r.push({...f(),label:b,..._?{icon:_}:{},run:()=>{H(t,p,void 0,w)}})}else if(a.hotkey){let h=p.action==="type"?()=>ls(t):()=>{H(t,p)},w=p.action==="done"?{icon:"check"}:{};(a.isFollowUp?d:r).push({hotkey:a.hotkey,label:b,...w,run:h})}}return{keys:r,more:d}}function ds(e,t,n){let o=n.kind==="question",i=t.state.is==="handedOff",s=n.id;return{id:s,handle:i?"\\u2713":t.handle,handleTone:i?"done":void 0,...i?{fold:{}}:{},title:n.ask,titleAfter:n.at===null?void 0:`${S}${D(e.at-n.at)}`,hasSecondLine:o,...cn(t),typing:{hint:o?"Your answer":"Your reply to Codex",send:r=>{H(s,{action:"type",id:s,text:r},()=>re.delete(s))}},feedback:t.feedback}}function cs(e,t,n){let o=Et[n.kind],i=t.state.is==="handedOff",s=n.id;return{id:s,handle:i?"\\u2713":o.mark,handleTone:i?"done":void 0,kind:n.kind,...i?{fold:{}}:{},title:n.title,meta:l(L,{children:[l("span",{class:`tone-${o.tone}`,children:o.label}),l("span",{class:"muted age",children:[S,D(e.at-n.at)]})]}),line:{text:n.title},body:l("div",{children:[l("p",{children:n.detail}),n.path?l("p",{children:[l("span",{class:"muted",children:"Relevant file: "}),n.path]}):null]}),...cn(t),typing:{hint:"Your reply to Codex",send:r=>{H(s,{action:"type",id:s,text:r},()=>re.delete(s))}},feedback:t.feedback}}function Le(e,t){let n=d=>d.flatMap(c=>c.state.is==="settled"?t.has(c.id)?[{settled:c}]:[]:c.item?[{row:ds(e,c,c.item)}]:c.finding?[{row:cs(e,c,c.finding)}]:[]),o=d=>d.flatMap(c=>"row"in c?[c.row]:[]),i=n(e.needsYou.questions),s=n(e.needsYou.tasks),r=n(e.findings.rows);return{questions:i,tasks:s,findings:r,byTab:{needsYou:[...o(i),...o(s)],findings:o(r)}}}function un(e){return new Set(e.flatMap(t=>"settled"in t?[t.settled.id]:[]))}function Ee(){return Ut(C,Date.now(),B)}function $e(e){return"row"in e?e.row.id:e.settled.id}var Gt={question:"questions",task:"tasks",finding:"findings"};function us(e){let t=Date.now();tn=t;let n=Le(e,Ee()),o=n.byTab[v];ze=o[pn(o,v,e)]?.id;let i=v==="needsYou"?["question","task"]:["finding"],s=new Set;for(let r of i){let d=n[Gt[r]],c=new Set(d.map($e)),u=[...d];for(let[g,a]of(Se.get(r)??[]).entries()){let p=Xe.get(a);!c.has(a)&&p&&P.has(a)&&u.splice(Math.min(g,u.length),0,p)}let f=[];for(let g of u){let a=$e(g),p=P.get(a),b=c.has(a)?"settled"in g?B.has(a)?"undoing":"settled":a===ze?"open":"closed":"gone",h=qt(p,b,t,G.has(a),Ae.matches);if(!h){Ze(a);continue}if(h!==p){let w=!!p&&["opening","open","closing","settling"].includes(p.state);h.state==="leaving"&&w?de.add(a):de.delete(a),ne(h.state)&&V(F[h.state])}P.set(a,h),Xe.set(a,g),"row"in g&&(h.state==="open"||h.state==="opening")&&it.set(a,g.row),s.add(a),f.push(g)}Se.set(r,f.map($e)),n[Gt[r]]=f}for(let r of[...P.keys()])s.has(r)||Ze(r);for(let r of["question","task","finding"])i.includes(r)||Se.delete(r);return n}function Ze(e){P.delete(e),Xe.delete(e),it.delete(e),de.delete(e)}async function ps(e){if(B.has(e.id))return;let t=e.type==="finding"?"findings":"needsYou";B.add(e.id);try{await H(e.id,{action:"undo",id:e.id},()=>lt(t,e.id))}finally{B.delete(e.id);let n=C.get(e.id),o=n!==void 0&&Date.now()-n<R,i=N.get(e.id);i&&!o&&(j={text:i,at:Date.now(),isError:!0},V(R)),n!==void 0&&!o&&C.set(e.id,Date.now()-R),k()}}function pn(e,t,n){let o=U[t],i=o?o.id:(t==="needsYou"?n.needsYou.topId:null)??e[0]?.id;return i?e.findIndex(s=>s.id===i):-1}function lt(e,t){U[e]={id:t,openedAt:Date.now()},V(qe)}function fn(e,t,n){let o=t[n];o&&(lt(e,o.id),k())}function gn(e){U[v]||(U[v]={id:e,openedAt:0})}function Bt(){return At(U[v]?.openedAt??0,Date.now())}function mn(e){return e.typing&&E===e.id?{keys:[],more:[]}:{keys:e.keys,more:e.more}}function Kt({k:e,isGhost:t=!1}){return l("button",{type:"button",class:e.isPrimary?"key primary":t?"key ghost":"key",disabled:Bt(),onClick:()=>{Bt()||e.run()},children:[e.icon?l(nt,{name:e.icon}):null,e.label]})}function fs({row:e}){let t=e.typing;return l("form",{onSubmit:o=>{o.preventDefault();let i=(re.get(e.id)??"").trim();i&&(E=null,t.send(i))},children:[l("input",{id:`type-${e.id}`,value:re.get(e.id)??"",placeholder:t.hint,"aria-label":t.hint,onInput:o=>re.set(e.id,o.currentTarget.value)}),l("button",{type:"submit",class:"key primary",children:"Send"}),l("button",{type:"button",class:"key ghost",onClick:()=>{E=null,k()},children:"Cancel"})]})}function Qt(e){let t=e.feedback;return t?t.is==="done"&&e.handleTone==="done"?t.label:We(t,"html"):null}function gs(e,t){let n=e.feedback;return n?Nt(n)?`${Qt(e)}${S}${D(t-n.at)}`:Qt(e):null}function hn(e){let t=Ke.get(e);return t&&Date.now()-t.at<R?t.text:null}function ms(e){return!N.has(e.id)&&hn(e.id)===null&&!le.has(e.id)}function hs(e){let t=ot.get(e);return t!==void 0&&Date.now()-t<Ve}function ys({row:e,tone:t,state:n,onSelect:o,now:i}){let s=n==="opening"||n==="open"||n==="entering"&&e.id===ze,r=n==="closing"||n==="leaving"&&de.has(e.id),d=hs(e.id)?` new tone-bar-${t}`:"",c=/^(\\d+)\\)$/.exec(e.handle)?.[1],u=l("span",{class:`mark ${e.handleTone??e.kind??""}`,children:c?l("span",{class:"number",children:c}):e.handle}),f=e.line??{text:e.title,after:e.titleAfter},g=Be.get(e.id),a=g??(ms(e)?gs(e,i):null),p=a?{...f,after:`${S}${a}`,afterTone:!g&&Pt(e.feedback)?"error":void 0}:f;return l("div",{class:`row ${s?"selected":"collapsed"}${r?" closing":""}${d}`,onClick:s?void 0:o,children:[u,l("div",{class:"content",children:[e.meta?l("div",{class:"meta",children:e.meta}):null,l("button",{type:"button",class:"line",...s?{tabIndex:-1,"aria-disabled":!0}:{"aria-expanded":!1},children:[l("span",{class:e.hasSecondLine?"text two":"text",children:p.text}),p.after?l("span",{class:`after ${p.afterTone?`tone-${p.afterTone}`:""}`,children:p.after}):null]}),s||r?l(yn,{row:e,isClosing:r}):null]})]})}function yn({row:e,isClosing:t}){let{keys:n,more:o}=mn(e),i=le.get(e.id),s=hn(e.id),r=!!e.typing&&E===e.id,d=[e.fold?.note?l("div",{class:"muted",children:e.fold.note}):null,s?l("div",{class:"muted",children:s}):null,N.has(e.id)?l("div",{class:"tone-error",children:N.get(e.id)}):null].filter(Boolean);return l("div",{class:t?"panel closing":"panel",inert:t,children:[e.body?l("div",{class:"body",children:e.body}):null,d.length>0?l("div",{class:"tight",children:d}):null,l("div",{class:"actions",children:[n.length>0||o.length>0?l("div",{class:"key-groups",children:[n.length>0?l("div",{class:"keys",children:n.map(c=>l(Kt,{k:c}))}):null,o.length>0?l("div",{class:"keys follow-ups",children:o.map(c=>l(Kt,{k:c,isGhost:!0}))}):null]}):null,r?l(fs,{row:e}):null]}),i?l("div",{children:[l("div",{class:"muted",children:["Copy ",i.name," from here:"]}),l("textarea",{rows:3,readOnly:!0,value:i.text,onFocus:c=>c.currentTarget.select()}),l("button",{type:"button",class:"key",onClick:()=>{le.delete(e.id),k()},children:"Close"})]}):null]})}function bs({settled:e,rowState:t}){let{state:n}=e;if(n.is!=="settled")return null;let o=t==="settling"||t==="leaving"&&de.has(e.id)?it.get(e.id):void 0,i=C.get(e.id)??Date.now(),s=B.has(e.id),r=!n.isLapsed&&!n.isQueued,d=N.get(e.id);return l("div",{class:o?"row settled was-open":"row settled",children:[l("span",{class:r?"mark done":"mark",children:n.isQueued?"":"\\u2713"}),l("div",{class:"content",children:[l("div",{class:"settled-head",children:[l("div",{class:d?"settled-line wraps":"settled-line",children:[l("span",{class:"what",children:e.title}),l("span",{class:"outcome-label",children:[S,n.isQueued?`Queued: ${n.label}`:n.label]}),d?l("span",{class:"tone-error",children:[S,d]}):null]}),n.canUndo?l("button",{type:"button",class:"key undo",disabled:s,onClick:()=>{ps(e)},children:[l("span",{class:s?"time-left paused":"time-left",style:{animationDuration:`${R}ms`},ref:c=>{c&&!c.style.animationDelay&&(c.style.animationDelay=`-${Math.max(0,Date.now()-i)}ms`)}},i),s?null:l(nt,{name:"undo"}),s?"Undoing\\u2026":"Undo"]}):null]}),o?l(yn,{row:o,isClosing:!0}):null]})]})}function bn({entries:e,group:t,all:n,now:o}){let i=t==="finding"?"findings":"needsYou";return e.length===0?null:l("div",{class:"list",children:e.map(s=>{let r=$e(s),d=P.get(r)?.state??("row"in s?"closed":"settled");return l("div",{class:d==="leaving"?"entry leaving":"entry","data-motion":r,children:"row"in s?l(ys,{row:s.row,tone:i,state:d,now:o,onSelect:()=>fn(i,n,n.indexOf(s.row))}):l(bs,{settled:s.settled,rowState:d})},r)})})}function ws({title:e,count:t}){return l("div",{class:"group-title",children:[e,t>0?l("span",{class:"count",children:t}):null]})}function et(e,t,n){return ee(e.needsYou.closed[t==="question"?"questions":"tasks"],un(n)).map(o=>({id:o.id,ask:o.ask,outcome:o.outcome,isLapsed:_e(o),at:o.at}))}function Xt({v:e,kind:t,entries:n,all:o,now:i}){let s=t==="question"?"Questions":"Tasks",r=et(e,t,n);if(n.length===0&&r.length===0)return null;let d=n.flatMap(c=>"row"in c&&P.get(c.row.id)?.state!=="leaving"?[c.row]:[]);return l("section",{children:[l(ws,{title:s,count:d.filter(c=>!c.fold).length}),l(bn,{entries:n,group:t,all:o,now:i}),l(wn,{group:t,closed:r,now:i})]})}function wn({group:e,closed:t,now:n}){if(t.length===0)return null;let o=Y.has(e),i=o||Re.has(e);return l(L,{children:[l("button",{type:"button",class:"fold","data-fold":e,onClick:()=>As(e),children:[l(nt,{name:o?"down":"right"}),t.length," Closed"]}),i?l("div",{class:"list closed-list","data-motion":`closed-${e}`,children:t.map(s=>l("div",{class:"entry",children:l("div",{class:"row",children:[l("span",{class:"mark",children:"\\u25C7"}),l("div",{class:"content tight",children:[l("div",{class:"muted",children:s.ask}),l("div",{children:[l("span",{class:s.isLapsed?"outcome lapsed":"outcome",children:ve(s.outcome)}),l("span",{class:"muted age",children:[S,D(n-s.at)]})]})]})]})},`closed-${s.id}`))}):null]})}function _s(e){return e.heard==="heard"?null:["The inbox has not heard from this chat\\u2019s hooks.",e.heard==="none"?"Codex runs a plugin\\u2019s hooks only after you trust them.":"Items from Codex\\u2019s replies are missing."]}function ks({v:e,lists:t,now:n}){let o=t.byTab.needsYou,i=t.questions.length===0&&t.tasks.length===0,s=et(e,"question",t.questions).length>0||et(e,"task",t.tasks).length>0,r=_s(e);return i&&!s?r?l("div",{class:"empty",children:[l("div",{class:"title",children:r[0]}),l("div",{class:"muted",children:r[1]})]}):l("div",{class:"empty",children:[l("div",{class:"title",children:W("needsYou","Codex").title}),l("div",{class:"muted",children:W("needsYou","Codex").hint})]}):l("main",{children:[r?l("section",{children:l("div",{class:"group-title",children:[r[0],l("div",{class:"muted",children:r[1]})]})}):i?l("section",{children:l("div",{class:"group-title empty-line",children:W("needsYou","Codex").title})}):null,l(Xt,{v:e,kind:"question",entries:t.questions,all:o,now:n}),l(Xt,{v:e,kind:"task",entries:t.tasks,all:o,now:n})]})}function vs({v:e,lists:t,now:n}){let o=ee(e.findings.closed,un(t.findings)).map(s=>({id:s.id,ask:s.title,outcome:s.outcome,isLapsed:_e(s),at:s.closedAt})),i=t.findings.length===0;return i&&o.length===0?l("div",{class:"empty",children:[l("div",{class:"title",children:W("findings","Codex").title}),l("div",{class:"muted",children:W("findings","Codex").hint})]}):l("main",{children:l("section",{children:[i?l("div",{class:"group-title empty-line",children:"No open findings."}):null,l(bn,{entries:t.findings,group:"finding",all:t.byTab.findings,now:n}),l(wn,{group:"finding",closed:o,now:n})]})})}var xs=6e4;function Rs({v:e,now:t}){let n={needsYou:e.needsYou.count,findings:e.findings.count},{changedAt:o,isUpdating:i,error:s}=e.status,r=Date.now()-en,d=st>=2?l("span",{class:r>xs?"tone-error":void 0,children:["Last read ",D(r),S,"retrying"]}):i?"Updating\\u2026":o!==null?`Updated ${D(t-o)}`:"Not updated yet";return l("nav",{children:[l("div",{class:"tabs",children:Ye.map(c=>l("button",{type:"button",class:`tab ${v===c.id?"shown":""}`,onClick:()=>{v=c.id,k()},children:[c.label,n[c.id]>0?l("span",{class:`count tone-${c.id}`,children:n[c.id]}):null]}))}),l("div",{class:"status",children:d}),Zt?l("div",{class:"status-line tone-error",children:"This tab and the inbox server are from different builds. Quit and reopen Codex."}):null,s?l("div",{class:"status-line tone-error",children:s}):null,j&&Date.now()-j.at<R?l("div",{class:j.isError?"status-line tone-error":"status-line muted",children:j.text}):null]})}async function zt(){K=!K,x=null,C=new Map,Qe=null,ot.clear();for(let e of[...P.keys()])Ze(e);Se.clear(),U.needsYou=null,U.findings=null,E=null,k(),await at()}function Ss(){if(!x)return Te!==null?l("div",{class:"notice",children:["Could not read the inbox. ",Te," ",l("button",{type:"button",class:"key",onClick:()=>{at()},children:"Try again"})]}):l("div",{class:"notice",children:l("span",{class:"muted",children:"Loading\\u2026"})});let e=x,t=e.at,n=nn??Le(e,Ee());return l(L,{children:[K?l("div",{class:"demo-note",children:[l("span",{children:"Showing sample entries. Presses here send nothing."}),l("button",{type:"button",class:"key",onClick:()=>{zt()},children:"Hide demo"})]}):null,l(Rs,{v:e,now:t}),v==="needsYou"?l(ks,{v:e,lists:n,now:t}):l(vs,{v:e,lists:n,now:t}),l("footer",{children:K?null:l("button",{type:"button",class:"demo-toggle",onClick:()=>{zt()},children:"Show demo"})})]})}var Jt={duration:F.entering,easing:"cubic-bezier(.19, 1, .22, 1)"},_n=F.opening,kn={duration:_n,easing:"cubic-bezier(.65, 0, .35, 1)"},vn={duration:F.leaving,easing:"cubic-bezier(.8, 0, .4, 1)",fill:"forwards"},Ae=matchMedia("(prefers-reduced-motion: reduce)");function $s(){let e=new Map;for(let t of document.querySelectorAll("[data-motion]"))e.set(t.dataset.motion,{el:t,height:t.getBoundingClientRect().height});return e}function Ts(e,t,n,o){e.style.overflow="hidden",e.dataset.to=String(o);let i=e.animate(t,n),s=()=>{e.getAnimations().length>0||(e.style.overflow="",delete e.dataset.to)};i.onfinish=s,i.oncancel=s}function tt(e){return[...e.children].reduce((t,n)=>t+n.getBoundingClientRect().height,0)}function se(e,t,n,o){let i=s=>({height:`${s.height}px`,opacity:s.opacity});Ts(e,[i(t),i(n)],o,n.height)}function Ls(e){if(Ae.matches){G.clear();return}for(let t of document.querySelectorAll("[data-motion]")){let n=t.dataset.motion,o=e.get(n);if(t.dataset.closing)continue;let i=P.get(n),s=!o||o.el!==t,r=()=>t.getAnimations().length>0||s?t.getBoundingClientRect().height:o.height;if(i&&i.since===tn){if(i.state==="entering"){se(t,{height:0,opacity:0},{height:tt(t),opacity:1},Jt);continue}if(i.state==="closing"||i.state==="settling"){Es(t,r());continue}if(i.state==="leaving"){let g=r(),a=Number(getComputedStyle(t).opacity);for(let p of t.getAnimations())p.cancel();se(t,{height:g,opacity:a},{height:0,opacity:0},vn);continue}if(!ne(i.state)){for(let g of t.getAnimations())g.cancel();t.style.overflow="",delete t.dataset.to;continue}}if(i&&(i.state==="closing"||i.state==="settling"||i.state==="leaving"))continue;let d=i?tt(t):t.scrollHeight;if(s){!i&&G.delete(n)&&se(t,{height:0,opacity:0},{height:d,opacity:1},Jt);continue}let c=t.getAnimations();if(c.length>0&&Math.abs(Number(t.dataset.to)-d)<1)continue;let u=r(),f=c.length>0?Number(getComputedStyle(t).opacity):1;for(let g of c)g.cancel();Math.abs(u-d)<1&&f>.99||se(t,{height:u,opacity:f},{height:d,opacity:1},kn)}G.clear()}function Es(e,t){let n=e.querySelector(".panel.closing"),o=e.querySelector(".row.closing");o?.classList.remove("closing"),n&&(n.style.display="none");let i=tt(e);n&&(n.style.display=""),o?.classList.add("closing");for(let s of e.getAnimations())s.cancel();e.style.overflow="hidden",e.dataset.to=String(i),e.animate([{height:`${t}px`},{height:`${i}px`}],{...kn,fill:"forwards"}).onfinish=()=>k()}function As(e){let t=document.querySelector(`[data-motion="closed-${e}"]`);if(!Y.has(e)){Y.add(e),Re.delete(e)&&t?delete t.dataset.closing:G.add(`closed-${e}`),k();return}if(Y.delete(e),!t||Ae.matches){k();return}Re.add(e),k(),t.dataset.closing="1";let n=t.getBoundingClientRect().height;for(let o of t.getAnimations())o.cancel();se(t,{height:n,opacity:1},{height:0,opacity:0},vn),setTimeout(()=>{Y.has(e)||!Re.delete(e)||k()},te)}function Cs(){document.querySelector(".row.selected")?.scrollIntoView({block:"nearest"}),Ae.matches||setTimeout(()=>document.querySelector(".row.selected")?.scrollIntoView({block:"nearest"}),_n+20)}var oe=document.getElementById("app");document.documentElement.style.setProperty("--row-pad",`${8}px`);function V(e){setTimeout(k,e+50)}function k(){oe.className&&(oe.className="",oe.textContent="");let e=$s();nn=x?us(x):null,St(l(Ss,{}),oe),Ls(e),Ge&&E&&(Ge=!1,document.getElementById(`type-${E}`)?.focus())}var ie=null;document.addEventListener("pointerdown",e=>{!(e.target instanceof Element)||!e.target.closest(".list, .fold")||(ie={x:e.clientX,y:e.clientY},document.body.classList.add("still"))});document.addEventListener("pointermove",e=>{!ie||Math.hypot(e.clientX-ie.x,e.clientY-ie.y)<3||(ie=null,document.body.classList.remove("still"))});document.addEventListener("keydown",e=>{if(e.metaKey||e.ctrlKey||e.altKey||!x)return;let t=e.target;if(t?.closest("input, textarea")){e.key==="Escape"&&t.tagName==="INPUT"&&(E=null,k());return}let n=Ye.find(f=>f.hotkey===e.key);if(n){v=n.id,k();return}let o=Le(x,Ee()).byTab[v],i=pn(o,v,x),s=e.key==="j"||e.key==="ArrowDown"?1:e.key==="k"||e.key==="ArrowUp"?-1:0;if(s!==0){e.preventDefault(),fn(v,o,Math.max(0,Math.min(o.length-1,i+s))),Cs();return}let r=o[i];if(!r)return;let{keys:d,more:c}=mn(r),u=[...d,...c].find(f=>f.hotkey===e.key);u&&(e.preventDefault(),u.run())});on("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"inbox",version:"0.1.0"},appCapabilities:{tools:{}}}).then(e=>{rn(e?.hostContext??{}),parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*"),dn()}).catch(()=>{oe.textContent="The inbox could not connect to Codex."});})();\n\n    </script>\n  </body>\n</html>\n';

// src/run.ts
import { execFile } from "node:child_process";
var run = (args, { cwd, stdin, timeoutMs }) => new Promise((resolve) => {
  const [file = "", ...rest] = args;
  const child = execFile(
    file,
    rest,
    { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
    (err, stdout, stderr) => {
      const code = err ? typeof err.code === "number" ? err.code : -1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    }
  );
  if (stdin !== void 0) child.stdin?.end(stdin);
  else child.stdin?.end();
});

// src/server-main.ts
async function appCli() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const r = await run(["ps", "-o", "comm=", "-p", String(process.ppid)], { cwd: "/", timeoutMs: 5e3 });
  const path = r.stdout.trim();
  return r.code === 0 && /(^|\/)codex$/.test(path) ? path : "codex";
}
function devPageIn(dir2) {
  let cached = null;
  return async () => {
    try {
      const { tab } = JSON.parse(await readFile2(join2(dir2, "dev.json"), "utf8"));
      const { mtimeMs } = await stat3(tab);
      if (cached?.path !== tab || cached.mtimeMs !== mtimeMs)
        cached = { path: tab, mtimeMs, html: await readFile2(tab, "utf8") };
      return cached.html;
    } catch {
      return null;
    }
  };
}
var dir = dataDir(process.env, dirname2(dirname2(fileURLToPath(import.meta.url))));
var handle = makeServer({
  dir,
  now: Date.now,
  exec: run,
  tabHtml: tab_default,
  fallbackCli: appCli,
  devPage: devPageIn(dir),
  build: "1a4481eabe60"
});
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  void handle(message).then((reply) => {
    if (reply) process.stdout.write(`${JSON.stringify(reply)}
`);
  });
});
