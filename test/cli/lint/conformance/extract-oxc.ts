// Turns the test cases in oxlint's rule sources (`crates/oxc_linter/src/rules/{eslint,typescript}`) into input for
// `extra-cases.ts`. Only the inputs are taken: what oxlint expects for them is not, because ESLint is the judge.
//
//   bun extract-oxc.ts --oxc <oxc checkout> --out <dir> [--fixtures <dir>] [rule...]
//
// Writes `<dir>/<plugin>/<rule>.json` for every rule that `fixtures/` has, and `<dir>/stats.json`. A case whose code and
// options equal those of an upstream case is dropped.
//
// The tests are Rust: `let pass = vec![..]`, `let fail = vec![..]`, `let fix = vec![..]` in `#[test]` functions, with
// elements `"code"`, `("code", Some(json!([..])), Some(json!({ "globals": .. })), Some(PathBuf::from("a.ts")))` and
// `("code", "fixed", Some(json!([..])))`. They are read by a scanner that knows the literals of Rust and little else. An
// element that is anything more (`format!`, a variable) is counted in `unparsed`.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { readJson, writeJson, type Fixture } from "./shared.ts";

// ---------------------------------------------------------------------------
// Tokens of Rust
// ---------------------------------------------------------------------------

interface Token {
  kind: "string" | "word" | "punct" | "char";
  text: string;
  start: number;
  end: number;
}

interface Comment {
  text: string;
  start: number;
}

function unescapeRust(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") {
      out += raw[i];
      continue;
    }
    const c = raw[++i];
    if (c === "n") out += "\n";
    else if (c === "r") out += "\r";
    else if (c === "t") out += "\t";
    else if (c === "0") out += "\0";
    else if (c === "x") {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c === "u") {
      const end = raw.indexOf("}", i);
      out += String.fromCodePoint(parseInt(raw.slice(i + 2, end).replaceAll("_", ""), 16));
      i = end;
    } else if (c === "\n" || c === "\r") {
      // A line continuation swallows the white space that follows.
      while (i + 1 < raw.length && /\s/.test(raw[i + 1])) i++;
    } else out += c;
  }
  return out;
}

export function tokenizeRust(source: string): { tokens: Token[]; comments: Comment[] } {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
    } else if (source.startsWith("//", i)) {
      let end = source.indexOf("\n", i);
      if (end < 0) end = source.length;
      comments.push({ text: source.slice(i + 2, end), start: i });
      i = end;
    } else if (source.startsWith("/*", i)) {
      let depth = 1;
      for (i += 2; i < source.length && depth > 0; i++) {
        if (source.startsWith("/*", i)) (depth++, i++);
        else if (source.startsWith("*/", i)) (depth--, i++);
      }
    } else if (c === '"' || (c === "b" && source[i + 1] === '"')) {
      const start = i;
      i += c === "b" ? 2 : 1;
      const from = i;
      while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
      tokens.push({ kind: "string", text: unescapeRust(source.slice(from, i)), start, end: ++i });
    } else if (/^b?r#*"/.test(source.slice(i, i + 12))) {
      const start = i;
      const hashes = /^b?r(#*)"/.exec(source.slice(i, i + 12))![1];
      const from = source.indexOf('"', i) + 1;
      let end = source.indexOf('"' + hashes, from);
      if (end < 0) end = source.length;
      i = end + 1 + hashes.length;
      tokens.push({ kind: "string", text: source.slice(from, end), start, end: i });
    } else if (c === "'") {
      const literal = /^'(?:\\(?:u\{[^}]*\}|x..|.)|[^\\'])'/su.exec(source.slice(i, i + 16));
      const length = literal ? literal[0].length : 1;
      tokens.push({ kind: literal ? "char" : "punct", text: source.slice(i, i + length), start: i, end: i + length });
      i += length;
    } else if (/[\w]/.test(c)) {
      const word = /^[\w]+(?:\.\d+)?/.exec(source.slice(i, i + 128))![0];
      tokens.push({ kind: "word", text: word, start: i, end: i + word.length });
      i += word.length;
    } else {
      tokens.push({ kind: "punct", text: c, start: i, end: ++i });
    }
  }
  return { tokens, comments };
}

// ---------------------------------------------------------------------------
// The expressions that test cases are made of
// ---------------------------------------------------------------------------

class Unparsed extends Error {}

/** A path such as `FixKind::Safe`: known to be there, of no interest. */
const OPAQUE = Symbol("opaque");

class Parser {
  at = 0;
  /** `lookup` finds the value of a `let` or of a function without parameters. */
  constructor(
    readonly tokens: Token[],
    readonly lookup: (name: string) => unknown = () => undefined,
  ) {}

