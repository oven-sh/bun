// Grammar-based differential fuzzer for the expressions of Angular templates: bindings, actions, interpolations,
// `*directive` microsyntax, the parameters of blocks and `@let`.
//   bun angular-expressions.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files>
//     [--seed=1] [--count=3000] [--show=20] [--mutate=0.15] [--only=binding,action,..] [--out=<file for the inputs that differ>] [--depth=0..4] [--trace=<file>]
// Every input is formatted with each of `optionSets`.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (m) flags.set(m[1], m[2]);
}
const bin = flags.get("bin")!;
const count = Number(flags.get("count") ?? 3000);
const show = Number(flags.get("show") ?? 20);
const mutate = Number(flags.get("mutate") ?? 0.15);
const only = flags.get("only")?.split(",");
const out = flags.get("out");
// The input that is being formatted, for when that does not end.
const trace = flags.get("trace");
// The deeper the expressions start, the smaller they are.
const base = Number(flags.get("depth") ?? 0);
let seed = Number(flags.get("seed") ?? 1);

// Angular's parser does not come to an end for some inputs with errors, so Prettier is in a process of its own: this
// file with `--serve`, which answers each line of JSON with a line of JSON.
if (flags.has("serve")) {
  const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
  for await (const line of console) {
    const { input, options } = JSON.parse(line);
    const answer = await prettier.format(input, { ...options, parser: "angular" }).catch(() => null);
    process.stdout.write(JSON.stringify(answer) + "\n");
  }
  process.exit(0);
}

const optionSets: Record<string, unknown>[] = [
  {},
  { printWidth: 40 },
  { printWidth: 20, trailingComma: "none" },
  { printWidth: 60, singleQuote: true, bracketSpacing: false, arrowParens: "avoid", trailingComma: "es5" },
  { printWidth: 30, experimentalTernaries: true, useTabs: true, quoteProps: "consistent" },
  {
    printWidth: 50,
    experimentalOperatorPosition: "start",
    objectWrap: "collapse",
    quoteProps: "preserve",
    semi: false,
  },
];

function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const upTo = (n: number) => Math.floor(rnd() * (n + 1));

const names = [
  "a",
  "b",
  "c",
  "x",
  "i",
  "$",
  "_",
  "$any",
  "fn",
  "foo",
  "bar",
  "item",
  "items",
  "value",
  "Object",
  "user",
  "result",
  "options",
  "somethingLong",
  "veryLongIdentifierName",
  "anotherVeryLongIdentifierNameHere",
  "Boolean",
  "it",
  "of",
  "async",
  "type",
  "get",
  "set",
];
const oddNames = [
  "class",
  "new",
  "delete",
  "function",
  "default",
  "for",
  "import",
  "enum",
  "package",
  "interface",
  "private",
  "public",
  "static",
  "await",
  "yield",
  "arguments",
  "eval",
  "super",
  "const",
  "return",
  "while",
  "do",
  "satisfies",
  "module",
  "using",
  "NaN",
  "Infinity",
];
const keywords = [
  "var",
  "let",
  "as",
  "null",
  "undefined",
  "true",
  "false",
  "if",
  "else",
  "this",
  "typeof",
  "void",
  "in",
  "instanceof",
];
const pipes = [
  "async",
  "date",
  "json",
  "translate",
  "uppercase",
  "slice",
  "aVeryLongPipeNameForTesting",
  "p",
  "keyvalue",
  "number",
];

/// What kind of expression is made.
type Context = { pipes: boolean; assignments: boolean; quote: string };

const ident = () => (chance(0.03) ? pick(oddNames) : pick(names));
const property = () => (chance(0.06) ? pick([...oddNames, ...keywords]) : pick(names));
const gap = () => (chance(0.9) ? "" : pick([" ", "  ", "\n", " \n ", "\n\n", "\t"]));
const space = () => (chance(0.85) ? " " : pick(["", "", "  ", "\n", "\n  ", "\n\n"]));

