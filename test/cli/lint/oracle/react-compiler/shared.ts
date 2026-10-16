// What the scripts of this directory have in common: the rules, the records, and how oxlint is run and read.

import { closeSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** oxlint's rule, its category in oxlint, and the category of the compiler's diagnostics that it reports. */
export const RULES: readonly (readonly [rule: string, oxlint: string, compiler: string])[] = [
  ["capitalized-calls", "suspicious", "CapitalizedCalls"],
  ["error-boundaries", "correctness", "ErrorBoundaries"],
  ["exhaustive-effect-dependencies", "suspicious", "EffectExhaustiveDependencies"],
  ["globals", "correctness", "Globals"],
  ["hooks", "suspicious", "Hooks"],
  ["immutability", "correctness", "Immutability"],
  ["incompatible-library", "correctness", "IncompatibleLibrary"],
  ["invariant", "restriction", "Invariant"],
  ["memo-dependencies", "suspicious", "MemoDependencies"],
  ["no-deriving-state-in-effects", "perf", "EffectDerivationsOfState"],
  ["preserve-manual-memoization", "correctness", "PreserveManualMemo"],
  ["purity", "correctness", "Purity"],
  ["refs", "correctness", "Refs"],
  ["rule-suppression", "restriction", "Suppression"],
  ["set-state-in-effect", "correctness", "EffectSetState"],
  ["set-state-in-render", "correctness", "RenderSetState"],
  ["static-components", "correctness", "StaticComponents"],
  ["syntax", "restriction", "Syntax"],
  ["todo", "restriction", "Todo"],
  ["unsupported-syntax", "restriction", "UnsupportedSyntax"],
  ["use-memo", "correctness", "UseMemo"],
  ["void-use-memo", "correctness", "VoidUseMemo"],
];

/** The rules that only eslint-plugin-react-hooks has, each with the category of the compiler's diagnostics that it reports. */
export const ESLINT_ONLY: readonly (readonly [rule: string, compiler: string])[] = [
  ["memoized-effect-dependencies", "EffectDependencies"],
  ["config", "Config"],
  ["gating", "Gating"],
  ["fbt", "FBT"],
];

export const RULE_NAMES: readonly string[] = RULES.map(([rule]) => `react/${rule}`);
const RULE_OF_CATEGORY = new Map(RULES.map(([rule, , compiler]) => [compiler, `react/${rule}`]));

export function ruleOfCategory(category: string): string {
  return RULE_OF_CATEGORY.get(category) ?? `compiler/${category}`;
}

/** The react plugin with nothing on but `rules`. */
export function configOf(rules: readonly string[], severity = "error"): object {
  return {
    plugins: ["react"],
    categories: { correctness: "off" },
    rules: Object.fromEntries(rules.map(rule => [rule, severity])),
  };
}

export type Label = {
  /** Offsets in bytes of UTF-8. */
  start: number;
  end: number;
  line?: number;
  column?: number;
  text: string | null;
};

export type Diagnostic = {
  /** `react/refs`. Null where the source of the record does not say (upstream's printed errors). */
  rule: string | null;
  severity?: string;
  message: string;
  help: string | null;
  note: string | null;
  url?: string | null;
  labels: Label[];
};

export type FileRecord = {
  path: string;
  /** What the tool exits with for this file alone. */
  exit?: number;
  /** `ok`; `error`: syntax errors are reported; `silent`: not parsed and nothing said (a file with `@flow`). */
  parse: "ok" | "error" | "silent";
  /** The syntax errors. */
  syntax?: Diagnostic[];
  diagnostics: Diagnostic[];
};

export const INPUT = /\.(?:js|jsx|ts|tsx|mjs)$/;

/** The inputs below `dir` for each directory, sorted, relative to `dir`. `shared-runtime.ts` is what they import. */
export function inputsByDirectory(dir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (relative: string) => {
    const files: string[] = [];
    const entries = readdirSync(join(dir, relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (INPUT.test(entry.name) && path !== "shared-runtime.ts") files.push(path);
    }
    if (files.length > 0) found.set(relative, files);
  };
  walk("");
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

type RawLabel = { label?: string; span: { offset: number; length: number; line: number; column: number } };
type RawDiagnostic = {
  message: string;
  code?: string;
  severity: string;
  url?: string;
  help?: string;
  note?: string;
  filename?: string;
  labels?: RawLabel[];
};
export type RawReport = { diagnostics: RawDiagnostic[]; number_of_files: number; number_of_rules: number | null };

/** `react(refs)` is `react/refs`; `eslint(max-lines)` is `max-lines`. */
function ruleOfCode(code: string): string {
  const match = /^([\w-]+)\((.+)\)$/.exec(code);
  if (match === null) return code;
  return match[1] === "eslint" ? match[2] : `${match[1].replace(/^eslint-plugin-/, "")}/${match[2]}`;
}

export function diagnosticOf(raw: RawDiagnostic): Diagnostic {
  return {
    rule: raw.code === undefined || raw.code === "" ? null : ruleOfCode(raw.code),
    severity: raw.severity,
    message: raw.message,
    help: raw.help ?? null,
    note: raw.note ?? null,
    url: raw.url ?? null,
    labels: (raw.labels ?? []).map(label => ({
      start: label.span.offset,
      end: label.span.offset + label.span.length,
      line: label.span.line,
      column: label.span.column,
      text: label.label ?? null,
    })),
  };
}

export type Run = { exit: number; report: RawReport; stderr: string };

/** One process of oxlint with `-f json`. `command` may have arguments of its own, after blanks. */
export function oxlint(command: string, cwd: string, args: readonly string[]): Run {
  const result = Bun.spawnSync({
    cmd: [...command.split(" "), "-f", "json", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  for (const document of jsonDocuments(stdout)) {
    const report = document as Partial<RawReport>;
    if (report.diagnostics !== undefined && report.number_of_files !== undefined) {
      return { exit: result.exitCode ?? -1, report: report as RawReport, stderr };
    }
  }
  throw new Error(`No report (exit ${result.exitCode}):\n${stdout.slice(0, 2000)}\n${stderr.slice(0, 2000)}`);
}

/** The objects of JSON that start at the start of a line, on one line or more. Other text between them is skipped. */
export function* jsonDocuments(text: string): Generator<unknown> {
  let at = 0;
  while (at < text.length) {
    const lineEnd = text.indexOf("\n", at);
    const next = lineEnd < 0 ? text.length : lineEnd + 1;
    if (text[at] !== "{") {
      at = next;
      continue;
    }
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = at; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) return;
    try {
      yield JSON.parse(text.slice(at, end));
      at = end;
    } catch {
      at = next;
    }
  }
}

/** The diagnostics of a report for each file, in the order of the report. */
export function byFile(report: RawReport): Map<string, Diagnostic[]> {
  const files = new Map<string, Diagnostic[]>();
  for (const raw of report.diagnostics) {
    const path = (raw.filename ?? "").replace(/^\.\//, "");
    let list = files.get(path);
    if (list === undefined) files.set(path, (list = []));
    list.push(diagnosticOf(raw));
  }
  return files;
}

export function* readJsonl<T>(path: string): Generator<T> {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line !== "") yield JSON.parse(line) as T;
  }
}

export class JsonlWriter {
  #fd: number;
  constructor(path: string) {
    this.#fd = openSync(path, "w");
  }
  write(record: unknown) {
    writeSync(this.#fd, JSON.stringify(record) + "\n");
  }
  close() {
    closeSync(this.#fd);
  }
}

/** A table of Markdown. Numbers are set to the right. */
export function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const text = rows.map(row => row.map(cell => (typeof cell === "number" ? cell.toLocaleString("en-US") : cell)));
  const width = head.map((cell, i) => Math.max(cell.length, 3, ...text.map(row => row[i].length)));
  const right = head.map((_, i) => rows.length > 0 && rows.every(row => typeof row[i] === "number"));
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, i) => (right[i] ? cell.padStart(width[i]) : cell.padEnd(width[i]))).join(" | ")} |`;
  const rule = `| ${width.map((w, i) => (right[i] ? "-".repeat(w - 1) + ":" : "-".repeat(w))).join(" | ")} |`;
  return [line(head), rule, ...text.map(line)].join("\n");
}

/** `--name=value` and `--name` of the command line, and what is left. */
export function options(argv: readonly string[]): { flags: Map<string, string>; rest: string[] } {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (const arg of argv) {
    const match = /^--([\w-]+)(?:=(.*))?$/s.exec(arg);
    if (match === null) rest.push(arg);
    else flags.set(match[1], match[2] ?? "");
  }
  return { flags, rest };
}

export function oxlintBinary(flags: Map<string, string>): string {
  const binary = flags.get("oxlint") ?? process.env.OXLINT;
  if (binary === undefined || binary === "") throw new Error("Which oxlint? --oxlint=<path> or OXLINT=<path>");
  return binary;
}