  peek(offset = 0): string | undefined {
    return this.tokens[this.at + offset]?.text;
  }
  isPunct(text: string, offset = 0): boolean {
    const token = this.tokens[this.at + offset];
    return token !== undefined && token.kind === "punct" && token.text === text;
  }
  expect(text: string) {
    if (!this.isPunct(text)) throw new Unparsed(`expected ${text}, got ${this.peek()}`);
    this.at++;
  }
  list(close: string, item: () => unknown): unknown[] {
    const items: unknown[] = [];
    while (!this.isPunct(close)) {
      if (this.at >= this.tokens.length) throw new Unparsed("unclosed");
      items.push(item());
      if (this.isPunct(",")) this.at++;
      else if (!this.isPunct(close)) throw new Unparsed(`expected , got ${this.peek()}`);
    }
    this.at++;
    return items;
  }

  json(): unknown {
    const token = this.tokens[this.at++];
    if (!token) throw new Unparsed("end of json");
    if (token.kind === "string") return token.text;
    if (token.kind === "word") {
      if (token.text === "true") return true;
      if (token.text === "false") return false;
      if (token.text === "null") return null;
      const number = Number(token.text.replaceAll("_", ""));
      if (!Number.isNaN(number)) return number;
      throw new Unparsed(`json: ${token.text}`);
    }
    if (token.text === "-") return -(this.json() as number);
    if (token.text === "[") return this.list("]", () => this.json());
    if (token.text === "{") {
      const entries = this.list("}", () => {
        const key = this.tokens[this.at++];
        if (key?.kind !== "string") throw new Unparsed("json key");
        this.expect(":");
        return [key.text, this.json()];
      });
      return Object.fromEntries(entries as [string, unknown][]);
    }
    throw new Unparsed(`json: ${token.text}`);
  }

  postfix(value: unknown): unknown {
    while (this.isPunct(".")) {
      const method = this.peek(1);
      this.at += 2;
      this.expect("(");
      const args = this.list(")", () => this.expr());
      if (["to_string", "to_owned", "into", "as_str", "clone", "to_path_buf"].includes(method!)) continue;
      if (typeof value !== "string") throw new Unparsed(`.${method}`);
      if (method === "repeat" && typeof args[0] === "number") value = value.repeat(args[0]);
      else if (method === "replace" && typeof args[0] === "string" && typeof args[1] === "string") {
        value = value.replaceAll(args[0], args[1]);
      } else throw new Unparsed(`.${method}`);
    }
    return value;
  }