function string(c: Context): string {
  const content = pick([
    "",
    "s",
    "a longer string literal",
    "it\\'s",
    "x y",
    "\\n",
    "\\u0041",
    "é",
    "a-b",
    "{{",
    "}}",
    "//",
    "`",
    "$",
    "\\\\",
    "a\nb",
    "\\x4",
    "\\01",
    "\\8",
    "\\\n",
    "\\é",
    "\\a\\b",
  ]);
  const r = rnd();
  if (r < 0.75) return `'${content}'`;
  return `${c.quote}${content.replaceAll("\\'", "'")}${c.quote}`;
}
function number(): string {
  return pick([
    "0",
    "1",
    "42",
    "1.5",
    ".5",
    "1e3",
    "1E3",
    "1_000",
    "0.50",
    "1.0",
    "5.",
    "1e+3",
    "1.5e-10",
    "0.0",
    "10",
    "123456789012",
    "01",
    "00.10",
    "1.2.3",
    "1.20.",
    "1e2e3",
    "1e2.50",
    "0_1",
    "1.",
    "1.e5",
    "0.0e0",
    "1..",
  ]);
}
function template(depth: number, c: Context): string {
  const n = upTo(2);
  let s = "`" + pick(["", "t", "some text ", "\\`", "$", "a\nb"]);
  for (let i = 0; i < n; i++) s += "${" + gap() + expr(depth + 1, c) + gap() + "}" + pick(["", " ", "text", "-"]);
  return s + "`";
}
function regex(): string {
  return pick(["/re/", "/a|b/g", "/[/]/", "/\\//", "/longer-regex/gi", "/\\d+/u", "/x/yg", "/(?<n>a)/d"]);
}
function literal(depth: number, c: Context): string {
  const r = rnd();
  if (r < 0.3) return number();
  if (r < 0.65) return string(c);
  if (r < 0.8) return pick(["true", "false", "null", "undefined", "this"]);
  if (r < 0.93) return template(depth, c);
  return regex();
}
function list(depth: number, c: Context, max: number, spread: boolean): string[] {
  const parts: string[] = [];
  for (let n = pick([0, 1, 1, 2, 2, 3, max]); n > 0; n--)
    parts.push((spread && chance(0.1) ? "..." : "") + pipe(depth + 1, c));
  return parts;
}
function args(depth: number, c: Context): string {
  return `(${gap()}${list(depth, c, 4, true).join("," + space())}${gap()})`;
}
function array(depth: number, c: Context): string {
  const parts = list(depth, c, 5, true);
  return `[${gap()}${parts.join("," + space())}${parts.length > 0 && chance(0.1) ? "," : ""}${gap()}]`;
}
function object(depth: number, c: Context): string {
  const parts: string[] = [];
  for (let n = pick([0, 1, 1, 2, 2, 3, 4]); n > 0; n--) {
    const r = rnd();
    if (r < 0.55) parts.push(`${property()}${gap()}:${space()}${pipe(depth + 1, c)}`);
    else if (r < 0.75) parts.push(`${pick([string(c), "'a'", "'a-b'", "'1'", "'b'"])}:${space()}${pipe(depth + 1, c)}`);
    else if (r < 0.9) parts.push(chance(0.1) ? pick(keywords) : ident());
    else parts.push(`...${pipe(depth + 1, c)}`);
  }
  return `{${gap()}${parts.join("," + space())}${parts.length > 0 && chance(0.1) ? "," : ""}${gap()}}`;
}
function arrow(depth: number, c: Context): string {
  const params = pick(["()", "(x)", "(a, b)", "x", "item", "(a,b,c)", "( x )", ident()]);
  const inner = { ...c, pipes: false, assignments: true };
  const body = chance(0.15) ? `(${object(depth + 1, inner)})` : expr(depth + 1, inner);
  return `${params}${space()}=>${space()}${body}`;
}
function primary(depth: number, c: Context): string {
  const r = rnd();
  if (depth > 4 || r < 0.4) return ident();
  if (r < 0.6) return literal(depth, c);
  if (r < 0.7) return array(depth, c);
  if (r < 0.8) return object(depth, c);
  return `(${gap()}${pipe(depth + 1, c)}${gap()})`;
}
function chain(depth: number, c: Context): string {
  if (depth > 5) return ident();
  let s = primary(depth, c);
  for (let n = pick([0, 0, 0, 1, 1, 2, 3, 5]); n > 0; n--) {
    const r = rnd();
    const safe = chance(0.2);
    if (r < 0.4) s += `${gap()}${safe ? "?." : "."}${gap()}${property()}`;
    else if (r < 0.7) s += `${safe ? "?." : ""}${args(depth + 1, c)}`;
    else if (r < 0.82) s += `${safe ? "?." : ""}[${gap()}${pipe(depth + 2, c)}${gap()}]`;
    else if (r < 0.92) s += "!";
    else if (r < 0.95) s += template(depth + 1, c);
    else s = `(${s})`;
  }
  return s;
}
const binaryOperators = [
  "||",
  "||",
  "&&",
  "&&",
  "??",
  "??",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "instanceof",
  "+",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
];
function expr(depth: number, c: Context): string {
  if (depth > 4) return chain(depth, c);
  const r = rnd();
  if (r < 0.45) return chain(depth, c);
  if (r < 0.7) {
    let s = expr(depth + 1, c);
    const same = chance(0.5) ? pick(binaryOperators) : undefined;
    for (let n = pick([1, 1, 1, 2, 3, 5]); n > 0; n--) {
      const operator = same ?? pick(binaryOperators);
      const blank = /\w/.test(operator) ? " " : space();
      s += `${blank}${operator}${blank}${expr(depth + 2, c)}`;
    }
    return s;
  }
  if (r < 0.78) return `${pick(["!", "!", "-", "+", "typeof ", "void ", "!!", "- ", "--", "-+"])}${expr(depth + 1, c)}`;
  if (r < 0.88)
    return `${expr(depth + 1, c)}${space()}?${space()}${pipe(depth + 1, c)}${space()}:${space()}${pipe(depth + 1, c)}`;
  if (r < 0.93) return arrow(depth, c);
  if (r < 0.97 && c.assignments) {
    const target = chance(0.5)
      ? `${chain(depth + 2, c)}.${property()}`
      : chance(0.5)
        ? ident()
        : `${chain(depth + 2, c)}[${expr(depth + 2, c)}]`;
    return `${target}${space()}${pick(["=", "=", "=", "+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??="])}${space()}${expr(depth + 1, c)}`;
  }
  return `(${pipe(depth + 1, c)})`;
}
function pipe(depth: number, c: Context): string {
  let s = expr(depth, c);
  if (!c.pipes) return s;
  for (let n = pick([0, 0, 0, 0, 0, 1, 1, 2, 3]); n > 0; n--) {
    s += `${space()}|${space()}${chance(0.04) ? pick([...keywords, ...oddNames]) : pick(pipes)}`;
    for (let m = pick([0, 0, 1, 1, 2, 3]); m > 0; m--) s += `${gap()}:${gap()}${expr(depth + 1, c)}`;
  }
  return s;
}
function comment(): string {
  return chance(0.04)
    ? pick([
        " // comment",
        "// c ",
        "\n// own line",
        "\n\n  // after an empty line",
        " // prettier-ignore",
        " //",
        " // a\n b",
      ])
    : "";
}
function action(c: Context): string {
  const parts: string[] = [];
  for (let n = pick([1, 1, 1, 2, 2, 3]); n > 0; n--) parts.push(expr(base + 1, c));
  return parts.join(pick([";", "; ", ";\n", ";;", " ; "])) + (chance(0.15) ? ";" : "");
}
const keys = [
  "of",
  "track",
  "then",
  "else",
  "as",
  "trackBy",
  "let",
  "index",
  "key",
  "Of",
  "a-b",
  "a-bc",
  "'s'",
  "'a b'",
  "if",
  "when",
  "prefix",
];
function microsyntax(c: Context): string {
  const parts: string[] = [];
  const r = rnd();
  if (r < 0.35) parts.push(pipe(base + 1, c) + (chance(0.25) ? ` as ${pick(names)}` : ""));
  else if (r < 0.75) parts.push(`let ${pick(names)}`, `of ${pipe(base + 1, c)}` + (chance(0.15) ? ` as ${pick(names)}` : ""));
  for (let n = pick([0, 0, 1, 1, 2, 3]); n > 0; n--) {
    const r = rnd();
    if (r < 0.2)
      parts.push(
        `let ${pick([...names, ...keys])}${chance(0.6) ? `${space()}=${space()}${pick([...names, ...keys, "$implicit"])}` : ""}`,
      );
    else if (r < 0.35) parts.push(`${pick([...names, ...keys])} as ${pick(names)}`);
    else if (r < 0.9)
      parts.push(
        `${pick(keys)}${pick([" ", ": ", ":", " : "])}${pipe(base + 1, c)}${chance(0.15) ? ` as ${pick(names)}` : ""}`,
      );
    else parts.push(pick(keys));
  }
  let s = "";
  for (const [index, part] of parts.entries())
    s += (index === 0 ? "" : pick(["; ", "; ", ";", ", ", " ", "\n"])) + part;
  return s + (chance(0.1) ? ";" : "");
}

