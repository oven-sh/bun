// What two runs reported, compared one by one. Nothing here runs a tool.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Example = { file: string; theirs?: string; ours?: string };
/** All the differences of one kind: a rule, and which of the two reported it. */
export type Bucket = {
  rule: string;
  side: "theirs" | "ours" | "fix";
  count: number;
  files: number;
  examples: Example[];
};

export type LintComparison = {
  files: { theirs: number; ours: number; identical: number; onlyTheirs: string[]; onlyOurs: string[] };
  /** With the suppressed ones. */
  messages: { theirs: number; ours: number; same: number; onlyTheirs: number; onlyOurs: number };
  /** Of the messages that are the same: how many have another fix or other suggestions. */
  fixes: { compared: number; different: number };
  suppressed: { theirs: number; ours: number };
  /** The messages that are the same, by rule: what a rule gets right counts as much as what it gets wrong. */
  sameByRule: Record<string, number>;
  buckets: Bucket[];
};

const EXAMPLES = 4;
const LISTED = 40;

class Buckets {
  #all = new Map<string, Bucket & { seen: Set<string> }>();
  add(rule: string, side: Bucket["side"], example: Example) {
    const key = `${side} ${rule}`;
    let bucket = this.#all.get(key);
    if (!bucket) this.#all.set(key, (bucket = { rule, side, count: 0, files: 0, examples: [], seen: new Set() }));
    bucket.count++;
    if (!bucket.seen.has(example.file)) {
      bucket.seen.add(example.file);
      bucket.files++;
      // One example for each of the first files says more than four of one file.
      if (bucket.examples.length < EXAMPLES) bucket.examples.push(example);
    }
  }
  list(): Bucket[] {
    return [...this.#all.values()].map(({ seen, ...bucket }) => bucket).sort((a, b) => b.count - a.count);
  }
}

/** One message of either linter, in the shape that is compared. */
type Entry = { key: string; rule: string; line: number; text: string; fix: string };

function compareEntries(byFile: [Map<string, Entry[]>, Map<string, Entry[]>], listed: boolean): LintComparison {
  const [theirs, ours] = byFile;
  const buckets = new Buckets();
  const result: LintComparison = {
    files: { theirs: theirs.size, ours: ours.size, identical: 0, onlyTheirs: [], onlyOurs: [] },
    messages: { theirs: 0, ours: 0, same: 0, onlyTheirs: 0, onlyOurs: 0 },
    fixes: { compared: 0, different: 0 },
    suppressed: { theirs: 0, ours: 0 },
    sameByRule: {},
    buckets: [],
  };
  for (const file of new Set([...theirs.keys(), ...ours.keys()])) {
    const [a, b] = [theirs.get(file), ours.get(file)];
    // Only a format that lists the files without a message can tell that a file was not linted.
    if (listed && a === undefined) result.files.onlyOurs.push(file);
    if (listed && b === undefined) result.files.onlyTheirs.push(file);
    result.messages.theirs += a?.length ?? 0;
    result.messages.ours += b?.length ?? 0;
    const left = new Map<string, Entry[]>();
    for (const it of b ?? []) left.set(it.key, [...(left.get(it.key) ?? []), it]);
    const unmatched: Entry[] = [];
    let identical = a !== undefined && b !== undefined;
    for (const it of a ?? []) {
      const match = left.get(it.key)?.pop();
      if (match === undefined) {
        unmatched.push(it);
        continue;
      }
      result.messages.same++;
      result.sameByRule[it.rule] = (result.sameByRule[it.rule] ?? 0) + 1;
      result.fixes.compared++;
      if (match.fix !== it.fix) {
        result.fixes.different++;
        identical = false;
        buckets.add(it.rule, "fix", {
          file,
          theirs: `${it.text} ${it.fix}`.slice(0, 600),
          ours: match.fix.slice(0, 400),
        });
      }
    }
    const extra = [...left.values()].flat();
    if (unmatched.length || extra.length) identical = false;
    if (identical) result.files.identical++;
    result.messages.onlyTheirs += unmatched.length;
    result.messages.onlyOurs += extra.length;
    // The other side's message of the same rule on the same line shows what is different about it.
    const near = (list: Entry[], it: Entry) =>
      list.find(other => other.rule === it.rule && other.line === it.line)?.text;
    for (const it of unmatched) buckets.add(it.rule, "theirs", { file, theirs: it.text, ours: near(extra, it) });
    for (const it of extra) buckets.add(it.rule, "ours", { file, ours: it.text, theirs: near(unmatched, it) });
  }
  result.files.onlyTheirs = result.files.onlyTheirs.sort();
  result.files.onlyOurs = result.files.onlyOurs.sort();
  result.buckets = buckets.list();
  return result;
}

/** The lists are counted before they are cut. */
export function cut(comparison: LintComparison) {
  const { onlyTheirs, onlyOurs } = comparison.files;
  return {
    ...comparison,
    files: {
      ...comparison.files,
      onlyTheirsCount: onlyTheirs.length,
      onlyOursCount: onlyOurs.length,
      onlyTheirs: onlyTheirs.slice(0, LISTED),
      onlyOurs: onlyOurs.slice(0, LISTED),
    },
  };
}

type EslintMessage = {
  ruleId: string | null;
  severity: number;
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fatal?: boolean;
  fix?: unknown;
  suggestions?: unknown;
};
type EslintResult = { filePath: string; messages: EslintMessage[]; suppressedMessages?: EslintMessage[] };

/** The keys of a suggestion are in the order in which the rule has written them. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, it]) => [key, sorted(it)]),
  );
}

/** `eslint -f json` of both. */
export function compareEslint(theirs: EslintResult[], ours: EslintResult[], root: string): LintComparison {
  let suppressed = [0, 0];
  const entries = (results: EslintResult[], side: number) => {
    const byFile = new Map<string, Entry[]>();
    for (const result of results) {
      suppressed[side] += result.suppressedMessages?.length ?? 0;
      // Most repositories have no problem left but those that a comment suppresses, so these are what shows that a rule works.
      const entry = (it: EslintMessage, suppressed: boolean) => {
        const rule = it.ruleId ?? (it.fatal ? "(fatal)" : "(no rule)");
        const place = [it.line, it.column, it.endLine ?? null, it.endColumn ?? null];
        return {
          rule,
          line: it.line ?? 0,
          key: JSON.stringify([rule, it.severity, ...place, it.message, suppressed]),
          text: `${place.join(":")} ${it.severity}${suppressed ? " (suppressed)" : ""} ${it.message}`.slice(0, 400),
          fix: JSON.stringify(sorted([it.fix ?? null, it.suggestions ?? null])),
        };
      };
      byFile.set(relative(root, result.filePath), [
        ...result.messages.map(it => entry(it, false)),
        ...(result.suppressedMessages ?? []).map(it => entry(it, true)),
      ]);
    }
    return byFile;
  };
  const result = compareEntries([entries(theirs, 0), entries(ours, 1)], true);
  result.suppressed = { theirs: suppressed[0], ours: suppressed[1] };
  return result;
}

type OxlintDiagnostic = {
  message: string;
  code?: string;
  severity: string;
  filename: string;
  labels: { span: { line: number; column: number; length: number } }[];
};
export type OxlintReport = { diagnostics: OxlintDiagnostic[]; number_of_files: number; number_of_rules: number | null };

/**
 * `oxlint -f json` of both. The rule, the severity and where a diagnostic starts are compared: with an `.oxlintrc.json` the texts
 * of `bun lint` are ESLint's, and so is where a diagnostic ends.
 */
export function compareOxlint(theirs: OxlintReport, ours: OxlintReport): LintComparison {
  const entries = (report: OxlintReport) => {
    const byFile = new Map<string, Entry[]>();
    for (const it of report.diagnostics) {
      const span = it.labels[0]?.span;
      const rule = it.code ?? "(no rule)";
      const list = byFile.get(it.filename) ?? [];
      list.push({
        rule,
        line: span?.line ?? 0,
        key: JSON.stringify([rule, it.severity, span?.line, span?.column]),
        text: `${span?.line}:${span?.column} ${it.severity} ${it.message}`.slice(0, 400),
        fix: "",
      });
      byFile.set(it.filename, list);
    }
    return byFile;
  };
  const result = compareEntries([entries(theirs), entries(ours)], false);
  result.files.theirs = theirs.number_of_files;
  result.files.ours = ours.number_of_files;
  return result;
}

/** The regular files below `directory` (the upper layer of an overlay: what a run has written), without what is not the project's. */
export function writtenFiles(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (name === "node_modules" || name === ".git") continue;
      const path = join(at, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.set(relative(directory, path), path);
    }
  };
  walk(directory);
  return files;
}

export type TreeComparison = {
  theirs: number;
  ours: number;
  same: number;
  different: string[];
  onlyTheirs: string[];
  onlyOurs: string[];
};

/** What two runs have written, byte for byte. */
export function compareTrees(theirs: Map<string, string>, ours: Map<string, string>): TreeComparison {
  const result: TreeComparison = {
    theirs: theirs.size,
    ours: ours.size,
    same: 0,
    different: [],
    onlyTheirs: [],
    onlyOurs: [],
  };
  for (const [file, path] of theirs) {
    const other = ours.get(file);
    if (other === undefined) result.onlyTheirs.push(file);
    else if (readFileSync(path).equals(readFileSync(other))) result.same++;
    else result.different.push(file);
  }
  for (const file of ours.keys()) if (!theirs.has(file)) result.onlyOurs.push(file);
  for (const list of [result.different, result.onlyTheirs, result.onlyOurs]) list.sort();
  return result;
}
