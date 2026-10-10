// Two sets of diagnostics of the React Compiler's rules for the same files, one against the other.
//
//   bun compare.ts <theirs> <ours> [--name=oxlint] [--ignore=help,note] [--rule=react/refs] [--examples=40] [--strip=<prefix>]
//                  [--messages=react/todo,react/invariant]
//
// Each side is one of (told apart by what is in it):
//   - the lines of oxlint.ts or repos.ts                         {"path", "parse", "diagnostics": [..]}
//   - the lines of frames.ts                                     {"path", "errors": [..], "logged": [..]}
//   - the compiler's findings as they are, a line for each file  {"path", "findings": [{"category", "reason", ..}]}
//   - reports of `-f json`, one or more, with other text between {"diagnostics": [..], "number_of_files": ..}
//
// A diagnostic is the same if the rule, the message, all labels (start, end, text, order), the help and the note are the same,
// and the severity where both sides have one. `--ignore` leaves fields out: severity, message, help, note, text (of labels),
// order (of labels). `--messages`: also a table of the messages of these rules, with what is in `..` left out.
//
// Where theirs comes from frames.ts there are no rules, and the fixtures were compiled with other options than a linter has:
// an error is a case only if ours has a diagnostic with the same message in the same file, and nothing is "only ours".

import { readFileSync } from "node:fs";
import type { Expected, ExpectedError } from "./frames.ts";
import {
  byFile,
  type Diagnostic,
  type FileRecord,
  jsonDocuments,
  type Label,
  options,
  type RawReport,
  RULE_NAMES,
  ruleOfCategory,
  table,
} from "./shared.ts";

type Finding = {
  category: string;
  reason: string;
  description?: string | null;
  note?: string | null;
  details?: (
    | { kind: "error"; start?: number | null; end?: number | null; message?: string | null }
    | { kind: "hint" }
  )[];
};
/** `null`: the file has syntax errors. */
type Findings = { path: string; findings: Finding[] | null };
/** `maybeEmpty`: the end is `end` or `start`. */
type AnyLabel = Label & { maybeEmpty?: true };
type Side = {
  kind: "records" | "frames" | "findings" | "reports";
  /** Only the files that have diagnostics are there: reports of `-f json`, and the lines of repos.ts. */
  sparse: boolean;
  /** Of the lines of repos.ts: the first part of the paths of the runs that gave a report. */
  repositories: Set<string>;
  files: Map<string, FileRecord>;
};

function ofExpected(error: ExpectedError): Diagnostic {
  const labels: AnyLabel[] = [];
  for (const detail of error.details) {
    if (detail.kind !== "error") continue;
    const label: AnyLabel = { start: detail.start, end: detail.end, text: detail.message };
    if (detail.maybeEmpty) label.maybeEmpty = true;
    labels.push(label);
  }
  return {
    rule: error.category === null ? null : ruleOfCategory(error.category),
    message: error.reason,
    help: error.description,
    note: null,
    labels,
  };
}

function ofFinding(finding: Finding): Diagnostic {
  const labels: Label[] = [];
  for (const detail of finding.details ?? []) {
    if (detail.kind !== "error" || detail.start == null || detail.end == null) continue;
    labels.push({ start: detail.start, end: detail.end, text: detail.message ?? null });
  }
  return {
    rule: ruleOfCategory(finding.category),
    message: finding.reason,
    help: finding.description ?? null,
    note: finding.note ?? null,
    labels,
  };
}