const soup = [
  ..."()[]{},:;.?!|&=<>+-*/%^#@`'".split(""),
  "?.",
  "??",
  "=>",
  "...",
  "||",
  "&&",
  "**",
  "==",
  "!==",
  "${",
  "//",
  "/*",
  " ",
  "\n",
  "a",
  "1",
  "'s'",
  "let",
  "as",
  "of",
  "typeof",
  "in",
  "{{",
  "}}",
  "1.",
  "..",
  "\\",
  "é",
  " ",
  "0x1",
  "1n",
  "new ",
  "<!--",
  "--",
  "++",
];
function mutated(s: string): string {
  for (let n = pick([1, 1, 2, 3]); n > 0; n--) {
    const at = upTo(s.length);
    const r = rnd();
    if (r < 0.4) s = s.slice(0, at) + pick(soup) + s.slice(at);
    else if (r < 0.7) s = s.slice(0, at) + s.slice(at + 1 + upTo(2));
    else if (r < 0.85) s = s.slice(0, at) + pick(soup) + s.slice(at + 1);
    else s = s.slice(0, at) + s.slice(at, at + 1 + upTo(3)) + s.slice(at);
  }
  return s;
}

const inAttribute: Context = { pipes: true, assignments: false, quote: "&quot;" };
const inText: Context = { pipes: true, assignments: false, quote: '"' };
const kinds: Record<string, () => [string, string, string]> = {
  binding: () => [
    `<a ${pick(["[x]", "[x]", "[(x)]", "bind-x", "bindon-x", "ng-if", "[class.a]", "[someLongerInputName]"])}="`,
    pipe(base, inAttribute) + comment(),
    `"></a>`,
  ],
  action: () => [
    `<a ${pick(["(x)", "(x)", "on-x", "(someLongerOutputName)"])}="`,
    action({ ...inAttribute, pipes: false, assignments: true }) + comment(),
    `"></a>`,
  ],
  directive: () => [`<a ${pick(["*x", "*ngIf", "*ngFor"])}="`, microsyntax(inAttribute), `"></a>`],
  interpolation: () => [pick(["{{", "{{ ", "<b>{{", "text {{ "]), pipe(base, inText) + comment(), pick(["}}", " }}"])],
  attribute: () => [
    `<a x="${pick(["", "a ", "{{ b }} ", "{{ }}", "a\n  {{\n}} "])}{{`,
    pipe(base, inAttribute),
    `}}${pick(["", " c"])}"></a>`,
  ],
  i18n: () => {
    const words: string[] = [];
    for (let n = upTo(14); n > 0; n--) words.push(pick([...names, "|", "@@id", "{{ a }}", "&quot;", "meaning|description"]));
    const value = gap() + words.map(word => word + pick([" ", " ", " ", "  ", "\n", "\n\n  "])).join("");
    return [`<${pick(["a", "a", "pre", "textarea", "p"])} ${pick(["i18n", "i18n-title", "i18n-a.b", "i18n-"])}="`, value, `">`];
  },
  if: () => [`@if (`, microsyntax(inText), `) {}`],
  for: () => [
    `@for (`,
    chance(0.5)
      ? microsyntax(inText)
      : `item of ${pipe(base + 1, inText)}; track ${pipe(base + 1, inText)}${chance(0.3) ? "; let i = $index" : ""}`,
    `) {}`,
  ],
  switch: () => [`@switch (`, pipe(base, inText), `) { @case (${pipe(base + 1, inText)}) {} }`],
  let: () => [`@let a = `, pipe(base, inText) + comment(), `;`],
};
const kindNames = Object.keys(kinds).filter(name => !only || only.includes(name));

