// What eslint-plugin-react-hooks reports with its rules of the React Compiler against what another tool reports for the same files.
//
//   bun compare-eslint.ts <theirs.jsonl> <ours> --sources=<directory> [--name=..] [--rule=react-hooks/refs] [--examples=40]
//                         [--strip=<prefix>]
//
// <theirs> has the lines of eslint.ts. <ours> is one of (told apart by what is in it):
//   - the lines of eslint.ts                                     {"path", "messages": [..]}
//   - reports of ESLint's `-f json`                              [{"filePath", "messages": [..]}]
//   - the compiler's findings as they are, a line for each file  {"path", "findings": [{"category", "reason", ..}]}
//
// Messages: the same if ruleId, severity, message, line, column, endLine, endColumn and the suggestions (desc, range, text) are,
// and both or neither are suppressed by a comment.
//
// Findings: the plugin's message is read back into what it was printed from, the heading, the reason, the description, the places
// of the code frames with their texts, and the hints, and that is compared with the finding, so that what is found can be judged
// before anything prints it. The same if the rule (of the category), the reason, the description, the places (start, end, text,
// order), the hints and the suggestions are, and the place of the message is the first place. A finding without a place is left
// out, as the plugin leaves it out. One `^` in a code frame stands for a place of no or one unit: both are taken. The text of a
// single place that is the reason stands for no text too.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EslintRecord, Message } from "./eslint.ts";
import { type ExpectedError, type Place, printed, problems, Source } from "./frames.ts";
import { ESLINT_ONLY, jsonDocuments, options, RULES, table } from "./shared.ts";

type Detail =
  | { kind: "error"; start?: number | null; end?: number | null; message?: string | null }
  | { kind: "hint"; message: string };
type Finding = {
  category: string;
  reason: string;
  description?: string | null;
  details?: Detail[];
  suggestions?: { op: string; start: number; end: number; description: string; text?: string | null }[];
};

/** What is compared. `fields` are the names of the parts, each with its value as text. */
type Item = { rule: string; place: string; firstLine: string; fields: Map<string, string>; shown: string };

