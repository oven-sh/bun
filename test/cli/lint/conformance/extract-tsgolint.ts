// Turns the test cases of tsgolint (`internal/rules/*/*_test.go`) into input for `extra-cases.ts`. Only the inputs are
// taken: what tsgolint expects for them is not, because typescript-eslint is the judge.
//
//   bun extract-tsgolint.ts --tsgolint <checkout> --out <dir> [--fixtures <dir>] [rule...]
//
// Writes `<dir>/typescript-eslint/<rule>.json` for every rule that `fixtures/` has, and `<dir>/stats.json`. A case whose
// code and options equal those of an upstream case is dropped.
//
// The tests are Go: composite literals `{Code: "..", Options: .., TSConfig: "..", Tsx: true, FileName: ".."}`. They are read
// by a scanner that knows the literals of Go and little else. `Options` is `rule_tester.OptionsFromJSON[T](json)`, or a
// struct whose fields are typescript-eslint's names with a capital. A case with anything more (a variable, a function
// call) is counted in `unparsed`, one with `Files` or with a tsconfig that upstream's project does not have in `unsupported`.

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, writeJson, type Fixture } from "./shared.ts";

interface Token {
  kind: "string" | "word" | "punct";
  text: string;
  start: number;
}

function unescapeGo(raw: string): string {
  return raw.replace(/\\(x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|[0-7]{3}|.)/gs, (_, escape: string) => {
    const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", a: "\x07", b: "\b", f: "\f", v: "\v" };
    if (/^[xuU]/.test(escape) && escape.length > 1) return String.fromCodePoint(parseInt(escape.slice(1), 16));
    if (/^[0-7]{3}$/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    return simple[escape] ?? escape;
  });
}

function tokenizeGo(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const start = i;
    if (/\s/.test(c)) i++;
    else if (source.startsWith("//", i)) {
      i = source.indexOf("\n", i);
      if (i < 0) i = source.length;
    } else if (source.startsWith("/*", i)) {
      i = source.indexOf("*/", i + 2);
      i = i < 0 ? source.length : i + 2;
    } else if (c === "`") {
      let end = source.indexOf("`", i + 1);
      if (end < 0) end = source.length;
      tokens.push({ kind: "string", text: source.slice(i + 1, end).replaceAll("\r", ""), start });
      i = end + 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === "\\") i++;
      tokens.push({ kind: c === '"' ? "string" : "punct", text: unescapeGo(source.slice(start + 1, i)), start });
      i++;
    } else if (/\w/.test(c)) {
      const word = /^\w+(?:\.\d+)?/.exec(source.slice(i, i + 128))![0];
      tokens.push({ kind: "word", text: word, start });
      i += word.length;
    } else {
      tokens.push({ kind: "punct", text: c, start });
      i++;
    }
  }
  return tokens;
}

class Unparsed extends Error {}

const OPEN = "([{";
const CLOSE = ")]}";

/** The index behind the value that starts at `from`: of the `,` or of the closing bracket. */
function endOfValue(tokens: Token[], from: number): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].kind !== "punct") continue;
    if (OPEN.includes(tokens[i].text)) depth++;
    else if (CLOSE.includes(tokens[i].text)) {
      if (depth === 0) return i;
      depth--;
    } else if (tokens[i].text === "," && depth === 0) return i;
  }
  return tokens.length;
}

/** `{Key: value, ..}` with `open` at the brace: the token range of each value. `null` if it is not that. */
function fieldsOf(tokens: Token[], open: number): { fields: Map<string, [number, number]>; end: number } | null {
  const fields = new Map<string, [number, number]>();
  let at = open + 1;
  while (at < tokens.length && tokens[at].text !== "}") {
    if (tokens[at].kind !== "word" || tokens[at + 1]?.text !== ":") return null;
    const end = endOfValue(tokens, at + 2);
    fields.set(tokens[at].text, [at + 2, end]);
    at = tokens[end]?.text === "," ? end + 1 : end;
  }
  return { fields, end: at };
}

function stringOf(tokens: Token[], [from, to]: [number, number]): string {
  let text = "";
  for (let i = from; i < to; i++) {
    const isOperator = (i - from) % 2 === 1;
    if (isOperator ? tokens[i].text !== "+" || tokens[i].kind !== "punct" : tokens[i].kind !== "string") {
      throw new Unparsed(`not a string: ${tokens[i].text}`);
    }
    if (!isOperator) text += tokens[i].text;
  }
  if (to === from || (to - from) % 2 === 0) throw new Unparsed("not a string");
  return text;
}