  expr(): unknown {
    const token = this.tokens[this.at];
    if (!token) throw new Unparsed("end");
    if (token.kind === "string") return (this.at++, this.postfix(token.text));
    if (token.kind === "punct") {
      this.at++;
      if (token.text === "&") return this.expr();
      if (token.text === "(") return this.list(")", () => this.expr());
      if (token.text === "[") return this.list("]", () => this.expr());
      throw new Unparsed(token.text);
    }
    if (token.kind === "char") throw new Unparsed("char");
    if (/^\d/.test(token.text)) return (this.at++, Number(token.text.replaceAll("_", "")));

    let last = token.text;
    let segments = 1;
    this.at++;
    while (this.isPunct(":") && this.isPunct(":", 1)) {
      last = this.peek(2)!;
      this.at += 3;
      segments++;
    }
    if (this.isPunct("!")) {
      this.at++;
      const open = this.peek();
      const close = { "(": ")", "[": "]", "{": "}" }[open!];
      if (!close) throw new Unparsed(`${last}!`);
      this.at++;
      if (last === "json") {
        const value = this.json();
        this.expect(close);
        return value;
      }
      if (last === "vec") return this.list(close, () => this.expr());
      if (last === "concat") return this.list(close, () => this.expr()).join("");
      throw new Unparsed(`${last}!`);
    }
    if (this.isPunct("(")) {
      this.at++;
      const args = this.list(")", () => this.expr());
      if (last === "Some") return args[0];
      if (last === "from" || last === "new") return this.postfix(args[0]);
      if (segments === 1 && args.length === 0 && this.lookup(last) !== undefined) return this.postfix(this.lookup(last));
      throw new Unparsed(`${last}()`);
    }
    if (last === "None") return null;
    if (last === "true") return true;
    if (last === "false") return false;
    if (segments > 1) return OPAQUE;
    if (this.lookup(last) !== undefined) return this.postfix(this.lookup(last));
    throw new Unparsed(last);
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

export interface Case {
  name: string;
  code: string;
  options?: unknown[];
  filename?: string;
  languageOptions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  /** The part of an `.oxlintrc.json` that the case is linted with, as it is written. */
  oxlintrc?: Record<string, unknown>;
  /** The path of the file as it is written, whatever its extension. */
  path?: string;
}

interface Stats {
  parsed: number;
  unparsed: number;
  upstream: number;
  duplicates: number;
  kept: number;
}

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const LANGUAGE_KEYS = new Set(["ecmaVersion", "sourceType", "globals", "parserOptions"]);

/** rulegen leaves the `languageOptions` of the upstream test in a comment behind the case. */
function languageOptionsIn(comment: string | undefined): Record<string, unknown> | undefined {
  const text = comment?.trim().replace(/,$/, "");
  if (!text?.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(text);
    if (isObject(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => LANGUAGE_KEYS.has(key))) {
      return value;
    }
  } catch {}
  return undefined;
}

export function casesOfFile(
  source: string,
  label: string,
  environments: Record<string, Record<string, unknown>>,
  stats: Stats,
  isTestFile: boolean,
): Case[] {
  const firstTest = isTestFile ? 0 : source.search(/#\[(?:test|cfg\(test\))\]/);
  if (firstTest < 0) return [];
  const { tokens, comments } = tokenizeRust(source);
  const lineStarts = [0];
  for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let [low, high] = [0, lineStarts.length];
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  };
  const cases: Case[] = [];

  // `let always = Some(json!(["always"]));` and `fn browser() -> Option<Value> { Some(json!({ .. })) }`.
  const bindings: { name: string; start: number; value: unknown }[] = [];
  const lookupBefore = (offset: number) => (name: string) =>
    bindings.findLast(it => it.name === name && it.start < offset)?.value;
  for (let i = 0; i + 3 < tokens.length; i++) {
    const keyword = tokens[i].text;
    if ((keyword !== "let" && keyword !== "fn") || tokens[i].kind !== "word" || tokens[i].start < firstTest) continue;
    const name = tokens[i + 1].text;
    let from = i + 2;
    const [open, close] = keyword === "let" ? ["=", ";"] : ["{", "}"];
    while (from < tokens.length && tokens[from].text !== open && tokens[from].text !== ";") from++;
    let to = ++from;
    for (let depth = 0; to < tokens.length; to++) {
      if (tokens[to].kind !== "punct") continue;
      if (depth === 0 && tokens[to].text === close) break;
      if ("([{".includes(tokens[to].text)) depth++;
      else if (")]}".includes(tokens[to].text)) depth--;
    }
    if (to - from > 400) continue;
    try {
      const parser = new Parser(tokens.slice(from, to), lookupBefore(tokens[i].start));
      const value = parser.expr();
      if (parser.at === to - from) bindings.push({ name, start: tokens[i].start, value });
    } catch (error) {
      if (!(error instanceof Unparsed)) throw error;
    }
  }

  for (let i = 0; i + 4 < tokens.length; i++) {
    if (tokens[i].text !== "let" || tokens[i].start < firstTest) continue;
    let at = i + 1;
    if (tokens[at].text === "mut") at++;
    const name = tokens[at].text;
    const list = /^_?(pass|fail|fix)/.exec(name)?.[1];
    if (!list) continue;
    // Over the type, if there is one.
    while (at < tokens.length && tokens[at].text !== "=" && tokens[at].text !== ";") at++;
    if (tokens[at + 1]?.text !== "vec" || tokens[at + 2]?.text !== "!" || tokens[at + 3]?.text !== "[") continue;
    at += 4;

    // `Tester::new(..).change_rule_path_extension("ts")`, in the same function.
    const nextTest = source.indexOf("#[test]", tokens[at].start);
    const rest = source.slice(tokens[at].start, nextTest < 0 ? undefined : nextTest);
    const extension = /\.change_rule_path_extension\("([\w.]+)"\)/.exec(rest)?.[1];
    const defaultName = extension && EXTENSIONS.test(`.${extension}`) ? `file.${extension}` : undefined;

    let depth = 0;
    let from = at;
    for (; at < tokens.length; at++) {
      const token = tokens[at];
      const isPunct = token.kind === "punct";
      if (isPunct && "([{".includes(token.text)) depth++;
      const isEnd = isPunct && token.text === "]" && depth === 0;
      if (isPunct && ")]}".includes(token.text)) depth--;
      if (!isEnd && !(isPunct && token.text === "," && depth === 0)) continue;
      if (at > from) {
        const lastLine = lineOf(token.start);
        const comment = comments.find(it => it.start > tokens[at - 1].end && lineOf(it.start) === lastLine);
        const where = `oxc ${label}:${lineOf(tokens[from].start)} ${list}`;
        try {
          const parser = new Parser(tokens.slice(from, at), lookupBefore(tokens[from].start));
          const value = parser.expr();
          if (parser.at !== at - from) throw new Unparsed("trailing tokens");
          const parts = Array.isArray(value) ? value : [value];
          if (typeof parts[0] !== "string") throw new Unparsed("the code is not a string");
          const [config, ...others] = parts.slice(list === "fix" ? 2 : 1);
          const made: Case = { name: where, code: parts[0] };
          if (config !== null && config !== undefined && config !== OPAQUE) {
            made.options = Array.isArray(config) ? config : [config];
          }
          const language: Record<string, unknown> = { ...languageOptionsIn(comment?.text) };
          if (defaultName) made.filename = defaultName;
          for (const other of others) {
            if (typeof other === "string") made.path = other;
            if (typeof other === "string" && EXTENSIONS.test(other)) made.filename = other;
            if (!isObject(other)) continue;
            made.oxlintrc = other;
            if (isObject(other.settings)) made.settings = other.settings;
            let globals: Record<string, unknown> = {};
            for (const [environment, isOn] of Object.entries(other.env ?? {})) {
              if (isOn) globals = { ...globals, ...environments[environment] };
            }
            globals = { ...globals, ...other.globals };
            if (Object.keys(globals).length > 0) language.globals = globals;
          }
          if (Object.keys(language).length > 0) made.languageOptions = language;
          cases.push(made);
          stats.parsed++;
        } catch (error) {
          if (!(error instanceof Unparsed)) throw error;
          stats.unparsed++;
        }
      }
      from = at + 1;
      if (isEnd) break;
    }
    i = at;
  }
  return cases;
}

function rustFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap(name => rustFiles(join(path, name)))
    .filter(file => file.endsWith(".rs"));
}

if (import.meta.main) {
  let oxc = "";
  let out = "";
  let fixtures = join(import.meta.dirname, "fixtures");
  const only: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--oxc") oxc = resolve(argv[++i]);
    else if (argv[i] === "--out") out = resolve(argv[++i]);
    else if (argv[i] === "--fixtures") fixtures = resolve(argv[++i]);
    else only.push(argv[i]);
  }
  if (!oxc || !out) {
    console.error("usage: bun extract-oxc.ts --oxc <oxc checkout> --out <dir> [--fixtures <dir>] [rule...]");
    process.exit(2);
  }
  // `env` in a test's configuration is a set of globals.
  const environments = process.env.ESLINT_DIR
    ? createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"))("globals")
    : {};

