// Writes oxlint's own test cases for the React Compiler rules as files, for oxlint.ts and compare.ts.
//
//   bun cases.ts <cases> <out directory>                     writes <rule>/<number>.<valid|invalid>.tsx
//   bun cases.ts <cases> <out directory> --check=<jsonl>     also checks the output of oxlint.ts against the cases
//
// <cases> is one of:
//   - oxlint's `crates/oxc_linter/src/rules/react`. The cases are the `let pass = vec![..]` and `let fail = vec![..]`
//     in `<rule>.rs`. A `fail` case expects at least one diagnostic from its rule, and a `pass` case expects none.
//   - a directory with a `<rule>.json` for each rule: {"cases": [{"valid", "code", "filename", "messages": [{"message",
//     "line", "column"}]}]}. A case expects exactly these messages at these positions.
// A case in `node_modules` stays in a directory with that name.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { type FileRecord, options, readJsonl, RULES, table } from "./shared.ts";

type Case = {
  valid: boolean;
  code: string;
  filename: string;
  /** Null if the messages are unknown. An invalid case then expects at least one. */
  messages: { message: string; line: number; column: number }[] | null;
};

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", '"': '"', "'": "'" };

/** Returns the Rust string literal that starts at `at` and its end offset, or null if there isn't one. */
function literal(text: string, at: number): { value: string; end: number } | null {
  const raw = /^r(#*)"/.exec(text.slice(at, at + 12));
  if (raw !== null) {
    const start = at + raw[0].length;
    const end = text.indexOf(`"${raw[1]}`, start);
    return end < 0 ? null : { value: text.slice(start, end), end: end + 1 + raw[1].length };
  }
  if (text[at] !== '"') return null;
  let value = "";
  for (let i = at + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '"') return { value, end: i + 1 };
    if (char !== "\\") {
      value += char;
      continue;
    }
    const next = text[++i];
    const unicode = next === "u" ? /^\{([0-9a-fA-F_]+)\}/.exec(text.slice(i + 1, i + 12)) : null;
    if (unicode !== null) {
      value += String.fromCodePoint(parseInt(unicode[1].replaceAll("_", ""), 16));
      i += unicode[0].length;
    } else if (next === "x") {
      value += String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (next === "\n") {
      // A line continuation skips the next line's leading whitespace.
      while (/\s/.test(text[i + 1] ?? "")) i++;
    } else {
      value += ESCAPES[next] ?? next;
    }
  }
  return null;
}

/** Parses a `vec![` whose elements start at `at`. Returns each element's first string and its `PathBuf::from(..)`. */
function elements(text: string, at: number): { code: string; filename: string | null }[] {
  const found: { code: string; filename: string | null }[] = [];
  let current: { code: string; filename: string | null } | null = null;
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text.startsWith("//", i)) {
      i = text.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    const string = literal(text, i);
    if (string !== null) {
      if (current === null) found.push((current = { code: string.value, filename: null }));
      else if (text.slice(0, i).endsWith("PathBuf::from(")) current.filename = string.value;
      i = string.end - 1;
    } else if ("([{".includes(text[i])) {
      depth++;
    } else if (")]}".includes(text[i])) {
      if (depth-- === 0) break;
    } else if (text[i] === "," && depth === 0) {
      current = null;
    }
  }
  return found;
}

function fromSource(path: string, rule: string): Case[] {
  const text = readFileSync(path, "utf8");
  const found: Case[] = [];
  for (const match of text.matchAll(/\blet (pass|fail) = vec!\[/g)) {
    for (const { code, filename } of elements(text, match.index + match[0].length)) {
      const valid = match[1] === "pass";
      found.push({ valid, code, filename: filename ?? `${rule}.tsx`, messages: valid ? [] : null });
    }
  }
  return found;
}

export type Expectation = { rule: string; code: string; messages: Case["messages"] };

/** Returns every rule's cases, keyed by the path each one is written to. */
export function casesOf(directory: string): Map<string, Expectation> {
  const found = new Map<string, Expectation>();
  for (const [rule] of RULES) {
    const source = join(directory, `${rule.replaceAll("-", "_")}.rs`);
    const list = existsSync(source)
      ? fromSource(source, rule)
      : (JSON.parse(readFileSync(join(directory, `${rule}.json`), "utf8")) as { cases: Case[] }).cases;
    list.forEach((item, index) => {
      const inside = dirname(item.filename);
      const name = `${String(index + 1).padStart(2, "0")}.${item.valid ? "valid" : "invalid"}${extname(item.filename)}`;
      const path = inside === "." ? `${rule}/${name}` : `${rule}/${inside}/${name}`;
      found.set(path, { rule: `react/${rule}`, code: item.code, messages: item.messages });
    });
  }
  return found;
}

if (import.meta.main) {
  const { flags, rest } = options(process.argv.slice(2));
  if (rest.length !== 2) throw new Error("usage: bun cases.ts <cases> <out directory> [--check=<jsonl>]");
  const [cases, out] = rest.map(path => resolve(path));

  const expected = casesOf(cases);
  for (const [path, item] of expected) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), item.code);
  }
  console.log(`${expected.size} cases`);

  const check = flags.get("check");
  if (check !== undefined) {
    let same = 0;
    let others = 0;
    const seen = new Set<string>();
    for (const record of readJsonl<FileRecord>(resolve(check))) {
      const item = expected.get(record.path);
      if (item === undefined) continue;
      seen.add(record.path);
      const key = (message: string, line: number | undefined, column: number | undefined) =>
        `${line}:${column} ${message}`;
      const found = record.diagnostics.filter(diagnostic => diagnostic.rule === item.rule);
      others += record.diagnostics.length - found.length;
      const theirs = found.map(d => key(d.message, d.labels[0]?.line, d.labels[0]?.column)).sort();
      const wanted = item.messages?.map(message => key(message.message, message.line, message.column)).sort();
      if (wanted === undefined ? theirs.length > 0 : JSON.stringify(theirs) === JSON.stringify(wanted)) same++;
      else
        console.log(
          `${record.path}\n  expected ${JSON.stringify(wanted ?? "any")}\n  reported ${JSON.stringify(theirs)}`,
        );
    }
    console.log(
      table(
        ["Cases", "In the lines", "The rule reports what the case expects", "Diagnostics of other rules"],
        [[expected.size, seen.size, same, others]],
      ),
    );
  }
}