const { flags, rest } = options(process.argv.slice(2));
if (rest.length !== 2 || !flags.has("sources")) {
  throw new Error("usage: bun compare-eslint.ts <theirs.jsonl> <ours> --sources=<directory>");
}
const sources = resolve(flags.get("sources")!);
const strip = flags.get("strip") ?? "";
const onlyRule = flags.get("rule");
const examples = Number(flags.get("examples") ?? 40);
const name = (file: string) => (file.startsWith(strip) ? file.slice(strip.length) : file).replace(/^\.\//, "");

const ruleOfCategory = new Map([
  ...RULES.map(([rule, , category]) => [category, `react-hooks/${rule}`] as const),
  ...ESLINT_ONLY.map(([rule, category]) => [category, `react-hooks/${rule}`] as const),
]);

const short = (text: string, length = 110) => JSON.stringify(text.length > length ? text.slice(0, length) + "…" : text);

function ofMessage(message: Message, isSuppressed: boolean): Item {
  const place = `${message.line}:${message.column}-${message.endLine}:${message.endColumn}`;
  const firstLine = message.message.split("\n")[0];
  return {
    rule: message.ruleId ?? "",
    place,
    firstLine,
    fields: new Map([
      ["severity", String(message.severity)],
      ["message", message.message],
      ["place", place],
      ["suggestions", JSON.stringify(message.suggestions ?? [])],
      ["suppressed by a comment", String(isSuppressed)],
    ]),
    shown: `${message.ruleId} ${place} ${short(firstLine)}${isSuppressed ? " (suppressed)" : ""}`,
  };
}

type Parts = {
  rule: string;
  reason: string;
  description: string | null;
  places: { start: number; end: number; text: string | null; maybeEmpty?: true }[];
  hints: string[];
  suggestions: string;
  place: string;
};

function ofParts(parts: Parts): Item {
  const places = parts.places.map(place => `${place.start}..${place.end}`);
  return {
    rule: parts.rule,
    place: parts.place,
    firstLine: parts.reason,
    fields: new Map([
      ["reason", parts.reason],
      ["description", parts.description ?? ""],
      ["number of places", String(parts.places.length)],
      ["places", places.join(" ")],
      ["texts of places", JSON.stringify(parts.places.map(place => place.text))],
      ["hints", JSON.stringify(parts.hints)],
      ["place of the message", parts.place],
      ["suggestions", parts.suggestions],
    ]),
    shown: `${parts.rule} ${parts.place} ${short(parts.reason, 80)} [${parts.places
      .map((place, i) => `${places[i]} ${place.text === null ? "-" : short(place.text, 50)}`)
      .join(", ")}]${parts.hints.length > 0 ? ` hints ${short(JSON.stringify(parts.hints), 80)}` : ""}`,
  };
}

let unread = 0;

/** The message of the plugin, read back. Null: it is not what the compiler prints. */
function partsOfMessage(path: string, source: Source, message: Message): Parts | null {
  const before = problems.length;
  const errors: ExpectedError[] = printed(path, source, message.message, 1);
  if (errors.length !== 1 || problems.length > before) {
    unread++;
    return null;
  }
  const [error] = errors;
  const places = error.details.filter((detail): detail is Place => detail.kind === "error");
  return {
    rule: message.ruleId ?? "",
    reason: error.reason,
    description: error.description,
    places: places.map(({ start, end, message: text, maybeEmpty }) => ({ start, end, text, maybeEmpty })),
    hints: error.details.flatMap(detail => (detail.kind === "hint" ? [detail.message] : [])),
    suggestions: JSON.stringify(
      (message.suggestions ?? []).map(({ desc, fix }) => [desc, fix.range[0], fix.range[1], fix.text]),
    ),
    place: `${message.line}:${message.column}-${message.endLine}:${message.endColumn}`,
  };
}

function partsOfFinding(source: Source, finding: Finding): Parts | null {
  const places: Parts["places"] = [];
  const hints: string[] = [];
  for (const detail of finding.details ?? []) {
    if (detail.kind === "hint") hints.push(detail.message);
    else if (detail.start != null && detail.end != null) {
      places.push({ start: detail.start, end: detail.end, text: detail.message || null });
    }
  }
  if (places.length === 0) return null;
  const [from, to] = [source.position(places[0].start), source.position(places[0].end)];
  return {
    rule: ruleOfCategory.get(finding.category) ?? `react-hooks/${finding.category}`,
    reason: finding.reason,
    description: finding.description ?? null,
    places,
    hints,
    suggestions: JSON.stringify(
      (finding.suggestions ?? []).map(it => [
        it.description,
        source.index(it.start),
        source.index(it.end),
        it.text ?? "",
      ]),
    ),
    place: `${from.line}:${from.column + 1}-${to.line}:${to.column + 1}`,
  };
}

const theirs = new Map<string, EslintRecord>();
for (const document of jsonDocuments(readFileSync(rest[0], "utf8"))) {
  const record = document as EslintRecord;
  if (record.messages !== undefined) theirs.set(name(record.path), record);
}

const ourMessages = new Map<string, Message[]>();
const ourSuppressed = new Map<string, Message[]>();
const ourFindings = new Map<string, Finding[]>();
const ourText = readFileSync(rest[1], "utf8");
if (ourText.startsWith("[")) {
  // One report on each line that starts with `[`.
  for (const line of ourText.split("\n")) {
    if (!line.startsWith("[")) continue;
    type Result = { filePath: string; messages: Message[]; suppressedMessages?: Message[] };
    for (const file of JSON.parse(line) as Result[]) {
      ourMessages.set(name(file.filePath), file.messages);
      ourSuppressed.set(name(file.filePath), file.suppressedMessages ?? []);
    }
  }
} else {
  for (const document of jsonDocuments(ourText)) {
    const record = document as { path: string; messages?: Message[]; suppressed?: Message[]; findings?: Finding[] };
    if (record.findings !== undefined) ourFindings.set(name(record.path), record.findings);
    else if (record.messages !== undefined) {
      ourMessages.set(name(record.path), record.messages);
      ourSuppressed.set(name(record.path), record.suppressed ?? []);
    }
  }
}
const raw = ourFindings.size > 0;
const oracle = flags.get("name") ?? "eslint-plugin-react-hooks";

/**
 * What a message cannot say. Where theirs has one `^`, an end that is the start counts as the same. A diagnostic of the older kind,
 * which has one place and no text for it, is printed with the reason as the text.
 */
function reconcile(a: Parts, b: Parts) {
  if (a.places.length !== b.places.length) return;
  if (a.places.length === 1 && a.places[0].text === a.reason && b.places[0].text === null) a.places[0].text = null;
  a.places.forEach((place, i) => {
    if (place.maybeEmpty && b.places[i].start === place.start && b.places[i].end === place.start)
      place.end = place.start;
  });
}

const differences = (a: Item, b: Item) =>
  [...a.fields].filter(([field, value]) => b.fields.get(field) !== value).map(([field]) => field);

type Count = { theirs: number; ours: number; same: number; different: number; onlyTheirs: number; onlyOurs: number };
const rules = new Map<string, Count>();
const count = (rule: string) => {
  let entry = rules.get(rule);
  if (entry === undefined)
    rules.set(rule, (entry = { theirs: 0, ours: 0, same: 0, different: 0, onlyTheirs: 0, onlyOurs: 0 }));
  return entry;
};
const files = { cases: 0, same: 0, withAny: 0, withAnySame: 0, refused: 0, refusedSame: 0, missing: 0 };
const total = { cases: 0, same: 0, samePlace: 0, sameFirstLine: 0 };
const causes = new Map<string, number>();
const shown: string[] = [];
let differing = 0;

for (const path of [...new Set([...theirs.keys(), ...ourMessages.keys(), ...ourFindings.keys()])].sort()) {
  const record = theirs.get(path);
  if (record !== undefined && !ourMessages.has(path) && !ourFindings.has(path)) files.missing++;
  // Not what ESLint itself says: that the file does not parse, that a comment names a rule that does not exist.
  const ofThePlugin = (message: Message) => message.ruleId?.startsWith("react-hooks/") === true;
  const theirMessages = (record?.messages ?? []).filter(ofThePlugin);
  const theirSuppressed = (record?.suppressed ?? []).filter(ofThePlugin);
  let left: Item[];
  let right: Item[];
  if (raw) {
    const source = new Source(readFileSync(join(sources, path), "utf8"));
    // A finding knows nothing of comments.
    const a = [...theirMessages, ...theirSuppressed].flatMap(message => partsOfMessage(path, source, message) ?? []);
    const b = (ourFindings.get(path) ?? []).flatMap(finding => partsOfFinding(source, finding) ?? []);
    for (const parts of a) {
      const twin = b.find(other => other.rule === parts.rule && other.places[0].start === parts.places[0]?.start);
      if (twin !== undefined) reconcile(parts, twin);
    }
    [left, right] = [a.map(ofParts), b.map(ofParts)];
  } else {
    const items = (messages: Message[], suppressed: Message[]) => [
      ...messages.filter(ofThePlugin).map(message => ofMessage(message, false)),
      ...suppressed.filter(ofThePlugin).map(message => ofMessage(message, true)),
    ];
    left = items(theirMessages, theirSuppressed);
    right = items(ourMessages.get(path) ?? [], ourSuppressed.get(path) ?? []);
  }
  if (onlyRule !== undefined) [left, right] = [left, right].map(items => items.filter(item => item.rule === onlyRule));

  const open: (Item | null)[] = [...right];
  const unmatched: Item[] = [];
  let same = 0;
  for (const item of left) {
    const at = open.findIndex(
      other => other !== null && other.rule === item.rule && differences(item, other).length === 0,
    );
    if (at < 0) unmatched.push(item);
    else {
      open[at] = null;
      same++;
      const entry = count(item.rule);
      (entry.theirs++, entry.ours++, entry.same++);
    }
  }
  const lines: string[] = [];
  let different = 0;
  for (const item of unmatched) {
    const likeness = (other: Item | null) =>
      other === null || other.rule !== item.rule
        ? 0
        : (other.place === item.place ? 2 : 0) + (other.firstLine === item.firstLine ? 1 : 0);
    let best = -1;
    open.forEach((other, i) => {
      if (likeness(other) > (best < 0 ? 0 : likeness(open[best]))) best = i;
    });
    different++;
    const entry = count(item.rule);
    entry.theirs++;
    if (best < 0) {
      entry.onlyTheirs++;
      causes.set("only theirs", (causes.get("only theirs") ?? 0) + 1);
      lines.push(" only theirs", `  theirs ${item.shown}`);
      continue;
    }
    const other = open[best]!;
    open[best] = null;
    (entry.ours++, entry.different++);
    const fields = differences(item, other);
    causes.set(fields.join(" + "), (causes.get(fields.join(" + ")) ?? 0) + 1);
    if (other.place === item.place) total.samePlace++;
    if (other.firstLine === item.firstLine) total.sameFirstLine++;
    lines.push(` differs in: ${fields.join(", ")}`, `  theirs ${item.shown}`, `  ours   ${other.shown}`);
    for (const field of fields) {
      if (field !== "description" && field !== "message" && field !== "suggestions") continue;
      const [a, b] = [item.fields.get(field)!, other.fields.get(field)!];
      let at = 0;
      while (at < a.length && a[at] === b[at]) at++;
      const from = Math.max(0, at - 30);
      lines.push(
        `         ${field}: theirs …${short(a.slice(from), 140)}`,
        `         ${field}: ours   …${short(b.slice(from), 140)}`,
      );
    }
  }
  for (const other of open) {
    if (other === null) continue;
    different++;
    const entry = count(other.rule);
    (entry.ours++, entry.onlyOurs++);
    causes.set("only ours", (causes.get("only ours") ?? 0) + 1);
    lines.push(" only ours", `  ours   ${other.shown}`);
  }
  files.cases++;
  if (different === 0) files.same++;
  if (same + different > 0) files.withAny++;
  if (same + different > 0 && different === 0) files.withAnySame++;
  if (record?.parse === "error") {
    files.refused++;
    if (different === 0) files.refusedSame++;
  }
  total.cases += same + different;
  total.same += same;
  if (different > 0 && ++differing <= examples) {
    shown.push([`${path}${record?.parse === "error" ? " (ESLint's parser refuses it)" : ""}`, ...lines].join("\n"));
  }
}

console.log(
  table(
    ["Oracle", "Cases", "Same", "Different"],
    [
      [`${oracle}: files`, files.cases, files.same, files.cases - files.same],
      [
        `${oracle}: files with a message on either side`,
        files.withAny,
        files.withAnySame,
        files.withAny - files.withAnySame,
      ],
      [
        `${oracle}: ${raw ? "messages against findings" : "messages"}`,
        total.cases,
        total.same,
        total.cases - total.same,
      ],
      [
        `${oracle}: files that ESLint's parser refuses`,
        files.refused,
        files.refusedSame,
        files.refused - files.refusedSame,
      ],
    ],
  ),
);
if (files.missing > 0) console.log(`\n${files.missing} files of theirs are not in ours`);
if (unread > 0) console.log(`\n${unread} messages of theirs could not be read back, and are left out`);
console.log();
console.log(
  table(
    ["Rule", "Theirs", "Ours", "Same", "Different", "Only theirs", "Only ours"],
    [...rules]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([rule, n]) => [rule, n.theirs, n.ours, n.same, n.different, n.onlyTheirs, n.onlyOurs]),
  ),
);
console.log();
console.log(
  table(
    ["Of those that differ", "Messages"],
    [
      ["the same rule and the same place", total.samePlace],
      [`the same rule and the same ${raw ? "reason" : "first line of the message"}`, total.sameFirstLine],
    ],
  ),
);
console.log();
console.log(
  table(
    ["Differs in", "Messages"],
    [...causes].sort((a, b) => b[1] - a[1]),
  ),
);
if (shown.length > 0) {
  console.log(`\nThe first ${shown.length} of ${differing} files that differ:\n`);
  console.log(shown.join("\n"));
}
process.exitCode = total.cases === total.same ? 0 : 1;