/// `bun-lint format serve` with a set of options.
class Server {
  proc;
  reader;
  buffer = new Uint8Array(0);
  constructor(options: Record<string, unknown>) {
    const args = Object.entries(options).map(([name, value]) => `--${name}=${value}`);
    this.proc = Bun.spawn({ cmd: [bin, "format", "serve", ...args], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = this.proc.stdout.getReader();
  }
  async more() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error("the formatter has ended");
    const joined = new Uint8Array(this.buffer.length + value.length);
    joined.set(this.buffer);
    joined.set(value, this.buffer.length);
    this.buffer = joined;
  }
  async format(path: string): Promise<string> {
    this.proc.stdin.write(path + "\n");
    this.proc.stdin.flush();
    let end;
    while ((end = this.buffer.indexOf(10)) < 0) await this.more();
    const head = new TextDecoder().decode(this.buffer.subarray(0, end));
    this.buffer = this.buffer.subarray(end + 1);
    if (!head.startsWith("ok ")) return head;
    const length = Number(head.slice(3));
    while (this.buffer.length < length) await this.more();
    const text = new TextDecoder().decode(this.buffer.subarray(0, length));
    this.buffer = this.buffer.subarray(length);
    return text;
  }
}

/// Prettier. `undefined`: it has not answered in time. `null`: it has refused the input.
class Prettier {
  proc;
  lines;
  constructor() {
    const cmd = [process.execPath, import.meta.path, "--serve=1", `--prettier=${flags.get("prettier")}`];
    this.proc = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.lines = this.read();
  }
  async *read() {
    let rest = "";
    const decoder = new TextDecoder();
    for await (const chunk of this.proc.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      for (let end; (end = rest.indexOf("\n")) >= 0; rest = rest.slice(end + 1)) yield rest.slice(0, end);
    }
  }
  async format(input: string, options: Record<string, unknown>): Promise<string | null | undefined> {
    this.proc.stdin.write(JSON.stringify({ input, options }) + "\n");
    this.proc.stdin.flush();
    let timer;
    const late = new Promise<undefined>(done => (timer = setTimeout(done, 3000)));
    const answer = await Promise.race([this.lines.next(), late]);
    clearTimeout(timer);
    return answer?.done === false ? JSON.parse(answer.value) : undefined;
  }
}

const dir = mkdtempSync(join(flags.get("dir")!, "angular-expressions-"));
const file = join(dir, "case.component.html");
let servers = optionSets.map(options => new Server(options));
let prettier = new Prettier();
let endless = 0;
let cases = 0;
let failures = 0;
let unformatted = 0;
const perKind = new Map<string, [number, number]>();
try {
  for (let i = 0; i < count; i++) {
    const kind = pick(kindNames);
    let [before, code, after] = kinds[kind]();
    if (chance(mutate)) code = mutated(code);
    // Prettier takes very long for what is very long.
    if (code.length > 1000) continue;
    const input = before + code + after + "\n";
    writeFileSync(file, input);
    if (trace) writeFileSync(trace, input);
    let differs = false;
    for (const [index, options] of optionSets.entries()) {
      const expected = await prettier.format(input, options);
      if (expected === undefined) {
        prettier.proc.kill(9);
        prettier = new Prettier();
        endless++;
        break;
      }
      // The HTML around the expression is broken.
      if (expected === null) break;
      cases++;
      if (index === 0 && expected.includes(code.trim()) && /\s{2}|\n/.test(code.trim())) unformatted++;
      let actual: string;
      try {
        actual = await servers[index].format(file);
      } catch (error) {
        actual = String(error);
        servers[index] = new Server(options);
      }
      const tally = perKind.get(kind) ?? [0, 0];
      perKind.set(kind, tally);
      tally[1]++;
      if (actual === expected) continue;
      tally[0]++;
      failures++;
      if (!differs && out) appendFileSync(out, JSON.stringify({ input, options }) + "\n");
      if (!differs && failures <= show * optionSets.length) {
        console.log(`### ${kind} ${JSON.stringify(options)}\n${input}--- expected\n${expected}--- actual\n${actual}`);
      }
      differs = true;
    }
  }
} finally {
  for (const server of servers) server.proc.kill();
  prettier.proc.kill();
  rmSync(dir, { recursive: true, force: true });
}
for (const [kind, [failed, all]] of perKind) console.log(`${kind}: ${all - failed}/${all}`);
console.log(
  `${cases - failures}/${cases} the same (seed ${flags.get("seed") ?? 1}, ${count} inputs, ${unformatted} probably left as they are, ${endless} without an answer from Prettier)`,
);
