// oxlint's own test cases of the rules of the React Compiler as files, for oxlint.ts and compare.ts.
//
//   bun cases.ts <cases> <out directory>                     writes <rule>/<number>.<valid|invalid>.tsx
//   bun cases.ts <cases> <out directory> --check=<jsonl>     and: do the lines of oxlint.ts say what the cases expect?
//
// <cases> is one of:
//   - oxlint's `crates/oxc_linter/src/rules/react`: the `let pass = vec![..]` and `let fail = vec![..]` of `<rule>.rs`. A case
//     that fails expects at least one diagnostic of its rule, one that passes expects none.
//   - a directory with a file `<rule>.json` for each rule: {"cases": [{"valid", "code", "filename", "messages": [{"message",
//     "line", "column"}]}]}. A case expects these messages at these places.
// A case in `node_modules` stays in a directory of that name.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { type FileRecord, options, readJsonl, RULES, table } from "./shared.ts";

type Case = {
  valid: boolean;
  code: string;
  filename: string;
  /** Null: not known, but there is one if the case is not valid. */
  messages: { message: string; line: number; column: number }[] | null;
};

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", '"': '"', "'": "'" };

/** The string literal of Rust that starts at `at`, and where it ends. Null: there is none. */
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
      // The line goes on after the blanks of the next one.
      while (/\s/.test(text[i + 1] ?? "")) i++;
    } else {
      value += ESCAPES[next] ?? next;
    }
  }
  return null;
}

/** The elements of `vec![` whose `[` is before `at`: of each the first string, and the one in `PathBuf::from(..)`. */
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

const { flags, rest } = options(process.argv.slice(2));
if (rest.length !== 2) throw new Error("usage: bun cases.ts <cases> <out directory> [--check=<jsonl>]");
const [cases, out] = rest.map(path => resolve(path));

const expected = new Map<string, { rule: string; messages: Case["messages"] }>();
for (const [rule] of RULES) {
  const source = join(cases, `${rule.replaceAll("-", "_")}.rs`);
  const list = existsSync(source)
    ? fromSource(source, rule)
    : (JSON.parse(readFileSync(join(cases, `${rule}.json`), "utf8")) as { cases: Case[] }).cases;
  list.forEach((item, index) => {
    const inside = dirname(item.filename);
    const name = `${String(index + 1).padStart(2, "0")}.${item.valid ? "valid" : "invalid"}${extname(item.filename)}`;
    const path = inside === "." ? `${rule}/${name}` : `${rule}/${inside}/${name}`;
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), item.code);
    expected.set(path, { rule: `react/${rule}`, messages: item.messages });
  });
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