const lowerFirst = (name: string) => name[0].toLowerCase() + name.slice(1);

/** A value in a struct of options. */
function valueOf(tokens: Token[], [from, to]: [number, number]): unknown {
  const first = tokens[from];
  if (to - from === 1) {
    if (first.kind === "string") return first.text;
    if (first.text === "true") return true;
    if (first.text === "false") return false;
    if (first.text === "nil") return undefined;
    if (/^\d/.test(first.text)) return Number(first.text);
    throw new Unparsed(first.text);
  }
  if (first.text === "&") return valueOf(tokens, [from + 1, to]);
  const last = tokens[to - 1].text;
  // `[]string{"a", "b"}`, `[]T{{..}, {..}}`
  if (first.text === "[" && tokens[from + 1].text === "]" && last === "}") {
    let at = from + 2;
    while (tokens[at].text !== "{") at++;
    const items: unknown[] = [];
    for (at++; at < to - 1; ) {
      const end = endOfValue(tokens, at);
      items.push(valueOf(tokens, [at, end]));
      at = end + 1;
    }
    return items;
  }
  // `new(true)`, `utils.Ref(true)`, `utils.BoolOrValue[T](true)`
  if (last === ")") {
    let depth = 0;
    let open = to - 1;
    for (; open > from; open--) {
      if (tokens[open].text === ")") depth++;
      else if (tokens[open].text === "(" && --depth === 0) break;
    }
    const name = tokens
      .slice(from, open)
      .map(it => it.text)
      .join("");
    if (/^(?:new|utils\.Ref|utils\.BoolOrValue\[\w+\])$/.test(name)) return valueOf(tokens, [open + 1, to - 1]);
    throw new Unparsed(name);
  }
  // `T{Field: value}`, `{Field: value}`
  if (last === "}") {
    let open = from;
    while (open < to && tokens[open].text !== "{") open++;
    const struct = fieldsOf(tokens, open);
    if (!struct || struct.end !== to - 1) throw new Unparsed("struct");
    const object: Record<string, unknown> = {};
    for (const [name, range] of struct.fields) object[lowerFirst(name)] = valueOf(tokens, range);
    return object;
  }
  throw new Unparsed(first.text);
}

function optionsOf(tokens: Token[], [from, to]: [number, number]): unknown[] {
  const text = tokens
    .slice(from, from + 3)
    .map(it => it.text)
    .join("");
  if (text === "rule_tester.OptionsFromJSON") {
    let open = from;
    while (tokens[open].text !== "(") open++;
    try {
      return [JSON.parse(stringOf(tokens, [open + 1, to - 1]))];
    } catch {
      throw new Unparsed("json");
    }
  }
  return [valueOf(tokens, [from, to])];
}

interface Case {
  name: string;
  code: string;
  options?: unknown[];
  filename?: string;
  languageOptions?: Record<string, unknown>;
}

interface Stats {
  parsed: number;
  unparsed: number;
  unsupported: number;
  upstream: number;
  duplicates: number;
  kept: number;
}

/** They stand for the `tsconfig.json` of upstream's project, which has the types of Node.js. */
const DEFAULT_TSCONFIGS = ["tsconfig.minimal.json", "tsconfig.json", "tsconfig.includeTypes.json"];