function read(path: string, strip: string): Side {
  const files = new Map<string, FileRecord>();
  const name = (file: string) => (file.startsWith(strip) ? file.slice(strip.length) : file).replace(/^\.\//, "");
  let kind: Side["kind"] | null = null;
  let sparse = false;
  const repositories = new Set<string>();
  for (const value of jsonDocuments(readFileSync(path, "utf8"))) {
    const document = value as Partial<FileRecord & Expected & Findings & RawReport>;
    if (document.number_of_files !== undefined) {
      kind ??= "reports";
      sparse = true;
      for (const [file, found] of byFile(document as RawReport)) {
        const diagnostics = found.filter(d => d.rule !== null && RULE_NAMES.includes(d.rule));
        const syntax = found.filter(d => d.rule === null);
        files.set(name(file), { path: name(file), parse: syntax.length > 0 ? "error" : "ok", diagnostics });
      }
    } else if (document.findings !== undefined) {
      kind ??= "findings";
      const file = name(document.path!);
      const parse = document.findings === null ? "error" : "ok";
      files.set(file, { path: file, parse, diagnostics: (document.findings ?? []).map(ofFinding) });
    } else if (document.errors !== undefined) {
      kind ??= "frames";
      const file = name(document.path!);
      const diagnostics = [...document.errors, ...(document.logged ?? [])].map(ofExpected);
      files.set(file, { path: file, parse: "ok", diagnostics });
    } else if (document.diagnostics !== undefined) {
      kind ??= "records";
      files.set(name(document.path!), { ...(document as FileRecord), path: name(document.path!) });
    } else if ("repo" in document) {
      kind ??= "records";
      sparse = true;
      if (!("failed" in document)) repositories.add(String(document.repo).replace("/", "__"));
    }
  }
  if (kind === null) throw new Error(`${path}: nothing that can be read`);
  return { kind, sparse, repositories, files };
}

const { flags, rest } = options(process.argv.slice(2));
if (rest.length !== 2) throw new Error("usage: bun compare.ts <theirs> <ours>");
const strip = flags.get("strip") ?? "";
const theirs = read(rest[0], strip);
const ours = read(rest[1], strip);
const byMessage = theirs.kind === "frames";
const oracle = flags.get("name") ?? (byMessage ? "the fixtures' expectations" : "oxlint");
const ignore = new Set((flags.get("ignore") ?? "").split(",").filter(field => field !== ""));
const onlyRule = flags.get("rule");
const examples = Number(flags.get("examples") ?? 40);

const sameSpan = (a: AnyLabel, b: AnyLabel) =>
  a.start === b.start && (a.end === b.end || (a.maybeEmpty === true && b.end === a.start));
const bySpan = (a: Label, b: Label) => a.start - b.start || a.end - b.end;

/** The fields in which two diagnostics of a rule differ. Nothing: they are the same. */
function differences(a: Diagnostic, b: Diagnostic): string[] {
  const fields: string[] = [];
  if (a.severity !== undefined && b.severity !== undefined && a.severity !== b.severity && !ignore.has("severity")) {
    fields.push("severity");
  }
  if (a.message !== b.message && !ignore.has("message")) fields.push("message");
  if (a.labels.length !== b.labels.length) {
    fields.push("number of labels");
  } else if (!a.labels.every((label, i) => sameSpan(label, b.labels[i]))) {
    const sorted = b.labels.toSorted(bySpan);
    const reordered = a.labels.toSorted(bySpan).every((label, i) => sameSpan(label, sorted[i]));
    if (!reordered) fields.push("places");
    else if (!ignore.has("order")) fields.push("order of labels");
  } else if (!ignore.has("text") && !a.labels.every((label, i) => label.text === b.labels[i].text)) {
    fields.push("text of labels");
  }
  if (a.help !== b.help && !ignore.has("help")) fields.push("help");
  if (a.note !== b.note && !ignore.has("note") && !byMessage) fields.push("note");
  return fields;
}

/** How much two diagnostics that are not the same have in common. 0: they are not a pair. */
function likeness(a: Diagnostic, b: Diagnostic): number {
  if (a.rule !== b.rule && !byMessage) return 0;
  if (byMessage) return a.message === b.message ? 1 + (sameFirst(a, b) ? 1 : 0) : 0;
  let score = 0;
  if (sameFirst(a, b)) score += 8;
  if (a.labels.length === b.labels.length && a.labels.every((label, i) => sameSpan(label, b.labels[i]))) score += 4;
  if (a.message === b.message) score += 2;
  if (a.help === b.help) score += 1;
  return score >= 2 ? score : 0;
}
function sameFirst(a: Diagnostic, b: Diagnostic): boolean {
  return a.labels.length > 0 && b.labels.length > 0 && sameSpan(a.labels[0], b.labels[0]);
}

type Pair = { theirs: Diagnostic; ours: Diagnostic; fields: string[] };
type Outcome = { same: Diagnostic[]; pairs: Pair[]; onlyTheirs: Diagnostic[]; onlyOurs: Diagnostic[]; order: boolean };

function compare(a: readonly Diagnostic[], b: readonly Diagnostic[]): Outcome {
  const left = [...a];
  const right: (Diagnostic | null)[] = [...b];
  const outcome: Outcome = { same: [], pairs: [], onlyTheirs: [], onlyOurs: [], order: true };
  const matched: number[] = [];
  const rest: Diagnostic[] = [];
  for (const diagnostic of left) {
    const at = right.findIndex(
      other =>
        other !== null && (byMessage || other.rule === diagnostic.rule) && differences(diagnostic, other).length === 0,
    );
    if (at < 0) {
      rest.push(diagnostic);
    } else {
      right[at] = null;
      matched.push(at);
      outcome.same.push(diagnostic);
    }
  }
  outcome.order = matched.every((at, i) => i === 0 || matched[i - 1] < at);
  for (const diagnostic of rest) {
    let best = -1;
    let score = 0;
    right.forEach((other, i) => {
      const value = other === null ? 0 : likeness(diagnostic, other);
      if (value > score) [best, score] = [i, value];
    });
    if (best < 0) {
      outcome.onlyTheirs.push(diagnostic);
    } else {
      outcome.pairs.push({ theirs: diagnostic, ours: right[best]!, fields: differences(diagnostic, right[best]!) });
      right[best] = null;
    }
  }
  for (const other of right) if (other !== null) outcome.onlyOurs.push(other);
  return outcome;
}

const short = (text: string | null, length = 100) =>
  text === null ? "-" : JSON.stringify(text.length > length ? text.slice(0, length) + "…" : text);
/** `text` from a little before the place where it stops being `other`. */
function from(text: string | null, other: string | null): string {
  if (text === null || other === null) return short(text, 160);
  let same = 0;
  while (same < text.length && text[same] === other[same]) same++;
  const start = Math.max(0, same - 30);
  return (start > 0 ? "…" : "") + short(text.slice(start), 160);
}
function show(side: string, diagnostic: Diagnostic, other?: Diagnostic, fields?: readonly string[]): string {
  const labels = diagnostic.labels.map(label => `${label.start}..${label.end} ${short(label.text, 60)}`).join(", ");
  let line = `  ${side} ${diagnostic.rule ?? ""} ${short(diagnostic.message)} [${labels}]`;
  if (fields?.includes("help")) line += `\n         help ${from(diagnostic.help, other!.help)}`;
  if (fields?.includes("note")) line += `\n         note ${from(diagnostic.note, other!.note)}`;
  return line;
}

type RuleCount = {
  theirs: number;
  ours: number;
  same: number;
  different: number;
  onlyTheirs: number;
  onlyOurs: number;
};
const rules = new Map<string, RuleCount>();
const ruleCount = (rule: string | null) => {
  const key = rule ?? "(no rule)";
  let entry = rules.get(key);
  if (entry === undefined) {
    rules.set(key, (entry = { theirs: 0, ours: 0, same: 0, different: 0, onlyTheirs: 0, onlyOurs: 0 }));
  }
  return entry;
};
if (!byMessage) for (const rule of RULE_NAMES) if (onlyRule === undefined || onlyRule === rule) ruleCount(rule);

const files = { cases: 0, same: 0, withAny: 0, withAnySame: 0, order: 0, notParsed: 0, notParsedSame: 0, missing: 0 };
const total = { cases: 0, same: 0, firstLabel: 0, texts: 0 };
const causes = new Map<string, number>();
const messagesOf = new Set((flags.get("messages") ?? "").split(",").filter(rule => rule !== ""));
const messages = new Map<string, { rule: string; message: string; theirs: number; ours: number; same: number }>();
function messageCount(diagnostic: Diagnostic) {
  if (diagnostic.rule === null || !messagesOf.has(diagnostic.rule)) return null;
  const message = diagnostic.message.replace(/`[^`]*`/g, "`..`");
  const key = `${diagnostic.rule} ${message}`;
  let entry = messages.get(key);
  if (entry === undefined) messages.set(key, (entry = { rule: diagnostic.rule, message, theirs: 0, ours: 0, same: 0 }));
  return entry;
}
const shown: string[] = [];
let differing = 0;

const wanted = (diagnostic: Diagnostic) => onlyRule === undefined || diagnostic.rule === onlyRule;
const paths = new Set(theirs.files.keys());
if (!byMessage) for (const path of ours.files.keys()) paths.add(path);

const inBoth = (path: string) => {
  const repository = path.slice(0, path.indexOf("/"));
  return theirs.repositories.has(repository) && ours.repositories.has(repository);
};

for (const path of [...paths].sort()) {
  if (theirs.repositories.size > 0 && ours.repositories.size > 0 && !inBoth(path)) continue;
  const theirFile = theirs.files.get(path);
  const ourFile = ours.files.get(path);
  if (ourFile === undefined && !ours.sparse) files.missing++;
  const outcome = compare((theirFile?.diagnostics ?? []).filter(wanted), (ourFile?.diagnostics ?? []).filter(wanted));
  if (byMessage) {
    // Not a case: what ours does not have at all, and what only ours has.
    outcome.onlyTheirs.length = 0;
    outcome.onlyOurs.length = 0;
  }
  const different = outcome.pairs.length + outcome.onlyTheirs.length + outcome.onlyOurs.length;
  const any = outcome.same.length + different > 0;
  if (byMessage && !any) continue;
  files.cases++;
  if (different === 0) files.same++;
  if (any) files.withAny++;
  if (any && different === 0) files.withAnySame++;
  if (different === 0 && !outcome.order) files.order++;
  if (theirFile !== undefined && theirFile.parse !== "ok") {
    files.notParsed++;
    if (different === 0) files.notParsedSame++;
  }
  total.cases += outcome.same.length + different;
  total.same += outcome.same.length;
  for (const diagnostic of outcome.same) {
    const entry = ruleCount(diagnostic.rule);
    (entry.theirs++, entry.ours++, entry.same++);
    const message = messageCount(diagnostic);
    if (message !== null) (message.theirs++, message.ours++, message.same++);
  }
  for (const diagnostic of [...outcome.pairs.map(pair => pair.theirs), ...outcome.onlyTheirs]) {
    const message = messageCount(diagnostic);
    if (message !== null) message.theirs++;
  }
  for (const diagnostic of [...outcome.pairs.map(pair => pair.ours), ...outcome.onlyOurs]) {
    const message = messageCount(diagnostic);
    if (message !== null) message.ours++;
  }
  for (const pair of outcome.pairs) {
    const entry = ruleCount(pair.theirs.rule);
    (entry.theirs++, entry.ours++, entry.different++);
    const cause = pair.fields.join(" + ");
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
    if (sameFirst(pair.theirs, pair.ours)) total.firstLabel++;
    if (pair.fields.every(field => field === "help" || field === "note" || field === "text of labels")) total.texts++;
  }
  for (const diagnostic of outcome.onlyTheirs) {
    const entry = ruleCount(diagnostic.rule);
    (entry.theirs++, entry.onlyTheirs++);
    causes.set("only theirs", (causes.get("only theirs") ?? 0) + 1);
  }
  for (const diagnostic of outcome.onlyOurs) {
    const entry = ruleCount(diagnostic.rule);
    (entry.ours++, entry.onlyOurs++);
    causes.set("only ours", (causes.get("only ours") ?? 0) + 1);
  }
  if (different > 0 && ++differing <= examples) {
    const lines = [
      `${path}${theirFile !== undefined && theirFile.parse !== "ok" ? " (theirs does not parse it)" : ""}`,
    ];
    for (const pair of outcome.pairs) {
      lines.push(` differs in: ${pair.fields.join(", ")}`, show("theirs", pair.theirs, pair.ours, pair.fields));
      lines.push(show("ours  ", pair.ours, pair.theirs, pair.fields));
    }
    for (const diagnostic of outcome.onlyTheirs) lines.push(" only theirs", show("theirs", diagnostic));
    for (const diagnostic of outcome.onlyOurs) lines.push(" only ours", show("ours  ", diagnostic));
    shown.push(lines.join("\n"));
  }
}

const rows: (string | number)[][] = [
  [`${oracle}: files`, files.cases, files.same, files.cases - files.same],
  [
    `${oracle}: files with a diagnostic on either side`,
    files.withAny,
    files.withAnySame,
    files.withAny - files.withAnySame,
  ],
  [`${oracle}: diagnostics`, total.cases, total.same, total.cases - total.same],
];
if (files.notParsed > 0) {
  const row = [`${oracle}: files that it does not parse`, files.notParsed, files.notParsedSame];
  rows.push([...row, files.notParsed - files.notParsedSame]);
}
console.log(table(["Oracle", "Cases", "Same", "Different"], byMessage ? [rows[0], rows[2]] : rows));
if (ignore.size > 0) console.log(`\nNot compared: ${[...ignore].join(", ")}`);
if (files.missing > 0) console.log(`\n${files.missing} files of theirs are not in ours`);
if (files.order > 0) console.log(`\n${files.order} files have the same diagnostics in another order`);

console.log();
console.log(
  table(
    ["Rule", "Theirs", "Ours", "Same", "Different", "Only theirs", "Only ours"],
    [...rules].map(([rule, n]) => [rule, n.theirs, n.ours, n.same, n.different, n.onlyTheirs, n.onlyOurs]),
  ),
);
console.log();
console.log(
  table(
    ["Of those that differ", "Diagnostics"],
    [
      ["the same rule and the same first label", total.firstLabel],
      ["the same but for help, note or the text of labels", total.texts],
    ],
  ),
);
console.log();
console.log(
  table(
    ["Differs in", "Diagnostics"],
    [...causes].sort((a, b) => b[1] - a[1]),
  ),
);
if (messages.size > 0) {
  const sorted = [...messages.values()].sort(
    (a, b) =>
      a.rule.localeCompare(b.rule) || b.theirs + b.ours - a.theirs - a.ours || a.message.localeCompare(b.message),
  );
  console.log();
  console.log(
    table(
      ["Rule", "Message", "Theirs", "Ours", "Same"],
      sorted.map(it => [it.rule, it.message, it.theirs, it.ours, it.same]),
    ),
  );
}
if (shown.length > 0) {
  console.log(`\nThe first ${shown.length} of ${differing} files that differ:\n`);
  console.log(shown.join("\n"));
}
process.exitCode = total.cases === total.same ? 0 : 1;
