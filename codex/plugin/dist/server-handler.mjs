// Built by codex/build.mjs from codex/src and hooks/. Do not edit.

// src/server-handler.ts
import { readFile as readFile2, stat as stat3 } from "node:fs/promises";

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
  const label = (text2) => text2.match(/^\s*\(?([a-z]|\d{1,2})\s*[:.)]/i)?.[1]?.toLowerCase();
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
var FILLER = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "with",
  "use",
  "into",
  "from",
  "that",
  "this",
  "your",
  "you",
  "should",
  "make",
  "add",
  "all"
]);
function keyWords(text2) {
  return new Set(words(text2).filter((w) => new RegExp("\\p{N}", "u").test(w) || w.length > 2 && !FILLER.has(w)));
}
function restates(a, b) {
  const x = keyWords(a);
  const y = keyWords(b);
  const fewer = Math.min(x.size, y.size);
  const shared = [...x].filter((w) => y.has(w)).length;
  const numbers = (words2) => [...words2].filter((w) => new RegExp("\\p{N}", "u").test(w)).sort().join(" ");
  if (numbers(x) !== "" && numbers(y) !== "" && numbers(x) !== numbers(y)) return false;
  return fewer >= 2 ? shared / fewer >= 0.7 : sameAsk(a, b);
}
function sameAsk(a, b) {
  const norm = (s) => words(s).join(" ");
  return norm(a) !== "" && norm(a) === norm(b);
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
  const same = ledger.findings.find((f) => sameAsk(f.title, finding.title)) ?? ledger.items.find((i) => restates(i.ask, finding.title));
  if (same) return { ledger, id: same.id, isAdded: false, expired: null };
  const id = `f${ledger.nextId}`;
  const expired = ledger.findings.length >= MAX_FINDINGS ? ledger.findings[0] : null;
  const room = expired ? closeFinding(ledger, expired.id, { how: "expired", outcome: "list full" }, finding.at) : ledger;
  return {
    ledger: { ...room, findings: [...room.findings, { ...finding, id }], nextId: ledger.nextId + 1 },
    id,
    isAdded: true,
    expired
  };
}
function closedState(d) {
  if (d.how === "dismissed") return "dismissed";
  if (d.how === "expired") return "lapsed";
  const isOvertaken = /^(?:closed by \w+: )?(?:no longer applies|replaced|superseded|moot)/i.test(d.outcome);
  return (d.how === "claude" || d.how === "update") && isOvertaken ? "lapsed" : "handled";
}
function isLapsed(d) {
  return closedState(d) !== "handled";
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
function isUndoable(c) {
  return (c.how === "done" || c.how === "dismissed") && !c.isSentToAgent;
}
function doneWake(ledger, ctx) {
  if (ctx.isTurnRunning) return null;
  const waited = ledger.closed.filter(
    (c) => c.how === "done" && c.outcome === "done" && !c.isSentToAgent && c.item?.turn === ledger.turn
  );
  if (waited.length === 0 || waited.some((c) => ctx.now - c.at < ctx.windowMs)) return null;
  return { text: messages.done(waited.map((c) => c.ask)), ids: waited.map((c) => c.id) };
}
function markSentToAgent(ledger, ids) {
  return { ...ledger, closed: ledger.closed.map((c) => ids.includes(c.id) ? { ...c, isSentToAgent: true } : c) };
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
function withQueuedDelivery(lastActions, rows, at, matches, delivery) {
  const changed = rows.flatMap((id) => {
    const a = lastActions[id];
    return a?.at === at && a.delivery?.state === "queued" && matches(a.delivery.message) ? [[id, { ...a, delivery }]] : [];
  });
  return changed.length === 0 ? lastActions : { ...lastActions, ...Object.fromEntries(changed) };
}
function withFailure(lastActions, rows, at, reason) {
  return withQueuedDelivery(lastActions, rows, at, () => true, { state: "failed", reason });
}
function reopenOnFailure(ledger, id, at) {
  if (ledger.items.some((i) => i.id === id)) return ledger;
  const closed = ledger.closed.findLast((c) => c.id === id);
  return closed?.item && closed.how === "answered" && closed.at === at ? reopenItem(ledger, id) : ledger;
}
function demoRecord(lasts, effects) {
  return {
    lasts: Object.fromEntries(
      Object.entries(lasts).flatMap(([id, { delivery: _unsent, ...l }]) => l.result === void 0 ? [[id, l]] : [])
    ),
    isSample: effects.length > 0
  };
}
async function runLocalEffects(host, effects, rowId, pending) {
  const errors = [];
  for (const e of effects) if (e.kind !== "send") errors.push(await host.perform(e));
  if (pending?.state !== "pending") return null;
  const result = finishedResult(pending, errors, await host.now());
  await host.saveLasts((a) => withResult(a, rowId, pending.at, result));
  return result;
}
async function runSends(host, effects, rowId, rows, at) {
  for (const e of effects) {
    if (e.kind !== "send") continue;
    const reason = await host.send(e);
    if (reason === null) continue;
    const last = (await host.saveLasts((a) => withFailure(a, rows, at, reason)))[rowId];
    const isRowFailed = last?.at === at && last.delivery?.state === "failed";
    if (isRowFailed && last.kind === "mark") await host.saveLedger((l) => reopenOnFailure(l, rowId, at));
    return { reason, isRowFailed };
  }
  return null;
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
    if (closed?.item && isUndoable(closed)) return { ...unchanged, ledger: reopenItem(ledger, p.id) };
    const closedFinding = ledger.closedFindings.findLast((f) => f.id === p.id);
    if (closedFinding && isUndoable(closedFinding)) return { ...unchanged, ledger: reopenFinding(ledger, p.id) };
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
      const text2 = item.kind === "question" ? messages.answer(item, words2) : messages.taskReply(item, words2);
      return { ledger, last: record("handoff"), effects: [{ kind: "send", text: text2, by: null }] };
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
    const what = item.kind === "task" ? "this task you left for me is about: why it came up, and what each choice would mean" : "this question you asked me is about: why it came up, what each choice would mean, and which you would pick";
    const options = item.options.length > 0 ? `
Options: ${item.options.join(" / ")}` : "";
    return `Remind me what ${what}. Don't act on it yet.
"${item.ask}"${options}`;
  },
  run: (item, command) => `For "${item.ask}", run this:
\`\`\`
${command}
\`\`\``,
  taskReply: (item, words2) => `Re the task you left for me, "${item.ask}": ${words2}`,
  /** Tells the agent the person did tasks it was waiting on. */
  done: (asks) => asks.length === 1 ? `Done: ${asks[0]}` : `Done:
${asks.map((a) => `- ${a}`).join("\n")}`,
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
  return `Record a finding for the user. It waits in ${host.findingsIn} until it is closed, and from there the user can ask you to address it or discuss it. Record what a careful senior engineer would flag to a teammate, and leave out style nits, anything the user already decided, and todos or ideas the user mentioned.`;
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
    result: !r.isAdded ? `Already recorded as ${r.id}.` : `Recorded as ${r.id}. The user sees it in ${host.findingsIn}.` + (r.expired ? ` The list was full, so the oldest finding, ${r.expired.id}, closed: ${r.expired.title}.` : "")
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
var FINDING_GROUPS = {
  issue: { title: "Issues", mark: "\u25B2", tone: "issue" },
  opportunity: { title: "Opportunities", mark: "\u2726", tone: "done" }
};
var SETTLED_MS = 5120;
var UPDATE_FAILED = "Last update failed. Items from that reply may be missing.";
var UPDATE_RETRIES = " It retries after your next message.";
function needsYouOrder(ledger) {
  const newestReplyFirst = (kind) => ledger.items.filter((i) => i.kind === kind).sort((a, b) => b.turn - a.turn);
  return { questions: newestReplyFirst("question"), tasks: newestReplyFirst("task") };
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
  return { is: "done", label: DONE_LABELS[last.action]?.(last.text) ?? last.text, at: last.at };
}
var DONE_LABELS = {
  address: () => "Handed off",
  discuss: () => "Discussed",
  explain: () => "Explained",
  dismiss: () => "Dismissed",
  type: () => "Replied",
  "thread-address": () => "Addressed",
  "thread-discuss": () => "Discussed",
  "thread-draft": () => "Drafted a reply",
  "pr-conflicts": () => "Asked to resolve conflicts",
  "pr-merge": () => "Asked to merge",
  // "Address all 3 threads"
  "pr-address-all": (text2) => text2.replace(/^Address\b/, "Addressed")
};
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
      // Only the label names the kind. The press and the message it sends are Address's for both.
      action({ action: "address", id }, row.finding?.kind === "opportunity" ? "Do it" : "Fix", "handoff"),
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
        canUndo: isUndoable(closed2),
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
  const kinds = Object.keys(FINDING_GROUPS);
  const byGroup = (a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
  const findingRows = [...placed.findings].reverse().sort(byGroup).map(
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
  findingsIn: "the Findings section of the Inbox tab",
  intro: "The inbox plugin shows the user what waits on them: your open questions and the tasks only they can do, and your findings, in the Inbox tab beside the conversation."
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
          detail: "A capture of the pane in **each theme** holds every cell\u2019s colors. A script could flag any text under *4.5:1* and run in `check.sh`.",
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
            {
              name: "prettier",
              bucket: "pass",
              url: `${REPO}/actions/runs/1`,
              workflow: "CI",
              startedAt: now - 16 * MIN,
              finishedAt: now - 16 * MIN + 19e3
            },
            {
              name: "plugin tests",
              bucket: "fail",
              url: `${REPO}/actions/runs/2`,
              workflow: "CI",
              startedAt: now - 16 * MIN,
              finishedAt: now - 12 * MIN - 8e3
            },
            {
              name: "lint",
              bucket: "fail",
              url: `${REPO}/actions/runs/3`,
              workflow: "CI",
              startedAt: now - 16 * MIN,
              finishedAt: now - 15 * MIN - 19e3
            },
            { name: "plugin validate", bucket: "pending", url: null, workflow: "CI", startedAt: now - 2 * MIN }
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
async function devBuild(dir) {
  try {
    const d = JSON.parse(await readFile(join(dir, "dev.json"), "utf8"));
    if (typeof d.pid !== "number") return null;
    process.kill(d.pid, 0);
    return d;
  } catch {
    return null;
  }
}
function fileName(sessionId) {
  if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error(`Not a session id: ${sessionId}`);
  return sessionId;
}
function statePath(dir, sessionId) {
  return join(dir, "sessions", `${fileName(sessionId)}.json`);
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
async function readState(dir, sessionId) {
  const saved = await readFile(statePath(dir, sessionId), "utf8").catch((err) => {
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
async function updateState(dir, sessionId, change) {
  const path = statePath(dir, sessionId);
  return withLock(`${path}.lock`, async () => {
    const current = await readState(dir, sessionId).catch(async () => {
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
    description: "The tab page the server serves now.",
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
  const { dir, now } = deps;
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
  async function wakeForDone(id) {
    const check = (s) => doneWake(s.ledger, { now: now(), windowMs: SETTLE_WINDOW_MS, isTurnRunning: s.turn.person !== null });
    if (!check(await readState(dir, id))) return;
    await updateState(dir, id, async (s) => {
      const wake = check(s);
      if (!wake) return s;
      const ledger = markSentToAgent(s.ledger, wake.ids);
      const queuedId = await queue(s, wake.text).catch(() => void 0);
      if (queuedId === void 0) return { ...s, ledger };
      const sent = {
        text: wake.text,
        press: { id: wake.ids[0] ?? "", action: "done" },
        at: now(),
        row: null,
        queuedId
      };
      return { ...s, ledger, sent: [...s.sent, sent].slice(-MAX_SENT) };
    });
  }
  const currentPage = async () => await deps.devPage?.() ?? deps.tabHtml;
  const pressOn = (s, p, at = now()) => applyPress(s.ledger, s.lastActions[p.id], p, { now: at, turnsStarted: s.presence.turnsStarted, extraSteps: [] });
  const served = async (s, id) => {
    const loadError = deps.loadError?.();
    return {
      ...viewOf(s, now()),
      thread: id,
      devPage: tabUri(await currentPage()),
      ...deps.build ? { serverBuild: deps.build } : {},
      ...loadError ? { serverLoadError: loadError } : {}
    };
  };
  async function onPress(id, p, thread) {
    let copy = null;
    let error = null;
    let note = thread === id ? null : "stale";
    const pressed2 = {};
    const hostFor = (change) => ({
      now,
      // The tab copies, and shows the text to copy by hand when its frame has no clipboard.
      perform: async (e) => {
        if (e.kind === "copy") {
          copy = { text: e.text, name: e.name };
          return null;
        }
        return open(await readState(dir, id), e.target);
      },
      send: (e) => change(async (s) => {
        const queuedId = await queue(s, e.text);
        const sent = { text: e.text, press: e.by, at: now(), row: p.id, queuedId };
        return { ...s, sent: [...s.sent, sent].slice(-MAX_SENT) };
      }).then(
        () => null,
        (err) => err instanceof Error ? err.message : String(err)
      ),
      saveLasts: async (f) => (await change((s) => ({ ...s, lastActions: f(s.lastActions) }))).lastActions,
      saveLedger: async (f) => {
        await change((s) => ({ ...s, ledger: f(s.ledger) }));
      }
    });
    await updateState(dir, id, async (s) => {
      if (note) return s;
      const at = now();
      const r = pressOn(s, p, at);
      if ("stale" in r) {
        note = "stale";
        return s;
      }
      pressed2.r = r;
      let next = {
        ...s,
        ledger: r.ledger,
        lastActions: r.last ? { ...s.lastActions, [p.id]: r.last } : s.lastActions,
        // Codex was told of the close; with the id out of `told`, a second close of the row is reported too.
        told: p.action === "undo" ? { ...s.told, closed: s.told.closed.filter((id2) => id2 !== p.id) } : s.told
      };
      const held = hostFor(async (f) => next = await f(next));
      const failed = await runSends(held, r.effects, p.id, r.last ? [p.id] : [], at);
      if (failed) error = `Not sent: ${failed.reason}`;
      return next;
    }).catch((err) => {
      error = `Not sent: ${err instanceof Error ? err.message : String(err)}`;
    });
    if (pressed2.r && p.action === "done")
      setTimeout(() => void wakeForDone(id).catch(() => void 0), SETTLE_WINDOW_MS).unref();
    if (pressed2.r)
      await runLocalEffects(
        hostFor((f) => updateState(dir, id, f)),
        pressed2.r.effects,
        p.id,
        pressed2.r.last?.result
      );
    return { view: await served(await readState(dir, id), id), copy, error, note };
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
  async function onDemoPress(id, p, thread) {
    const s = demoOf(id);
    const r = thread === id ? pressOn(s, p) : { stale: true };
    if ("stale" in r) return { view: await served(s, id), copy: null, error: null, note: "stale" };
    const { lasts, isSample } = demoRecord(r.last ? { [p.id]: r.last } : {}, r.effects);
    const next = { ...s, ledger: r.ledger, lastActions: { ...s.lastActions, ...lasts } };
    demos.set(id, next);
    return { view: await served(next, id), copy: null, error: null, note: isSample ? "sample" : null };
  }
  async function callTool(name, args, id, turn) {
    if (!id) return { ...text("Not done: this call carries no session id."), isError: true };
    const heard = (s) => turn === void 0 ? s : noteToolCall(s, turn, now());
    switch (name) {
      case "record_finding":
      case "close": {
        let result = "";
        await updateState(dir, id, (s) => {
          const r = (name === "close" ? recordClose : recordFinding)(CODEX, s.ledger, args, now());
          result = r.result;
          return heard({ ...s, ledger: r.ledger });
        });
        return text(result);
      }
      case "inbox": {
        const s = turn === void 0 ? await readState(dir, id) : await updateState(dir, id, heard);
        return text(inboxToolText(viewOf(s, now())));
      }
      case "inbox_view": {
        if (args.demo === true) return { ...text("Inbox demo"), structuredContent: await served(demoOf(id), id) };
        await wakeForDone(id).catch(() => void 0);
        const s = await updateState(dir, id, (s2) => ({ ...s2, tabSeenAt: now() }));
        return { ...text("Inbox view"), structuredContent: await served(s, id) };
      }
      case "inbox_tab_page":
        return { ...text("Tab page"), structuredContent: { html: stamped(await currentPage()) } };
      case "inbox_press": {
        const p = args.press;
        const r = await (args.demo === true ? onDemoPress(id, p, args.thread) : onPress(id, p, args.thread));
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
var tab_default = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Inbox</title>\n    <style>\n      /* The host\'s variables when Codex passes them; otherwise the pane\'s own colors. */\n      :root {\n        color-scheme: light;\n        --bg: var(--color-background-primary, #ffffff);\n        --text: var(--color-text-primary, #1f1f1f);\n        --muted: var(--color-text-secondary, #595959);\n        /* The status colors, which build.mjs writes from hooks/tones.ts. */\n        --key: #243bf5; --amber: #745417; --findings: #7b00e8; --done: #25652f; --error: #a5293d; --error-mark: #a5293d;\n        --needs-you: var(--amber);\n        --issue: var(--amber);\n        --sans: var(--font-sans, -apple-system, system-ui, sans-serif);\n        --mono: var(--font-mono, ui-monospace, \'SF Mono\', Menlo, monospace);\n        /* Surfaces are mixed from the host\'s colors, so they follow its theme. */\n        --raised: color-mix(in srgb, var(--text) 9%, var(--bg));\n        /* The open row: a neutral surface one step above the page, in the family of the hover fill. */\n        --selected: color-mix(in srgb, var(--text) 6%, var(--bg));\n        /* A closed row\'s age, dimmer than --muted and still 4.5:1 on the page. */\n        --age: color-mix(in srgb, var(--muted) 90%, var(--bg));\n        --hover: color-mix(in srgb, var(--key) 14%, transparent);\n        --soft: color-mix(in oklab, var(--text) 8%, transparent);\n        --soft-hover: color-mix(in oklab, var(--text) 10%, transparent);\n        /* A closed row under the pointer: half --soft, so a list swept by the pointer stays quiet. */\n        --row-hover: color-mix(in oklab, var(--soft) 50%, transparent);\n        /* The Codex app\'s --transition-duration-basic with ease. The tab\'s script sets --move and --enter. */\n        --quick: 150ms ease;\n        /* Where a row\'s mark sits, and where its text starts. */\n        --mark-x: 18px;\n        --text-x: 44px;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root:not([data-theme=\'light\']) {\n          color-scheme: dark;\n          --bg: var(--color-background-primary, #171717);\n          --text: var(--color-text-primary, #ececec);\n          --muted: var(--color-text-secondary, #a8a8a8);\n          --key: #b1b9f9; --amber: #ffc107; --findings: #cab0ff; --done: #7ecd8f; --error: #ffa3b0; --error-mark: #ff6b80;\n          --raised: color-mix(in srgb, var(--text) 11%, var(--bg));\n          --selected: color-mix(in srgb, var(--text) 8%, var(--bg));\n          --age: color-mix(in srgb, var(--muted) 85%, var(--bg));\n          --soft: color-mix(in oklab, var(--text) 12%, transparent);\n          --soft-hover: color-mix(in oklab, var(--text) 14%, transparent);\n        }\n      }\n      :root[data-theme=\'dark\'] {\n        color-scheme: dark;\n        --key: #b1b9f9; --amber: #ffc107; --findings: #cab0ff; --done: #7ecd8f; --error: #ffa3b0; --error-mark: #ff6b80;\n        --raised: color-mix(in srgb, var(--text) 11%, var(--bg));\n        --selected: color-mix(in srgb, var(--text) 8%, var(--bg));\n        --age: color-mix(in srgb, var(--muted) 85%, var(--bg));\n        --soft: color-mix(in oklab, var(--text) 12%, transparent);\n        --soft-hover: color-mix(in oklab, var(--text) 14%, transparent);\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        margin: 0;\n        background: var(--bg);\n        color: var(--text);\n        font: 13px/20px var(--sans);\n        -webkit-font-smoothing: antialiased;\n      }\n      button {\n        font: inherit;\n        color: inherit;\n        background: none;\n        border: none;\n        padding: 0;\n        text-align: left;\n      }\n      :focus-visible {\n        outline: 1.5px solid var(--key);\n        outline-offset: 1px;\n        border-radius: 4px;\n      }\n      .muted {\n        color: var(--muted);\n      }\n      .tone-needsYou {\n        color: var(--needs-you);\n      }\n      .tone-issue {\n        color: var(--issue);\n      }\n      .tone-findings {\n        color: var(--findings);\n      }\n      .tone-done {\n        color: var(--done);\n      }\n      .tone-error {\n        color: var(--error);\n      }\n      .notice {\n        padding: 10px 16px;\n        color: var(--error);\n        overflow-wrap: anywhere;\n      }\n      .notice .key {\n        color: var(--text);\n      }\n\n      /* Tabs: the shown one a raised panel, the others text on the background. */\n      nav {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 4px 16px;\n        padding: 12px 12px 0;\n      }\n      .tabs {\n        display: flex;\n        gap: 4px;\n      }\n      .tab {\n        padding: 6px 12px;\n        border-radius: 6px;\n        color: var(--muted);\n      }\n      .tab:hover {\n        color: var(--text);\n      }\n      .tab.shown {\n        background: var(--raised);\n        color: var(--text);\n        font-weight: 600;\n      }\n      .tab .count {\n        font-weight: 600;\n        margin-left: 6px;\n      }\n      .status {\n        margin-left: auto;\n        color: var(--muted);\n        font-size: 12px;\n      }\n      .status-line {\n        flex-basis: 100%;\n        padding: 0 4px;\n        font-size: 12px;\n        overflow-wrap: anywhere;\n      }\n\n      main {\n        display: flex;\n        flex-direction: column;\n        padding: 8px 0 4px;\n      }\n      /* Sections sit on the page. A hairline separates them, starting at the text column. */\n      section {\n        position: relative;\n        padding: 10px 0;\n      }\n      section + section::before {\n        content: \'\';\n        position: absolute;\n        top: 0;\n        left: var(--text-x);\n        right: 0;\n        height: 1px;\n        background: var(--soft);\n      }\n      .group-title {\n        padding: 0 14px 6px var(--text-x);\n      }\n      .group-title b {\n        font-weight: 600;\n      }\n      .group-title .count {\n        color: var(--muted);\n        white-space: pre;\n      }\n\n      /* Rows. */\n      /* Three columns: the mark, the text, and the age. */\n      .row {\n        display: grid;\n        grid-template-columns: calc(var(--text-x) - var(--mark-x)) minmax(0, 1fr) auto;\n        padding: var(--row-pad) 14px var(--row-pad) var(--mark-x);\n      }\n      /* An open row keeps a closed row\'s padding, so its line does not move as it opens. */\n      .row.selected {\n        background-color: var(--selected);\n      }\n      /* A row that just appeared, in its tab\'s color. */\n      .row.new {\n        box-shadow: inset 3px 0 0 var(--bar);\n      }\n      .tone-bar-needsYou {\n        --bar: var(--needs-you);\n      }\n      .tone-bar-findings {\n        --bar: var(--findings);\n      }\n      /* Marks center in a badge\'s width, so a ?, a \u2022 and a number line up. */\n      .mark {\n        align-self: start;\n        padding-right: 8px;\n        text-align: center;\n        color: var(--muted);\n      }\n      .mark.done {\n        color: var(--done);\n      }\n      .mark.issue {\n        color: var(--issue);\n      }\n      .mark.opportunity {\n        color: var(--done);\n      }\n      .mark.error {\n        color: var(--error-mark);\n      }\n      .side {\n        align-self: start;\n        margin-left: 12px;\n        color: var(--age);\n        font-variant-numeric: tabular-nums;\n        white-space: nowrap;\n      }\n      .row.collapsed:hover .side {\n        color: var(--muted);\n      }\n      .content {\n        min-width: 0;\n        display: flex;\n        flex-direction: column;\n      }\n      /* Its space above is padding, not a gap, so the row\'s height grows smoothly when the panel mounts. Its 2px below,\n         with the row\'s padding, matches the space from the row\'s top edge to its title\'s text. */\n      .panel {\n        display: flex;\n        flex-direction: column;\n        gap: 8px;\n        padding: 8px 0 2px;\n      }\n      .content > .tight,\n      .content.tight {\n        display: flex;\n        flex-direction: column;\n        gap: 0;\n      }\n      .line {\n        display: flex;\n        width: 100%;\n        min-width: 0;\n      }\n      /* A closed row\'s title wraps to two lines, then clips. */\n      .line .text {\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        display: -webkit-box;\n        -webkit-line-clamp: 2;\n        -webkit-box-orient: vertical;\n      }\n      .line .after {\n        flex: none;\n        white-space: pre;\n        color: var(--muted);\n      }\n      .row.collapsed .line .after:not(.tone-error) {\n        color: var(--age);\n      }\n      .row.collapsed:hover .line .after:not(.tone-error) {\n        color: var(--muted);\n      }\n      .line .after.tone-error {\n        color: var(--error);\n      }\n      /* Open, and while closing, the title shows in full where it stood, with the age following its last word. */\n      .row.selected .line,\n      .row.closing .line {\n        display: block;\n      }\n      .row.selected .line .text,\n      .row.closing .line .text {\n        display: inline;\n        font-weight: 600;\n      }\n      .row.selected .line .after,\n      .row.closing .line .after {\n        white-space: normal;\n        font-weight: 400;\n      }\n      .row.collapsed:hover {\n        background-color: var(--row-hover);\n      }\n      /* After a click, rows slide under a pointer that has not moved, so nothing they bring under it lights up. */\n      .still .row.collapsed:not(:active):hover {\n        background-color: transparent;\n      }\n      .still .fold:not(:active):hover {\n        color: var(--muted);\n      }\n      .title {\n        font-weight: 600;\n      }\n      .title .after {\n        font-weight: 400;\n        color: var(--muted);\n      }\n      .body {\n        overflow-wrap: anywhere;\n      }\n      .body p {\n        margin: 0;\n      }\n      .body p + p {\n        margin-top: 4px;\n      }\n      code {\n        padding: 1px 4px;\n        border-radius: 4px;\n        background: var(--soft);\n        font-family: var(--mono);\n      }\n      /*\n       * Actions are Codex\'s own pill buttons, size sm: the recommended option is solid, the row\'s other\n       * answers are a soft gray fill, and the follow-ups are plain text. Keys are an extra, so no key text shows.\n       */\n      .keys {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 6px;\n      }\n      .key {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        gap: 5px;\n        min-height: 26px;\n        padding: 3px 11px;\n        border-radius: 999px;\n        background: var(--soft);\n        font-weight: 400;\n        text-align: center;\n        white-space: nowrap;\n      }\n      .key:not(:disabled):hover {\n        background: var(--soft-hover);\n      }\n      .key:focus-visible {\n        outline-width: 2px;\n        outline-offset: 2px;\n        border-radius: 999px;\n      }\n      .key.primary {\n        background: var(--text);\n        color: var(--bg);\n      }\n      .key.primary:not(:disabled):hover {\n        background: color-mix(in srgb, var(--text) 82%, var(--bg));\n      }\n      .key .icon {\n        flex: none;\n        width: 14px;\n        height: 14px;\n      }\n      /* A follow-up is plain text: muted, the text color under the pointer, with no fill and no padding. */\n      .key.ghost {\n        padding: 0;\n        background: none;\n        color: var(--muted);\n      }\n      .key.ghost:not(:disabled):hover {\n        background: none;\n        color: var(--text);\n      }\n      .keys.follow-ups {\n        column-gap: 16px;\n      }\n      .key-groups {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 4px 16px;\n      }\n      .key-groups > .keys {\n        min-width: 0;\n      }\n      .actions {\n        display: flex;\n        flex-direction: column;\n        gap: 4px;\n      }\n      form {\n        display: flex;\n        align-items: center;\n        gap: 6px;\n      }\n      /* Codex\'s own fields: its border color, a 10px radius, and a heavier gray border on focus, not a colored ring. */\n      input {\n        flex: 1;\n        min-width: 0;\n        min-height: 28px;\n        font: inherit;\n        color: inherit;\n        background: transparent;\n        border: 1px solid color-mix(in oklab, var(--text) 15%, transparent);\n        border-radius: 10px;\n        padding: 4px 10px;\n      }\n      input::placeholder {\n        color: var(--muted);\n      }\n      /* The radius again, since :focus-visible sets 4px. */\n      input:focus,\n      textarea:focus {\n        outline: none;\n        border-color: color-mix(in oklab, var(--text) 32%, transparent);\n        border-radius: 10px;\n      }\n      textarea {\n        width: 100%;\n        font: 12px var(--mono);\n        color: inherit;\n        background: transparent;\n        border: 1px solid color-mix(in oklab, var(--text) 15%, transparent);\n        border-radius: 10px;\n      }\n\n      .empty-line {\n        color: var(--muted);\n      }\n      .fold {\n        display: block;\n        margin: 8px 0 0 calc(var(--mark-x) - 2px);\n        padding: 1px 4px;\n        border-radius: 5px;\n        color: var(--muted);\n      }\n      .fold:hover {\n        color: var(--text);\n      }\n      .fold .icon {\n        width: 12px;\n        height: 12px;\n        margin-right: 4px;\n        vertical-align: -1px;\n      }\n      /* The closed items sit under the fold\'s label. */\n      .closed-list {\n        --mark-x: 34px;\n        --text-x: 60px;\n        padding-top: 4px;\n      }\n      .closed-list .row {\n        padding-top: calc(var(--row-pad) / 2);\n        padding-bottom: calc(var(--row-pad) / 2);\n      }\n      .outcome {\n        font-weight: 600;\n      }\n      .outcome.lapsed {\n        font-weight: 400;\n        color: var(--muted);\n      }\n      .settled-head {\n        display: flex;\n        align-items: center;\n        min-width: 0;\n      }\n      /* A row that settles while open fades its fill out as its height shrinks over the panel. */\n      .row.settled.was-open {\n        transition: background-color var(--move);\n        @starting-style {\n          background-color: var(--selected);\n        }\n      }\n      .settled-line {\n        display: flex;\n        flex: 1;\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: nowrap;\n      }\n      .settled-line.wraps {\n        display: block;\n        white-space: normal;\n      }\n      .settled .what {\n        min-width: 0;\n        overflow: hidden;\n        text-overflow: ellipsis;\n      }\n      .settled .outcome-label {\n        flex: none;\n        max-width: 50%;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: pre;\n        color: var(--muted);\n      }\n      .settled-line.wraps .outcome-label {\n        white-space: normal;\n      }\n      /* Undo\'s fill is the time it has left. The pill keeps the line\'s height, so the row does not grow. */\n      .key.undo {\n        flex: none;\n        position: relative;\n        isolation: isolate;\n        overflow: hidden;\n        margin: -3px 0 -3px 12px;\n        background: color-mix(in oklab, var(--soft) 45%, transparent);\n      }\n      .time-left {\n        position: absolute;\n        inset: 0;\n        z-index: -1;\n        background: var(--soft);\n        transform-origin: left;\n        animation-name: empty;\n        animation-timing-function: linear;\n        animation-fill-mode: forwards;\n      }\n      .key.undo:not(:disabled):hover .time-left {\n        background: var(--soft-hover);\n      }\n      .time-left.paused {\n        animation-play-state: paused;\n      }\n      @keyframes empty {\n        from {\n          transform: scaleX(1);\n        }\n        to {\n          transform: scaleX(0);\n        }\n      }\n      /* The page is at least the pane\'s height. The footer sits at its bottom, and an empty tab\'s text fills the space above it. */\n      #app {\n        display: flex;\n        flex-direction: column;\n        min-height: 100vh;\n      }\n      .empty {\n        flex: 1;\n        display: flex;\n        flex-direction: column;\n        justify-content: center;\n        padding: 32px;\n        text-align: center;\n      }\n      .empty .title {\n        margin-bottom: 4px;\n      }\n      footer {\n        margin-top: auto;\n        display: flex;\n        flex-wrap: wrap;\n        justify-content: space-between;\n        gap: 4px 16px;\n        padding: 8px 16px 16px;\n        color: var(--muted);\n        font-size: 12px;\n      }\n      .demo-toggle {\n        padding: 0 6px;\n        border-radius: 5px;\n        color: var(--muted);\n      }\n      .demo-toggle:hover {\n        color: var(--text);\n        background: var(--hover);\n      }\n      .demo-note {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 4px 12px;\n        margin: 12px 12px 0;\n        padding: 6px 12px;\n        border-radius: 6px;\n        background: var(--raised);\n        color: var(--text);\n      }\n      /*\n       * Motion, with the Codex app\'s own timing, only for what enters or leaves. Hover, press and\n       * selection fills change at once. What a draw mounts fades in from @starting-style, and heights\n       * move in the script, around each draw. A row\'s own parts do not fade: a row that settles or is\n       * undone swaps them in place, where a fade from nothing reads as a flicker.\n       */\n      /* The new-row bar fades out. */\n      .row {\n        transition: box-shadow var(--enter);\n      }\n      /* A panel does not fade: it stays opaque, clipped by its row\'s height, so a row closing and the row\n         opening in its place move as one. */\n      .status-line,\n      .demo-note,\n      .empty,\n      main,\n      form {\n        transition: opacity var(--quick);\n        @starting-style {\n          opacity: 0;\n        }\n      }\n      @media (prefers-reduced-motion: reduce) {\n        *,\n        *::before,\n        *::after {\n          transition-duration: 0s !important;\n        }\n        /* With no motion, Undo stays full and does not count down. */\n        .time-left {\n          animation: none;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <div id="app" class="notice muted">Loading\u2026</div>\n    <script>\n      "use strict";(()=>{var he,w,xt,Dn,O,yt,vt,Rt,De,ce,J,St,Ue,Me,Fe,Mn,fe={},me=[],Fn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,we=Array.isArray;function P(e,t){for(var n in t)e[n]=t[n];return e}function He(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function Un(e,t,n){var o,i,s,r={};for(s in t)s=="key"?o=t[s]:s=="ref"?i=t[s]:r[s]=t[s];if(arguments.length>2&&(r.children=arguments.length>3?he.call(arguments,2):n),typeof e=="function"&&e.defaultProps!=null)for(s in e.defaultProps)r[s]===void 0&&(r[s]=e.defaultProps[s]);return ue(e,r,o,i,null)}function ue(e,t,n,o,i){var s={type:e,props:t,key:n,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:i??++xt,__i:-1,__u:0};return i==null&&w.vnode!=null&&w.vnode(s),s}function A(e){return e.children}function pe(e,t){this.props=e,this.context=t}function U(e,t){if(t==null)return e.__?U(e.__,e.__i+1):null;for(var n;t<e.__k.length;t++)if((n=e.__k[t])!=null&&n.__e!=null)return n.__e;return typeof e.type=="function"?U(e):null}function Hn(e){if(e.__P&&e.__d){var t=e.__v,n=t.__e,o=[],i=[],s=P({},t);s.__v=t.__v+1,w.vnode&&w.vnode(s),Ve(e.__P,s,t,e.__n,e.__P.namespaceURI,32&t.__u?[n]:null,o,n??U(t),!!(32&t.__u),i),s.__v=t.__v,s.__.__k[s.__i]=s,At(o,s,i),t.__e=t.__=null,s.__e!=n&&Tt(s)}}function Tt(e){if((e=e.__)!=null&&e.__c!=null)return e.__e=e.__c.base=null,e.__k.some(function(t){if(t!=null&&t.__e!=null)return e.__e=e.__c.base=t.__e}),Tt(e)}function bt(e){(!e.__d&&(e.__d=!0)&&O.push(e)&&!ge.__r++||yt!=w.debounceRendering)&&((yt=w.debounceRendering)||vt)(ge)}function ge(){try{for(var e,t=1;O.length;)O.length>t&&O.sort(Rt),e=O.shift(),t=O.length,Hn(e)}finally{O.length=ge.__r=0}}function $t(e,t,n,o,i,s,r,d,u,c,p){var m,l,f,g,x,y,b=o&&o.__k||me,h=t.length;for(u=Vn(n,t,b,u,h),m=0;m<h;m++)(f=n.__k[m])!=null&&(l=f.__i!=-1&&b[f.__i]||fe,f.__i=m,y=Ve(e,f,l,i,s,r,d,u,c,p),g=f.__e,f.ref&&l.ref!=f.ref&&(l.ref&&qe(l.ref,null,f),p.push(f.ref,f.__c||g,f)),x==null&&g!=null&&(x=g),4&f.__u?(u=Et(f,u,e),l.__e&&(l.__e=null)):typeof f.type=="function"&&y!==void 0?u=y:g&&(u=g.nextSibling),f.__u&=-7);return n.__e=x,u}function Vn(e,t,n,o,i){var s,r,d,u,c,p=n.length,m=p,l=0;for(e.__k=new Array(i),s=0;s<i;s++)(r=t[s])!=null&&typeof r!="boolean"&&typeof r!="function"?(typeof r=="string"||typeof r=="number"||typeof r=="bigint"||r.constructor==String?r=e.__k[s]=ue(null,r,null,null,null):we(r)?r=e.__k[s]=ue(A,{children:r},null,null,null):r.constructor===void 0&&r.__b>0?r=e.__k[s]=ue(r.type,r.props,r.key,r.ref?r.ref:null,r.__v):e.__k[s]=r,u=s+l,r.__=e,r.__b=e.__b+1,d=null,(c=r.__i=qn(r,n,u,m))!=-1&&(m--,(d=n[c])&&(d.__u|=2)),d==null||d.__v==null?(c==-1&&(i>p?l--:i<p&&l++),typeof r.type!="function"&&(r.__u|=4)):c!=u&&(c==u-1?l--:c==u+1?l++:(c>u?l--:l++,r.__u|=4))):e.__k[s]=null;if(m)for(s=0;s<p;s++)(d=n[s])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=U(d)),Ct(d,d));return o}function Et(e,t,n){var o,i;if(typeof e.type=="function"){for(o=e.__k,i=0;o&&i<o.length;i++)o[i]&&(o[i].__=e,t=Et(o[i],t,n));return t}e.__e!=t&&(t&&e.type&&!t.parentNode&&(t=U(e)),t=n.insertBefore(e.__e,t||null));do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function qn(e,t,n,o){var i,s,r,d=e.key,u=e.type,c=t[n],p=c!=null&&(2&c.__u)==0;if(c===null&&d==null||p&&d==c.key&&u==c.type)return n;if(o>(p?1:0)){for(i=n-1,s=n+1;i>=0||s<t.length;)if((c=t[r=i>=0?i--:s++])!=null&&(2&c.__u)==0&&d==c.key&&u==c.type)return r}return-1}function kt(e,t,n){t[0]=="-"?e.setProperty(t,n??""):e[t]=n==null?"":typeof n!="number"||Fn.test(t)?n:n+"px"}function de(e,t,n,o,i){var s,r;e:if(t=="style")if(typeof n=="string")e.style.cssText=n;else{if(typeof o=="string"&&(e.style.cssText=o=""),o)for(t in o)n&&t in n||kt(e.style,t,"");if(n)for(t in n)o&&n[t]==o[t]||kt(e.style,t,n[t])}else if(t[0]=="o"&&t[1]=="n")s=t!=(t=t.replace(St,"$1")),r=t.toLowerCase(),t=r in e||t=="onFocusOut"||t=="onFocusIn"?r.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+s]=n,n?o?n[J]=o[J]:(n[J]=Ue,e.addEventListener(t,s?Fe:Me,s)):e.removeEventListener(t,s?Fe:Me,s);else{if(i=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&n==1?"":n))}}function _t(e){return function(t){if(this.l){var n=this.l[t.type+e];if(t[ce]==null)t[ce]=Ue++;else if(t[ce]<n[J])return;return n(w.event?w.event(t):t)}}}function Ve(e,t,n,o,i,s,r,d,u,c){var p,m,l,f,g,x,y,b,h,E,Q,F,z,wt,le,Oe,L=t.type;if(t.constructor!==void 0)return null;128&n.__u&&(u=!!(32&n.__u),s=[d=t.__e=n.__e]),(p=w.__b)&&p(t);e:if(typeof L=="function"){m=r.length;try{if(h=t.props,E=L.prototype&&L.prototype.render,Q=(p=L.contextType)&&o[p.__c],F=p?Q?Q.props.value:p.__:o,n.__c?b=(l=t.__c=n.__c).__=l.__E:(E?t.__c=l=new L(h,F):(t.__c=l=new pe(h,F),l.constructor=L,l.render=jn),Q&&Q.sub(l),l.state||(l.state={}),l.__n=o,f=l.__d=!0,l.__h=[],l._sb=[]),E&&l.__s==null&&(l.__s=l.state),E&&L.getDerivedStateFromProps!=null&&(l.__s==l.state&&(l.__s=P({},l.__s)),P(l.__s,L.getDerivedStateFromProps(h,l.__s))),g=l.props,x=l.state,l.__v=t,f)E&&L.getDerivedStateFromProps==null&&l.componentWillMount!=null&&l.componentWillMount(),E&&l.componentDidMount!=null&&l.__h.push(l.componentDidMount);else{if(E&&L.getDerivedStateFromProps==null&&h!==g&&l.componentWillReceiveProps!=null&&l.componentWillReceiveProps(h,F),t.__v==n.__v||!l.__e&&l.shouldComponentUpdate!=null&&l.shouldComponentUpdate(h,l.__s,F)===!1){t.__v!=n.__v&&(l.props=h,l.state=l.__s,l.__d=!1),t.__e=n.__e,t.__k=n.__k,t.__k.some(function(q){q&&(q.__=t)}),me.push.apply(l.__h,l._sb),l._sb=[],l.__h.length&&r.push(l),d=U(n);break e}l.componentWillUpdate!=null&&l.componentWillUpdate(h,l.__s,F),E&&l.componentDidUpdate!=null&&l.__h.push(function(){l.componentDidUpdate(g,x,y)})}if(l.context=F,l.props=h,l.__P=e,l.__e=!1,z=w.__r,wt=0,E)l.state=l.__s,l.__d=!1,z&&z(t),p=l.render(l.props,l.state,l.context),me.push.apply(l.__h,l._sb),l._sb=[];else do l.__d=!1,z&&z(t),p=l.render(l.props,l.state,l.context),l.state=l.__s;while(l.__d&&++wt<25);l.state=l.__s,l.getChildContext!=null&&(o=P(P({},o),l.getChildContext())),E&&!f&&l.getSnapshotBeforeUpdate!=null&&(y=l.getSnapshotBeforeUpdate(g,x)),le=p!=null&&p.type===A&&p.key==null?Pt(p.props.children):p,d=$t(e,we(le)?le:[le],t,n,o,i,s,r,d,u,c),l.base=t.__e,t.__u&=-161,l.__h.length&&r.push(l),b&&(l.__E=l.__=null)}catch(q){if(r.length=m,t.__v=null,u||s!=null){if(q.then){for(t.__u|=u?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;s!=null&&(s[s.indexOf(d)]=null),t.__e=d}else if(s!=null)for(Oe=s.length;Oe--;)He(s[Oe])}else t.__e=n.__e;t.__k==null&&(t.__k=n.__k||[]),q.then||Lt(t),w.__e(q,t,n)}}else s==null&&t.__v==n.__v?(t.__k=n.__k,t.__e=n.__e):d=t.__e=Wn(n.__e,t,n,o,i,s,r,u,c);return(p=w.diffed)&&p(t),128&t.__u?void 0:d}function Lt(e){e&&(e.__c&&(e.__c.__e=!0),e.__k&&e.__k.some(Lt))}function At(e,t,n){for(var o=0;o<n.length;o++)qe(n[o],n[++o],n[++o]);w.__c&&w.__c(t,e),e.some(function(i){try{e=i.__h,i.__h=[],e.some(function(s){s.call(i)})}catch(s){w.__e(s,i.__v)}})}function Pt(e){return typeof e!="object"||e==null||e.__b>0?e:we(e)?e.map(Pt):e.constructor!==void 0?null:P({},e)}function Wn(e,t,n,o,i,s,r,d,u){var c,p,m,l,f,g,x,y=n.props||fe,b=t.props,h=t.type;if(h=="svg"?i="http://www.w3.org/2000/svg":h=="math"?i="http://www.w3.org/1998/Math/MathML":i||(i="http://www.w3.org/1999/xhtml"),s!=null){for(c=0;c<s.length;c++)if((f=s[c])&&"setAttribute"in f==!!h&&(h?f.localName==h:f.nodeType==3)){e=f,s[c]=null;break}}if(e==null){if(h==null)return document.createTextNode(b);e=document.createElementNS(i,h,b.is&&b),d&&(w.__m&&w.__m(t,s),d=!1),s=null}if(h==null)y===b||d&&e.data==b||(e.data=b);else{if(s=h=="textarea"&&b.defaultValue!=null?null:s&&he.call(e.childNodes),!d&&s!=null)for(y={},c=0;c<e.attributes.length;c++)y[(f=e.attributes[c]).name]=f.value;for(c in y)f=y[c],c=="dangerouslySetInnerHTML"?m=f:c=="children"||c in b||c=="value"&&"defaultValue"in b||c=="checked"&&"defaultChecked"in b||de(e,c,null,f,i);for(c in b)f=b[c],c=="children"?l=f:c=="dangerouslySetInnerHTML"?p=f:c=="value"?g=f:c=="checked"?x=f:d&&typeof f!="function"||y[c]===f||de(e,c,f,y[c],i);if(p)d||m&&(p.__html==m.__html||p.__html==e.innerHTML)||(e.innerHTML=p.__html),t.__k=[];else if(m&&(e.innerHTML=""),$t(t.type=="template"?e.content:e,we(l)?l:[l],t,n,o,h=="foreignObject"?"http://www.w3.org/1999/xhtml":i,s,r,s?s[0]:n.__k&&U(n,0),d,u),s!=null)for(c=s.length;c--;)He(s[c]);d&&h!="textarea"||(c="value",h=="progress"&&g==null?e.removeAttribute("value"):g!=null&&(g!==e[c]||h=="progress"&&!g||h=="option"&&g!=y[c])&&de(e,c,g,y[c],i),c="checked",x!=null&&x!=e[c]&&de(e,c,x,y[c],i))}return e}function qe(e,t,n){try{if(typeof e=="function"){var o=typeof e.__u=="function";o&&e.__u(),o&&t==null||(e.__u=e(t))}else e.current=t}catch(i){w.__e(i,n)}}function Ct(e,t,n){var o,i;if(w.unmount&&w.unmount(e),(o=e.ref)&&(o.current&&o.current!=e.__e||qe(o,null,t)),(o=e.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(s){w.__e(s,t)}o.base=o.__P=o.__n=null}if(o=e.__k)for(i=0;i<o.length;i++)o[i]&&Ct(o[i],t,n||typeof e.type!="function");n||He(e.__e),e.__c=e.__=e.__e=void 0}function jn(e,t,n){return this.constructor(e,n)}function It(e,t,n){var o,i,s,r;t==document&&(t=document.documentElement),w.__&&w.__(e,t),i=(o=typeof n=="function")?null:n&&n.__k||t.__k,s=[],r=[],Ve(t,e=(!o&&n||t).__k=Un(A,null,[e]),i||fe,fe,t.namespaceURI,!o&&n?[n]:i?null:t.firstChild?he.call(t.childNodes):null,s,!o&&n?n:i?i.__e:t.firstChild,o,r),At(s,e,r),e.props.children=null}he=me.slice,w={__e:function(e,t,n,o){for(var i,s,r;t=t.__;)if((i=t.__c)&&!i.__)try{if((s=i.constructor)&&s.getDerivedStateFromError!=null&&(i.setState(s.getDerivedStateFromError(e)),r=i.__d),i.componentDidCatch!=null&&(i.componentDidCatch(e,o||{}),r=i.__d),r)return i.__E=i}catch(d){e=d}throw e}},xt=0,Dn=function(e){return e!=null&&e.constructor===void 0},pe.prototype.setState=function(e,t){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=P({},this.state),typeof e=="function"&&(e=e(P({},n),this.props)),e&&P(n,e),e!=null&&this.__v&&(t&&this._sb.push(t),bt(this))},pe.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),bt(this))},pe.prototype.render=A,O=[],vt=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Rt=function(e,t){return e.__v.__b-t.__v.__b},ge.__r=0,De=Math.random().toString(8),ce="__d"+De,J="__a"+De,St=/(PointerCapture)$|Capture$/i,Ue=0,Me=_t(!1),Fe=_t(!0),Mn=0;function ye(e){if(e.how==="dismissed")return"dismissed";if(e.how==="expired")return"lapsed";let t=/^(?:closed by \\w+: )?(?:no longer applies|replaced|superseded|moot)/i.test(e.outcome);return(e.how==="claude"||e.how==="update")&&t?"lapsed":"handled"}function be(e){return ye(e)!=="handled"}function W(e){let t=Math.round(e/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let n=Math.round(t/60);return n<48?`${n}h ago`:`${Math.round(n/24)}d ago`}function ke(e,t){return e.length>t?`${e.slice(0,t-1)}\\u2026`:e}function We(e){return e.replace(/\\/+$/,"").split("/").pop()??e}function je(e){return e.action==="step"?`step-${e.step}`:e.action}function _e(e){return e.charAt(0).toUpperCase()+e.slice(1)}function Nt(e){if(!e)return;if(e.step.some(n=>n.kind==="run"))return"run";let t=e.step[0]?.kind;return t==="copy"||t==="terminal"?"copy":t==="open"||t==="link"?"open":void 0}var Gn="This changed before your press. Nothing was sent.";function Z(e){return e==="sample"?"Sample entry: nothing was sent.":Gn}function Bn(e,t){switch(t.kind){case"run":return{kind:"send",text:Qn.run(e,t.command),by:{id:e.id,action:"run"}};case"open":return{kind:"open",target:t.path,name:We(t.path)};case"link":return{kind:"open",target:t.url,name:t.name??t.url};case"copy":return{kind:"copy",text:t.text,name:t.name??"snippet",isCommand:!1};case"terminal":return{kind:"copy",text:t.command,name:t.name??ke(t.command,32),isCommand:!0}}}function Ot(e,t){return t.step.map(n=>Bn(e,n))}function Dt(e,t){return{state:"pending",parts:e.flatMap(n=>n.kind==="send"?[]:[{kind:n.kind,name:n.name,isCommand:n.kind==="copy"&&n.isCommand,error:null}]),at:t}}function Xn(e){return[`${e.kind==="issue"?"Issue":"Opportunity"}: ${e.title}`,e.detail,...e.path?[`File: ${e.path}`]:[]]}var Qn={answer:(e,t)=>`Re "${e.ask}": ${t}`,explain:e=>{let t=e.kind==="task"?"this task you left for me is about: why it came up, and what each choice would mean":"this question you asked me is about: why it came up, what each choice would mean, and which you would pick",n=e.options.length>0?`\nOptions: ${e.options.join(" / ")}`:"";return`Remind me what ${t}. Don\'t act on it yet.\n"${e.ask}"${n}`},run:(e,t)=>`For "${e.ask}", run this:\n\\`\\`\\`\n${t}\n\\`\\`\\``,taskReply:(e,t)=>`Re the task you left for me, "${e.ask}": ${t}`,done:e=>e.length===1?`Done: ${e[0]}`:`Done:\n${e.map(t=>`- ${t}`).join(`\n`)}`,finding:(e,t,n="")=>[t==="address"?"Please address this finding you recorded:":t==="discuss"?"Let\'s talk through this finding you recorded before changing anything:":"About this finding you recorded:",...Xn(e),...t==="typed"?["",n]:[]].join(`\n`)};var Mt=[..."abcfghilm"],C="\\u2002\\xB7\\u2002",xe={issue:{title:"Issues",mark:"\\u25B2",tone:"issue"},opportunity:{title:"Opportunities",mark:"\\u2726",tone:"done"}},Ft={handled:"\\u2713",dismissed:"\\u2715",lapsed:"\\u2013"},zn=3,R=5120,Ge=1500,Be=400;function Ut(e,t){return e>0&&t-e<Be}function ee(e){return[...e.needsYou.questions,...e.needsYou.tasks,...e.findings.rows]}function Ht(e){return e.filter(t=>t.state.is==="settled").map(t=>t.id)}function te(e,t){return e.filter(n=>!t.has(n.id)).slice(0,zn)}function ve(e){let t=W(e);return t==="just now"?"now":t.replace(/ ago$/,"")}function Vt(e){return e?.is==="notSent"||e?.is==="local"&&e.result.state==="failed"}function qt(e){return e.is==="done"||e.is==="queued"}var Jn=e=>e==="terminal"?"Run it in a terminal, or type ! and paste.":"Run it in Terminal.",Ke={open:{pending:"Opening",done:"Opened",failed:"open"},copy:{pending:"Copying",done:"Copied",failed:"copy"}};function Zn(e,t){let o=e.parts.length>1&&e.parts.every(r=>r.kind==="open"&&r.error===null&&/^PR #\\d+$/.test(r.name))?[{...e.parts[0],name:`${e.parts.length} PRs`}]:e.parts;if(e.state==="pending")return`${o.map(r=>`${Ke[r.kind].pending} ${r.name}`).join(C)}\\u2026`;let i=o.map(r=>r.error===null?`${Ke[r.kind].done} ${r.name}`:`Could not ${Ke[r.kind].failed} ${r.name}: ${r.error}`).join(C);if(e.state==="failed")return i;let s=o.some(r=>r.kind==="copy"&&r.isCommand);return`\\u2713 ${i}${s?`. ${Jn(t)}`:""}`}function Xe(e,t){switch(e.is){case"note":return Z(e.note);case"local":return Zn(e.result,t);case"queued":return`Queued: ${e.label}`;case"notSent":return`Not sent: ${e.reason}`;case"done":return`\\u2713 ${e.label}`}}var es=[{id:"needsYou",label:"Needs you",hotkey:"1"},{id:"findings",label:"Findings",hotkey:"2"},{id:"prs",label:"PRs",hotkey:"3"}],Qe=es.filter(e=>e.id!=="prs");function j(e,t){return e==="needsYou"?{title:"Nothing needs you.",hint:`${t}\'s questions and the tasks only you can do show up here.`}:{title:"No findings yet",hint:`${t} flags issues and opportunities it spots beyond your task.`}}function Wt(e,t,n){let o=u=>u.flatMap(c=>{if(c.state.is==="settled")return t(c.id)?[{settled:c,state:c.state}]:[];let p=n(c);return p===null?[]:[{row:p}]}),i=o(e.needsYou.questions),s=o(e.needsYou.tasks),r=Object.keys(xe).flatMap(u=>{let c=o(e.findings.rows.filter(p=>p.finding?.kind===u));return c.length===0?[]:[{kind:u,title:xe[u].title,entries:c}]}),d=r.flatMap(u=>u.entries);return{questions:i,tasks:s,findings:d,findingGroups:r,byTab:{needsYou:[...Ye(i),...Ye(s)],findings:Ye(d)}}}function ne(e){return"row"in e?e.row.id:e.settled.id}function Ye(e){return e.flatMap(t=>"row"in t?[t.row]:[])}function ze(e){return new Set(e.flatMap(t=>"settled"in t?[t.settled.id]:[]))}function jt(e,t,n){let o=e.actions.filter(m=>t||!m.isFolded),i=e.actions.length-o.length,s=o.map(m=>m.press.action).lastIndexOf("answer"),r=[],d=[],u=[],c=e.feedback?.is==="notSent"?e.feedback.retry:null;if(c){let m=e.actions.find(l=>je(l.press)===je(c))?.kind??"talk";r.push({slot:"retry",press:c,kind:m})}let p=0;for(let[m,l]of o.entries()){let{press:f}=l;if(f.action==="answer"||f.action==="step"){let g=p<Mt.length?{hotkey:Mt[p++]}:{};r.push({slot:"choice",action:{...l,press:f},...g}),m===s&&i>0&&r.push({slot:"allOptions",count:e.actions.filter(x=>x.press.action==="answer").length})}else l.hotkey&&(f.action==="explain"&&n?u:l.isFollowUp?d:r).push({slot:"action",action:l,hotkey:l.hotkey})}return{keys:r,more:d,hidden:u}}function Kt(e,t){let n={...e},o={};for(let i of Object.keys(t)){let s=t[i],r=e[i];o[i]=s&&r?s.filter(d=>!r.has(d)):[],s&&(n[i]=new Set(s))}return{seen:n,added:o}}function Yt(e,t,n,o){return n?e.find(i=>i!==t&&o[i].length>0)??null:null}var ts=/`([^`\\n]+)`|\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*(?!\\*)|~~(?=\\S)(.+?)(?<=\\S)~~|(?<![\\w*])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?![\\w*])|(?<!\\w)_(?=\\S)([^_\\n]+?)(?<=\\S)_(?!\\w)|\\[([^\\]\\n]+)\\]\\((https:\\/\\/[^\\s)]+)\\)/g;function Re(e,t={}){let n=[],o=0;for(let i of e.matchAll(ts)){i.index>o&&n.push({...t,text:e.slice(o,i.index)});let[,s,r,d,u,c,p,m]=i;s!==void 0?n.push({...t,text:s,code:!0}):r!==void 0?n.push(...Re(r,{...t,bold:!0})):d!==void 0?n.push(...Re(d,{...t,strike:!0})):u!==void 0||c!==void 0?n.push({...t,text:u??c??"",italic:!0}):n.push({...t,text:p??"",link:m}),o=i.index+i[0].length}return o<e.length&&n.push({...t,text:e.slice(o)}),n}var Se={question:"needsYou",task:"needsYou",finding:"findings"},Je=["needsYou","findings"];function ns(e){return{needsYou:[...e.needsYou.questions,...e.needsYou.tasks].map(t=>t.id),findings:e.findings.rows.map(t=>t.id)}}function Gt(e,t){return Kt(e,ns(t))}function Bt(e,t,n,o){let i=r=>r.some(d=>d.state.is!=="settled"||n.has(d.id)),s=(r,d)=>o.has(r)&&te(d,n).length>0;return t==="findings"?!i(e.findings.rows)&&!s("finding",e.findings.closed):e.heard==="heard"&&!i(e.needsYou.questions)&&!i(e.needsYou.tasks)&&!s("question",e.needsYou.closed.questions)&&!s("task",e.needsYou.closed.tasks)}var Te={entering:300,opening:200,closing:200,settling:200,leaving:200,closed:0,open:0,settled:0,undoing:0};function Ze(e){return Te[e]>0}function Qt(e,t,n,o=!1,i=!1){let s=t==="undoing"?"settled":t;if(!e)return o&&!i&&(s==="closed"||s==="open")?{state:"entering",since:n,hasPanel:s==="open"}:Xt(void 0,s,t,n);let r=ss(e)===s?e:os(e,s,n);return Ze(r.state)&&!i&&n-r.since<Te[r.state]?r:Xt(r,s,t,n)}function ss({state:e,hasPanel:t}){switch(e){case"entering":return t?"open":"closed";case"opening":case"open":return"open";case"closing":case"closed":return"closed";case"settling":case"settled":case"undoing":return"settled";case"leaving":return"gone"}}function os(e,t,n){switch(t){case"open":return{state:"opening",since:n,hasPanel:!0};case"closed":return e.state==="leaving"?{state:"entering",since:n,hasPanel:!1}:{state:"closing",since:n,hasPanel:e.hasPanel};case"settled":return{state:"settling",since:n,hasPanel:e.hasPanel};case"gone":return{state:"leaving",since:n,hasPanel:e.hasPanel}}}function Xt(e,t,n,o){if(t==="gone")return null;let i=n==="undoing"?"undoing":t;return e?.state===i?e:{state:i,since:o,hasPanel:i==="open"}}var $e=3e3,zt=6e4,ko=R+2*$e;function Jt(e){return Ht(ee(e))}function Zt(e,t,n){return new Map(t.map(o=>[o,e.get(o)??n]))}function en(e,t,n=new Set){return new Set([...e].filter(([o,i])=>n.has(o)||t-i<R).map(([o])=>o))}var is=0;function a(e,t,n,o,i,s){t||(t={});var r,d,u=t;if("ref"in u)for(d in u={},t)d=="ref"?r=t[d]:u[d]=t[d];var c={type:e,props:u,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--is,__i:-1,__u:0,__source:i,__self:s};if(typeof e=="function"&&(r=e.defaultProps))for(d in r)u[d]===void 0&&(u[d]=r[d]);return w.vnode&&w.vnode(c),c}var as={check:"M20 6 9 17l-5-5",play:"M7 4.5v15l12-7.5z",copy:"M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",open:"M7 17 17 7M8 7h9v9",retry:"M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",undo:"M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",right:"m9 18 6-6-6-6",down:"m6 9 6 6 6-6"};function dt({name:e}){return a("svg",{class:"icon",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",children:a("path",{d:as[e]})})}function ls(e){let t=Nt(e);return t==="run"?"play":t}var v=null,M=!1,Ae=null,tt=null,ct=0,pn=0,_="needsYou",$={needsYou:null,findings:null},S=null,Pe=!1,V=new Map,Ce=new Set,D=new Set,nt=new Map,N=new Map,st=new Map,re=new Map,Y=null,I=new Map,ot={},ut=new Map,G=new Set,B=new Set,Le=new Set,T=new Map,Ie=null,fn=0,tn=0,it=!1,rt="inbox-tab-kept";function ds(){let e={version:1,isDemo:M,tab:_,selection:{needsYou:$.needsYou?.id??null,findings:$.findings?.id??null},typing:S,drafts:[...V],optionsShown:[...Ce],unfolded:[...D]};try{sessionStorage.setItem(rt,JSON.stringify(e))}catch{}}function cs(){let e=null;try{let t=sessionStorage.getItem(rt);sessionStorage.removeItem(rt),e=t?JSON.parse(t):null}catch{}if(e?.version===1){M=e.isDemo,_=e.tab;for(let t of Je){let n=e.selection[t];$[t]=n?{id:n,openedAt:0}:null}S=e.typing,Pe=S!==null;for(let[t,n]of e.drafts)V.set(t,n);for(let t of e.optionsShown)Ce.add(t);for(let t of e.unfolded)D.add(t)}}var us=0,ie=new Map;function mn(e,t,n){return new Promise((o,i)=>{let s=++us,r=n===void 0?void 0:window.setTimeout(()=>{ie.delete(s)&&i(new Error(`The inbox did not answer in ${Math.round(n/1e3)} s`))},n);ie.set(s,{resolve:o,reject:i,timer:r}),parent.postMessage({jsonrpc:"2.0",id:s,method:e,params:t},"*")})}window.addEventListener("message",e=>{let t=e.data;if(!(!t||t.jsonrpc!=="2.0")){if(t.id!=null&&!t.method&&ie.has(t.id)){let n=ie.get(t.id);ie.delete(t.id),clearTimeout(n.timer),t.error?n.reject(t.error):n.resolve(t.result);return}t.method==="ui/notifications/host-context-changed"&&gn(t.params??{}),t.id!=null&&t.method&&parent.postMessage({jsonrpc:"2.0",id:t.id,result:{}},"*")}});function gn(e){e.theme&&(document.documentElement.dataset.theme=e.theme);for(let[t,n]of Object.entries(e.styles?.variables??{}))document.documentElement.style.setProperty(t,n)}async function pt(e,t={},n){let o=await mn("tools/call",{name:e,arguments:t},n);if(!o||o.isError||o.structuredContent===void 0)throw new Error(o?.isError&&o.content?.[0]?.text||"The answer had nothing to show");return o.structuredContent}function hn(e,t){if(t<tn)return;tn=t,Ae=null,ct=0,pn=Date.now();let n=I;I=Zt(I,Jt(e),Date.now()),[...I.keys()].some(s=>!n.has(s))&&X(R),v=e;let o=Gt(ot,e);ot=o.seen;let i=[...o.added.needsYou,...o.added.findings];for(let s of i)ut.set(s,Date.now()),G.add(s);i.length>0&&X(Ge),ps(e,o.added),k()}function ps(e,t){let n=mt(),o=Yt(Je,_,Bt(e,_,n,D),t);o&&(_=o,$[o]=null)}var wn=3*$e;async function ft(){let e=++fn;try{let t=await pt("inbox_view",{demo:M},wn),n=t.devPage!==ms;n&&gs(),tt=t.serverLoadError?`The inbox server could not load its new build, so it still runs the last one. ${t.serverLoadError}`:t.serverBuild!=="b0c5bf38e8b5"&&!n?"This tab and the inbox server are from different builds. Close the Inbox tab and open it again.":null,hn(t,e)}catch(t){v?ct++:Ae=fs(t),k()}}function fs(e){let t=typeof e=="object"&&e!==null&&typeof e.message=="string"?e.message:String(e),n=ke(t.replace(/^(Failed|Not done): /,"").replace(/\\s+/g," ").trim(),120)||"No reason given";return _e(/[.!?\u2026]$/.test(n)?n:`${n}.`)}var ms=window.__inboxPage,et=!1;async function gs(){if(!et){et=!0;try{let{html:e}=await pt("inbox_tab_page",{},wn);if(!/<\\/html>\\s*$/i.test(e))throw new Error("The new page is incomplete.");let t=window.setTimeout(()=>{},0);for(let n=1;n<=t;n++)clearTimeout(n);ds(),document.open(),document.write(e),document.close()}catch{et=!1}}}async function yn(){it||await ft(),setTimeout(yn,$e)}function hs(e,t){return ee(e).some(n=>n.id===t&&n.state.is!=="settled")}function ws(e,t){return ee(e).some(n=>n.id===t&&n.feedback?.is==="notSent")}async function H(e,t,n,o="Sending\\u2026"){t.action!=="undo"&&Rn(e),nt.set(e,o),N.delete(e),st.delete(e),re.delete(e),k(),it=!0;let i=++fn;try{let s=await pt("inbox_press",{press:t,thread:v?.thread,demo:M},zt);s.copy&&await ys(e,s.copy),s.view&&hn(s.view,i),s.error&&!(v&&ws(v,e))&&N.set(e,s.error),!s.error&&s.note!=="stale"&&n?.(),s.note&&v&&hs(v,e)?(st.set(e,{text:Z(s.note),at:Date.now()}),X(R),s.note==="stale"&&t.action==="type"&&(S=e)):s.note&&(Y={text:Z(s.note),at:Date.now()},X(R))}catch{N.set(e,"Not sent: the inbox did not answer.")}finally{it=!1,nt.delete(e),k()}}async function ys(e,t){try{await navigator.clipboard.writeText(t.text)}catch{N.set(e,`Could not copy ${t.name}: this tab has no clipboard access`),re.set(e,t)}}function bs(e){Rn(e),S=e,Pe=!0,k()}function bn(e){let{id:t,item:n}=e,o=r=>{switch(r.slot){case"retry":return{label:"Try again",icon:"retry",run:()=>{H(t,r.press)}};case"allOptions":return{label:`All ${r.count} options`,run:()=>{Ce.add(t),k()}};case"choice":{let{action:d,hotkey:u}=r,c=d.press,p=u?{hotkey:u}:{};if(c.action==="answer")return{...p,label:d.label,isPrimary:d.isPrimary,run:()=>{H(t,c)}};let m=e.steps[c.step],l=d.kind==="local"&&n&&m?Xe({is:"local",result:Dt(Ot(n,m),Date.now())},"codex"):void 0,f=ls(m);return{...p,label:d.label,...f?{icon:f}:{},run:()=>{H(t,c,void 0,l)}}}case"action":{let{action:d,hotkey:u}=r,c=d.press,p=c.action==="type"?()=>bs(t):()=>{H(t,c)};return{hotkey:u,label:d.label,...c.action==="done"?{icon:"check"}:{},run:p}}}},{keys:i,more:s}=jt(e,Ce.has(t),!0);return{keys:i.map(o),more:s.map(o)}}function ks(e,t,n){let o=n.kind==="question",i=t.state.is==="handedOff",s=n.id;return{id:s,handle:i?"\\u2713":"",handleTone:i?"done":void 0,...i?{fold:{}}:{},title:n.ask,age:n.at===null?void 0:ve(e.at-n.at),...bn(t),typing:{hint:o?"Your answer":"Your reply to Codex",send:r=>{H(s,{action:"type",id:s,text:r},()=>V.delete(s))}},feedback:t.feedback}}function _s(e,t,n){let o=t.state.is==="handedOff",i=n.id;return{id:i,handle:o?"\\u2713":xe[n.kind].mark,handleTone:o?"done":void 0,kind:n.kind,...o?{fold:{}}:{},title:n.title,age:ve(e.at-n.at),body:a("div",{children:[a("p",{children:As(n.detail)}),n.path?a("p",{children:[a("span",{class:"muted",children:"Relevant file: "}),a("code",{title:n.path,children:We(n.path)})]}):null]}),...bn(t),typing:{hint:"Your reply to Codex",send:s=>{H(i,{action:"type",id:i,text:s},()=>V.delete(i))}},feedback:t.feedback}}function kn(e,t){return Wt(e,n=>t.has(n),n=>n.item?ks(e,n,n.item):n.finding?_s(e,n,n.finding):null)}function mt(){return en(I,Date.now(),B)}var Ee={question:"questions",task:"tasks",finding:"findings"};function xs(e){let t=Date.now(),n=kn(e,mt()),o=n.byTab[_],i=o[_n(o,_,e)]?.id,s=new Set,r=new Set;for(let d of Object.keys(Ee).filter(u=>Se[u]===_)){let u=n[Ee[d]],c=new Set(u.map(ne)),p=[...u];for(let[l,f]of(Ie?.[Ee[d]]??[]).entries()){let g=ne(f);!c.has(g)&&T.has(g)&&p.splice(Math.min(l,p.length),0,f)}let m=[];for(let l of p){let f=ne(l),g=T.get(f),x=c.has(f)?"settled"in l?B.has(f)?"undoing":"settled":f===i?"open":"closed":"gone",y=Qt(g?.track,x,t,G.has(f),Ne.matches);if(!y)continue;y!==g?.track&&s.add(f);let b=y.hasPanel?"row"in l&&c.has(f)?l.row:g?.openRow:void 0;T.set(f,{track:y,openRow:b}),r.add(f),m.push(l)}n[Ee[d]]=m}for(let d of[...T.keys()])r.has(d)||T.delete(d);return{lists:n,changed:s}}async function vs(e){if(B.has(e.id))return;let t=Se[e.type];B.add(e.id);try{await H(e.id,{action:"undo",id:e.id},()=>xn(t,e.id))}finally{B.delete(e.id);let n=I.get(e.id),o=n!==void 0&&Date.now()-n<R,i=N.get(e.id);i&&!o&&(Y={text:i,at:Date.now(),isError:!0},X(R)),n!==void 0&&!o&&I.set(e.id,Date.now()-R),k()}}function _n(e,t,n){let o=$[t],i=o?o.id:(t==="needsYou"?n.needsYou.topId:null)??e[0]?.id;return i?e.findIndex(s=>s.id===i):-1}function xn(e,t){$[e]={id:t,openedAt:Date.now()},X(Be)}function vn(e,t,n){let o=t[n];o&&(xn(e,o.id),k())}function Rn(e){$[_]||($[_]={id:e,openedAt:0})}function nn(){return Ut($[_]?.openedAt??0,Date.now())}function Sn(e){return e.typing&&S===e.id?{keys:[],more:[]}:{keys:e.keys,more:e.more}}function sn({k:e,isGhost:t=!1}){return a("button",{type:"button",class:e.isPrimary?"key primary":t?"key ghost":"key",disabled:nn(),onClick:()=>{nn()||e.run()},children:[e.icon?a(dt,{name:e.icon}):null,e.label]})}function Rs({row:e}){let t=e.typing;return a("form",{onSubmit:o=>{o.preventDefault();let i=(V.get(e.id)??"").trim();i&&(S=null,t.send(i))},children:[a("input",{id:`type-${e.id}`,value:V.get(e.id)??"",placeholder:t.hint,"aria-label":t.hint,onInput:o=>V.set(e.id,o.currentTarget.value)}),a("button",{type:"submit",class:"key primary",children:"Send"}),a("button",{type:"button",class:"key ghost",onClick:()=>{S=null,k()},children:"Cancel"})]})}function on(e){let t=e.feedback;return t?t.is==="done"&&e.handleTone==="done"?t.label:Xe(t,"codex"):null}function Ss(e,t){let n=e.feedback;return n?qt(n)?`${on(e)}${C}${W(t-n.at)}`:on(e):null}function Tn(e){let t=st.get(e);return t&&Date.now()-t.at<R?t.text:null}function Ts(e){return!N.has(e.id)&&Tn(e.id)===null&&!re.has(e.id)}function $s(e){let t=ut.get(e);return t!==void 0&&Date.now()-t<Ge}function Es({row:e,tone:t,track:n,onSelect:o,now:i}){let s=n.hasPanel&&(n.state==="closing"||n.state==="leaving"),r=n.hasPanel&&!s,d=$s(e.id)?` new tone-bar-${t}`:"",u=a("span",{class:`mark ${e.handleTone??e.kind??""}`,children:e.handle}),c=nt.get(e.id),p=c??(Ts(e)?Ss(e,i):null),m=!c&&Vt(e.feedback)?"error":void 0;return a("div",{class:`row ${r?"selected":"collapsed"}${s?" closing":""}${d}`,onClick:r?void 0:o,children:[u,a("div",{class:"content",children:[a("button",{type:"button",class:"line",...r?{tabIndex:-1,"aria-disabled":!0}:{"aria-expanded":!1},children:[a("span",{class:"text",children:e.title}),p?a("span",{class:`after ${m?`tone-${m}`:""}`,children:`${C}${p}`}):null]}),r||s?a($n,{row:e,isClosing:s}):null]}),a("span",{class:"side",children:p?null:e.age})]})}function $n({row:e,isClosing:t}){let{keys:n,more:o}=Sn(e),i=re.get(e.id),s=Tn(e.id),r=!!e.typing&&S===e.id,d=[e.fold?.note?a("div",{class:"muted",children:e.fold.note}):null,s?a("div",{class:"muted",children:s}):null,N.has(e.id)?a("div",{class:"tone-error",children:N.get(e.id)}):null].filter(Boolean);return a("div",{class:t?"panel closing":"panel",inert:t,children:[e.body?a("div",{class:"body",children:e.body}):null,d.length>0?a("div",{class:"tight",children:d}):null,a("div",{class:"actions",children:[n.length>0||o.length>0?a("div",{class:"key-groups",children:[n.length>0?a("div",{class:"keys",children:n.map(u=>a(sn,{k:u}))}):null,o.length>0?a("div",{class:"keys follow-ups",children:o.map(u=>a(sn,{k:u,isGhost:!0}))}):null]}):null,r?a(Rs,{row:e}):null]}),i?a("div",{children:[a("div",{class:"muted",children:["Copy ",i.name," from here:"]}),a("textarea",{rows:3,readOnly:!0,value:i.text,onFocus:u=>u.currentTarget.select()}),a("button",{type:"button",class:"key",onClick:()=>{re.delete(e.id),k()},children:"Close"})]}):null]})}function Ls({settled:e,panel:t}){let{state:n}=e;if(n.is!=="settled")return null;let o=I.get(e.id)??Date.now(),i=B.has(e.id),s=N.get(e.id);return a("div",{class:t?"row settled was-open":"row settled",children:[a("span",{class:"mark",children:n.isQueued?"":"\\u2713"}),a("div",{class:"content",children:[a("div",{class:"settled-head",children:[a("div",{class:s?"settled-line wraps":"settled-line",children:[a("span",{class:"what",children:e.title}),a("span",{class:"outcome-label",children:[C,n.isQueued?`Queued: ${n.label}`:n.label]}),s?a("span",{class:"tone-error",children:[C,s]}):null]}),n.canUndo?a("button",{type:"button",class:"key undo",disabled:i,onClick:()=>{vs(e)},children:[a("span",{class:i?"time-left paused":"time-left",style:{animationDuration:`${R}ms`},ref:r=>{r&&!r.style.animationDelay&&(r.style.animationDelay=`-${Math.max(0,Date.now()-o)}ms`)}},o),i?null:a(dt,{name:"undo"}),i?"Undoing\\u2026":"Undo"]}):null]}),t?a($n,{row:t,isClosing:!0}):null]})]})}function En({entries:e,group:t,all:n,now:o}){let i=Se[t];return e.length===0?null:a("div",{class:"list",children:e.map(s=>{let r=ne(s),d=T.get(r);return a("div",{class:"entry","data-motion":r,children:"row"in s?a(Es,{row:s.row,tone:i,track:d.track,now:o,onSelect:()=>vn(i,n,n.indexOf(s.row))}):a(Ls,{settled:s.settled,panel:d.openRow})},r)})})}function Ln({title:e,count:t}){return a("div",{class:"group-title",children:[a("b",{children:e}),t>0?a("span",{class:"count",children:[C,t]}):null]})}function at(e,t,n){return te(e.needsYou.closed[t==="question"?"questions":"tasks"],ze(n)).map(o=>({id:o.id,ask:o.ask,outcome:o.outcome,isLapsed:be(o),state:ye(o),at:o.at}))}function rn({v:e,kind:t,entries:n,all:o,now:i}){let s=t==="question"?"Questions":"Tasks",r=at(e,t,n);if(n.length===0&&r.length===0)return null;let d=n.flatMap(u=>"row"in u&&T.get(u.row.id)?.track.state!=="leaving"?[u.row]:[]);return a("section",{children:[a(Ln,{title:s,count:d.filter(u=>!u.fold).length}),a(En,{entries:n,group:t,all:o,now:i}),a(An,{group:t,closed:r,now:i})]})}function As(e){return Re(e).map(t=>{let n=t.code?a("code",{children:t.text}):t.text;return t.italic&&(n=a("i",{children:n})),t.bold&&(n=a("b",{children:n})),t.strike&&(n=a("s",{children:n})),t.link?a(A,{children:[a("u",{children:n}),a("span",{class:"muted",children:[" ",t.link]})]}):n})}function An({group:e,closed:t,now:n}){if(t.length===0)return null;let o=D.has(e),i=o||Le.has(e);return a(A,{children:[a("button",{type:"button",class:"fold","data-fold":e,onClick:()=>qs(e),children:[a(dt,{name:o?"down":"right"}),t.length," Closed"]}),i?a("div",{class:"list closed-list","data-motion":`closed-${e}`,children:t.map(s=>a("div",{class:"entry",children:a("div",{class:"row",children:[a("span",{class:"mark",children:Ft[s.state]}),a("div",{class:"content tight",children:[a("div",{class:"muted",children:s.ask}),a("div",{class:s.isLapsed?"outcome lapsed":"outcome",children:_e(s.outcome)})]}),a("span",{class:"side",children:ve(n-s.at)})]})},`closed-${s.id}`))}):null]})}function Ps(e){return e.heard==="heard"?null:["The inbox has not heard from this chat\\u2019s hooks.",e.heard==="none"?"Codex runs a plugin\\u2019s hooks only after you trust them.":"Items from Codex\\u2019s replies are missing."]}function Cs({v:e,lists:t,now:n}){let o=t.byTab.needsYou,i=t.questions.length===0&&t.tasks.length===0,s=at(e,"question",t.questions).length>0||at(e,"task",t.tasks).length>0,r=Ps(e);return i&&!s?r?a("div",{class:"empty",children:[a("div",{class:"title",children:r[0]}),a("div",{class:"muted",children:r[1]})]}):a("div",{class:"empty",children:[a("div",{class:"title",children:j("needsYou","Codex").title}),a("div",{class:"muted",children:j("needsYou","Codex").hint})]}):a("main",{children:[r?a("section",{children:a("div",{class:"group-title",children:[r[0],a("div",{class:"muted",children:r[1]})]})}):i?a("section",{children:a("div",{class:"group-title empty-line",children:j("needsYou","Codex").title})}):null,a(rn,{v:e,kind:"question",entries:t.questions,all:o,now:n}),a(rn,{v:e,kind:"task",entries:t.tasks,all:o,now:n})]})}function Is({v:e,lists:t,now:n}){let o=te(e.findings.closed,ze(t.findings)).map(s=>({id:s.id,ask:s.title,outcome:s.outcome,isLapsed:be(s),state:ye(s),at:s.closedAt})),i=t.findings.length===0;return i&&o.length===0?a("div",{class:"empty",children:[a("div",{class:"title",children:j("findings","Codex").title}),a("div",{class:"muted",children:j("findings","Codex").hint})]}):a("main",{children:[t.findingGroups.map(s=>{let r=s.entries.flatMap(d=>"row"in d&&T.get(d.row.id)?.track.state!=="leaving"?[d.row]:[]);return a("section",{children:[a(Ln,{title:s.title,count:r.filter(d=>!d.fold).length}),a(En,{entries:s.entries,group:"finding",all:t.byTab.findings,now:n})]})}),o.length>0?a("section",{children:[i?a("div",{class:"group-title empty-line",children:"No open findings."}):null,a(An,{group:"finding",closed:o,now:n})]}):null]})}var Ns=6e4;function Os({v:e,now:t}){let n={needsYou:e.needsYou.count,findings:e.findings.count},{changedAt:o,isUpdating:i,error:s}=e.status,r=Date.now()-pn,d=ct>=2?a("span",{class:r>Ns?"tone-error":void 0,children:["Last read ",W(r),C,"retrying"]}):i?"Updating\\u2026":o!==null?`Updated ${W(t-o)}`:"Not updated yet";return a("nav",{children:[a("div",{class:"tabs",children:Qe.map(u=>a("button",{type:"button",class:`tab ${_===u.id?"shown":""}`,onClick:()=>{_=u.id,k()},children:[u.label,n[u.id]>0?a("span",{class:`count tone-${u.id}`,children:n[u.id]}):null]}))}),a("div",{class:"status",children:d}),tt?a("div",{class:"status-line tone-error",children:tt}):null,s?a("div",{class:"status-line tone-error",children:s}):null,Y&&Date.now()-Y.at<R?a("div",{class:Y.isError?"status-line tone-error":"status-line muted",children:Y.text}):null]})}async function an(){M=!M,v=null,I=new Map,ot={},ut.clear(),T.clear(),Ie=null,$.needsYou=null,$.findings=null,S=null,k(),await ft()}function Ds({lists:e}){if(!v||!e)return Ae!==null?a("div",{class:"notice",children:["Could not read the inbox. ",Ae," ",a("button",{type:"button",class:"key",onClick:()=>{ft()},children:"Try again"})]}):a("div",{class:"notice",children:a("span",{class:"muted",children:"Loading\\u2026"})});let t=v,n=t.at;return a(A,{children:[M?a("div",{class:"demo-note",children:[a("span",{children:"Showing sample entries. Presses here send nothing."}),a("button",{type:"button",class:"key",onClick:()=>{an()},children:"Hide demo"})]}):null,a(Os,{v:t,now:n}),_==="needsYou"?a(Cs,{v:t,lists:e,now:n}):a(Is,{v:t,lists:e,now:n}),a("footer",{children:M?null:a("button",{type:"button",class:"demo-toggle",onClick:()=>{an()},children:"Show demo"})})]})}var Pn={duration:300,easing:"cubic-bezier(.19, 1, .22, 1)"},gt={duration:200,easing:"cubic-bezier(.65, 0, .35, 1)"},Cn={duration:200,easing:"cubic-bezier(.8, 0, .4, 1)",fill:"forwards"},Ne=matchMedia("(prefers-reduced-motion: reduce)");function Ms(){let e=new Map;for(let t of document.querySelectorAll("[data-motion]"))e.set(t.dataset.motion,{el:t,height:t.getBoundingClientRect().height});return e}function Fs(e,t,n,o){e.style.overflow="hidden",e.dataset.to=String(o);let i=e.animate(t,n),s=()=>{e.getAnimations().length===0&&In(e)};i.onfinish=s,i.oncancel=s}function ln(e){for(let t of e.getAnimations())t.cancel();In(e)}function In(e){e.style.overflow="",delete e.dataset.to}function ht(e){return[...e.children].reduce((t,n)=>t+n.getBoundingClientRect().height,0)}function ae(e,t,n,o){let i=s=>({height:`${s.height}px`,opacity:s.opacity});Fs(e,[i(t),i(n)],o,n.height)}function Nn(e,t){ae(e,{height:0,opacity:0},{height:t,opacity:1},Pn)}function Us(e,t){if(Ne.matches){G.clear();return}for(let n of document.querySelectorAll("[data-motion]")){let o=n.dataset.motion,i=e.get(o);if(n.dataset.closing)continue;let s=T.get(o)?.track.state,r=!i||i.el!==n,d=()=>n.getAnimations().length>0||r?n.getBoundingClientRect().height:i.height;if(s&&t.has(o)&&Hs(n,s,d)||s==="closing"||s==="settling"||s==="leaving")continue;let u=s?ht(n):n.scrollHeight;if(r){!s&&G.delete(o)&&Nn(n,u);continue}let c=n.getAnimations();if(c.length>0&&Math.abs(Number(n.dataset.to)-u)<1)continue;let p=d(),m=c.length>0?Number(getComputedStyle(n).opacity):1;for(let l of c)l.cancel();Math.abs(p-u)<1&&m>.99||ae(n,{height:p,opacity:m},{height:u,opacity:1},gt)}G.clear()}function Hs(e,t,n){switch(t){case"opening":return!1;case"entering":return ln(e),Nn(e,ht(e)),!0;case"closing":case"settling":return Vs(e,dn(e,n)),!0;case"leaving":{let o=dn(e,n);for(let i of e.getAnimations())i.cancel();return ae(e,o,{height:0,opacity:0},Cn),!0}default:return ln(e),!0}}function dn(e,t){return{height:t(),opacity:Number(getComputedStyle(e).opacity)}}function Vs(e,t){let n=e.querySelector(".panel.closing"),o=e.querySelector(".row.closing");o?.classList.remove("closing"),n&&(n.style.display="none");let i=ht(e);n&&(n.style.display=""),o?.classList.add("closing");for(let s of e.getAnimations())s.cancel();ae(e,t,{height:i,opacity:1},{...gt,fill:"forwards"})}function qs(e){let t=document.querySelector(`[data-motion="closed-${e}"]`);if(!D.has(e)){D.add(e),Le.delete(e)&&t?delete t.dataset.closing:G.add(`closed-${e}`),k();return}if(D.delete(e),!t||Ne.matches){k();return}Le.add(e),k(),t.dataset.closing="1";let n=t.getBoundingClientRect().height;for(let o of t.getAnimations())o.cancel();ae(t,{height:n,opacity:1},{height:0,opacity:0},Cn),setTimeout(()=>{D.has(e)||!Le.delete(e)||k()},200)}function Ws(){document.querySelector(".row.selected")?.scrollIntoView({block:"nearest"}),Ne.matches||setTimeout(()=>document.querySelector(".row.selected")?.scrollIntoView({block:"nearest"}),220)}var se=document.getElementById("app");document.documentElement.style.setProperty("--row-pad",`${8}px`);document.documentElement.style.setProperty("--move",`${200}ms ${gt.easing}`);document.documentElement.style.setProperty("--enter",`${300}ms ${Pn.easing}`);var On=50;function X(e){setTimeout(k,e+On)}var K=null;function js(){let e=Date.now(),t=[...T.values()].flatMap(({track:o})=>Ze(o.state)?[o.since+Te[o.state]]:[]);if(t.length===0)return;let n=Math.min(...t)+On;K&&K.at<=n||(K&&clearTimeout(K.timer),K={at:n,timer:setTimeout(()=>{K=null,k()},n-e)})}function k(){se.className&&(se.className="",se.textContent="");let e=Ms(),t=v?xs(v):null;Ie=t?.lists??null,js(),It(a(Ds,{lists:Ie}),se),Us(e,t?.changed??new Set),Pe&&S&&(Pe=!1,document.getElementById(`type-${S}`)?.focus())}var oe=null;document.addEventListener("pointerdown",e=>{!(e.target instanceof Element)||!e.target.closest(".list, .fold")||(oe={x:e.clientX,y:e.clientY},document.body.classList.add("still"))});document.addEventListener("pointermove",e=>{!oe||Math.hypot(e.clientX-oe.x,e.clientY-oe.y)<3||(oe=null,document.body.classList.remove("still"))});document.addEventListener("keydown",e=>{if(e.metaKey||e.ctrlKey||e.altKey||!v)return;let t=e.target;if(t?.closest("input, textarea")){e.key==="Escape"&&t.tagName==="INPUT"&&(S=null,k());return}let n=Qe.find(p=>p.hotkey===e.key);if(n){_=n.id,k();return}let o=kn(v,mt()).byTab[_],i=_n(o,_,v),s=e.key==="j"||e.key==="ArrowDown"?1:e.key==="k"||e.key==="ArrowUp"?-1:0;if(s!==0){e.preventDefault(),vn(_,o,Math.max(0,Math.min(o.length-1,i+s))),Ws();return}let r=o[i];if(!r)return;let{keys:d,more:u}=Sn(r),c=[...d,...u].find(p=>p.hotkey===e.key);c&&(e.preventDefault(),c.run())});cs();mn("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"inbox",version:"0.1.0"},appCapabilities:{tools:{}}}).then(e=>{gn(e?.hostContext??{}),parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*"),yn()}).catch(()=>{se.textContent="The inbox could not connect to Codex."});})();\n\n    </script>\n  </body>\n</html>\n';

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

// src/server-handler.ts
async function appCli() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const r = await run(["ps", "-o", "comm=", "-p", String(process.ppid)], { cwd: "/", timeoutMs: 5e3 });
  const path = r.stdout.trim();
  return r.code === 0 && /(^|\/)codex$/.test(path) ? path : "codex";
}
function devPageIn(dir) {
  let cached = null;
  return async () => {
    try {
      const dev = await devBuild(dir);
      if (!dev) return null;
      const { tab } = dev;
      const { mtimeMs } = await stat3(tab);
      if (cached?.path !== tab || cached.mtimeMs !== mtimeMs)
        cached = { path: tab, mtimeMs, html: await readFile2(tab, "utf8") };
      return cached.html;
    } catch {
      return null;
    }
  };
}
function createHandler(dir, loadError = () => null) {
  return makeServer({
    dir,
    now: Date.now,
    exec: run,
    tabHtml: tab_default,
    fallbackCli: appCli,
    devPage: devPageIn(dir),
    build: "b0c5bf38e8b5",
    loadError
  });
}
export {
  createHandler
};