function casesOfFile(source: string, label: string, project: string, stats: Stats): Case[] {
  const tokens = tokenizeGo(source);
  const cases: Case[] = [];
  // The tsconfig that `RunRuleTester(root, "tsconfig.json", ..)` gives to the cases that name none.
  const runs: { start: number; tsconfig: string }[] = [];
  tokens.forEach((token, i) => {
    if (token.text !== "RunRuleTester" || tokens[i + 1]?.text !== "(") return;
    const second = endOfValue(tokens, i + 2) + 1;
    if (tokens[second]?.kind === "string") runs.push({ start: token.start, tsconfig: tokens[second].text });
  });

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text !== "{" || tokens[i].kind !== "punct") continue;
    const struct = fieldsOf(tokens, i);
    const code = struct?.fields.get("Code");
    if (!struct || !code) continue;
    const { fields } = struct;
    const line = source.slice(0, tokens[i].start).split("\n").length;
    try {
      const made: Case = {
        name: `tsgolint ${label}:${line} ${fields.has("Errors") ? "invalid" : "valid"}`,
        code: stringOf(tokens, code),
      };
      const options = fields.get("Options");
      if (options) made.options = optionsOf(tokens, options);
      const parserOptions: Record<string, unknown> = {};
      if (fields.has("Tsx") && valueOf(tokens, fields.get("Tsx")!) === true) parserOptions.ecmaFeatures = { jsx: true };
      if (fields.has("FileName")) made.filename = stringOf(tokens, fields.get("FileName")!);
      const run = runs.findLast(it => it.start < tokens[i].start) ?? runs[0];
      const tsconfig = (fields.has("TSConfig") ? stringOf(tokens, fields.get("TSConfig")!) : run?.tsconfig)?.replace(/^\.\//, "");
      stats.parsed++;
      if (tsconfig === "tsconfig.unstrict.json") {
        Object.assign(parserOptions, { tsconfigRootDir: "unstrict", projectService: true });
      } else if (tsconfig && !DEFAULT_TSCONFIGS.includes(tsconfig)) {
        if (!existsSync(join(project, tsconfig))) throw new Unparsed("unsupported");
        parserOptions.project = `./${tsconfig}`;
      }
      if (fields.has("Files")) throw new Unparsed("unsupported");
      if (Object.keys(parserOptions).length > 0) made.languageOptions = { parserOptions };
      cases.push(made);
    } catch (error) {
      if (!(error instanceof Unparsed)) throw error;
      if (error.message === "unsupported") stats.unsupported++;
      else stats.unparsed++;
    }
    i = struct.end;
  }
  return cases;
}

let tsgolint = "";
let out = "";
let fixtures = join(import.meta.dirname, "fixtures");
const only: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--tsgolint") tsgolint = resolve(argv[++i]);
  else if (argv[i] === "--out") out = resolve(argv[++i]);
  else if (argv[i] === "--fixtures") fixtures = resolve(argv[++i]);
  else only.push(argv[i]);
}
if (!tsgolint || !out) {
  console.error("usage: bun extract-tsgolint.ts --tsgolint <checkout> --out <dir> [--fixtures <dir>] [rule...]");
  process.exit(2);
}

const all: Record<string, Stats> = {};
const root = join(tsgolint, "internal/rules");
for (const entry of readdirSync(root).sort()) {
  const rule = entry.replaceAll("_", "-");
  const upstreamFile = join(fixtures, "typescript-eslint", `${rule}.json`);
  if (!existsSync(upstreamFile) || (only.length > 0 && !only.includes(rule))) continue;
  const stats: Stats = { parsed: 0, unparsed: 0, unsupported: 0, upstream: 0, duplicates: 0, kept: 0 };
  const cases = readdirSync(join(root, entry))
    .filter(file => file.endsWith("_test.go"))
    .sort()
    .flatMap(file =>
      casesOfFile(
        readFileSync(join(root, entry, file), "utf8"),
        `${entry}/${file}`,
        join(fixtures, "typescript-eslint-project"),
        stats,
      ),
    );
  const key = (code: string, options: unknown) => `${code}\0${JSON.stringify(options ?? [])}`;
  const seen = new Set(readJson<Fixture>(upstreamFile).cases.map(it => key(it.code, it.options)));
  const own = new Set<string>();
  const kept = cases.filter(it => {
    if (seen.has(key(it.code, it.options))) return (stats.upstream++, false);
    const full = JSON.stringify({ ...it, name: undefined });
    if (own.has(full)) return (stats.duplicates++, false);
    own.add(full);
    return true;
  });
  stats.kept = kept.length;
  all[`typescript-eslint/${rule}`] = stats;
  if (kept.length === 0) continue;
  mkdirSync(join(out, "typescript-eslint"), { recursive: true });
  writeJson(join(out, "typescript-eslint", `${rule}.json`), kept);
}
mkdirSync(out, { recursive: true });
writeJson(join(out, "stats.json"), all);
const total = (field: keyof Stats) => Object.values(all).reduce((sum, it) => sum + it[field], 0);
console.log(
  `${Object.keys(all).length} rules: ${total("parsed")} cases parsed, ${total("unparsed")} not, ` +
    `${total("unsupported")} unsupported, ${total("upstream")} are upstream's, ${total("duplicates")} duplicates, ` +
    `${total("kept")} kept`,
);