  const all: Record<string, Stats> = {};
  for (const [directory, plugin] of [
    ["eslint", "eslint"],
    ["typescript", "typescript-eslint"],
  ] as const) {
    const root = join(oxc, "crates/oxc_linter/src/rules", directory);
    for (const entry of readdirSync(root).sort()) {
      const rule = entry.replace(/\.rs$/, "").replaceAll("_", "-");
      const upstreamFile = join(fixtures, plugin, `${rule}.json`);
      if (!existsSync(upstreamFile) || (only.length > 0 && !only.includes(rule))) continue;
      const stats: Stats = { parsed: 0, unparsed: 0, upstream: 0, duplicates: 0, kept: 0 };
      const cases = rustFiles(join(root, entry)).flatMap(file =>
        casesOfFile(readFileSync(file, "utf8"), relative(root, file), environments, stats, /\/tests?[/.]/.test(file)),
      );
      const key = (code: string, options: unknown) => `${code}\0${JSON.stringify(options ?? [])}`;
      const seen = new Set(readJson<Fixture>(upstreamFile).cases.map(it => key(it.code, it.options)));
      const own = new Set<string>();
      const kept = cases.filter(it => {
        if (seen.has(key(it.code, it.options))) return (stats.upstream++, false);
        delete it.oxlintrc;
        delete it.path;
        const full = JSON.stringify({ ...it, name: undefined });
        if (own.has(full)) return (stats.duplicates++, false);
        own.add(full);
        return true;
      });
      stats.kept = kept.length;
      all[`${plugin}/${rule}`] = stats;
      if (kept.length === 0) continue;
      mkdirSync(join(out, plugin), { recursive: true });
      writeJson(join(out, plugin, `${rule}.json`), kept);
    }
  }
  mkdirSync(out, { recursive: true });
  writeJson(join(out, "stats.json"), all);
  const total = (field: keyof Stats) => Object.values(all).reduce((sum, it) => sum + it[field], 0);
  console.log(
    `${Object.keys(all).length} rules: ${total("parsed")} cases parsed, ${total("unparsed")} not, ` +
      `${total("upstream")} are upstream's, ${total("duplicates")} duplicates, ${total("kept")} kept`,
  );
}
