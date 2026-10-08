// Grammar-based differential fuzzer for calls and member chains.
//   bun calls.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> --seed=1 --count=3000 --ext=ts [--width=80] [--show=20]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (m) flags.set(m[1], m[2]);
}
const bin = flags.get("bin")!;
const ext = flags.get("ext") ?? "ts";
const count = Number(flags.get("count") ?? 2000);
const width = Number(flags.get("width") ?? 80);
const show = Number(flags.get("show") ?? 15);
let seed = Number(flags.get("seed") ?? 1);
const isTs = ext === "ts" || ext === "tsx";
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));

function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const names = [
  "a", "b", "x", "i", "z", "$", "_", "$$", "cb", "fn", "foo", "bar", "item", "this", "Object", "Promise", "wrapper", "result", "options",
  "expect", "somethingLong", "veryLongIdentifierName", "anotherVeryLongIdentifierNameHere", "React", "object", "it", "of", "db",
];
const props = [
  "a", "b", "then", "map", "filter", "catch", "length", "value", "prop", "find", "reduce", "forEach", "Foo", "toBe", "not",
  "someProperty", "aVeryLongPropertyNameForTesting", "anotherQuiteLongPropertyName", "get", "set", "x", "_private", "$el",
];
function ident() {
  return pick(names);
}
function literal(): string {
  return pick(["1", "0", "42", '"s"', '"a longer string literal"', "true", "null", "`t`", "`t${x}`", "/re/", "/longer-regex/g", "-1", "!a", "undefined", "1n"]);
}
function arrow(depth: number): string {
  const params = pick(["()", "(x)", "(a, b)", "({ a, b })", "([a, b])", "(x = 1)", "(...args)", isTs ? "(x: number)" : "(y)", isTs ? "<T,>(x: T)" : "(q)", isTs ? "(): void" : "()"]);
  const async = chance(0.15) ? "async " : "";
  const body = chance(0.4)
    ? pick(["{}", "{ return 1; }", `{ ${expr(depth + 1)}; }`, `{ return ${expr(depth + 1)}; }`])
    : pick([expr(depth + 1), expr(depth + 1), `(${object(depth + 1)})`, array(depth + 1), `${ident()} ? ${expr(depth + 1)} : ${expr(depth + 1)}`, arrow(depth + 1)]);
  return `${async}${params} => ${body}`;
}
function func(depth: number): string {
  const params = pick(["()", "(x)", "(a, b)", "({ a, b })", isTs ? "(this: Foo)" : "(z)", isTs ? "(x: number)" : "(y)"]);
  return `function ${chance(0.2) ? "name" : ""}${params} ${pick(["{}", "{ return 1; }", `{ ${expr(depth + 1)}; }`])}`;
}
function object(depth: number): string {
  const n = Math.floor(rnd() * 4);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(pick([`${pick(props)}: ${expr(depth + 1)}`, pick(props), `...${ident()}`, `[${ident()}]: 1`]));
  return `{${parts.join(", ")}}`;
}
function array(depth: number): string {
  const n = Math.floor(rnd() * 4);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(expr(depth + 1));
  return `[${parts.join(", ")}]`;
}
function args(depth: number): string {
  const n = pick([0, 0, 1, 1, 1, 2, 2, 3]);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push((depth <= 1 ? gap() : "") + arg(depth) + (depth <= 1 ? gap() : ""));
  return `(${parts.join(",")}${n === 0 && depth <= 1 ? gap() : ""})`;
}
function arg(depth: number): string {
  const r = rnd();
  if (depth > 3) return chance(0.5) ? ident() : literal();
  if (r < 0.25) return ident();
  if (r < 0.4) return literal();
  if (r < 0.58) return arrow(depth);
  if (r < 0.65) return func(depth);
  if (r < 0.73) return object(depth);
  if (r < 0.79) return array(depth);
  if (r < 0.82) return `...${ident()}`;
  if (r < 0.85 && isTs) return `${expr(depth + 1)} as ${pick(["T", "any", "string[]", "Foo<Bar>", "const"])}`;
  if (r < 0.88) return `${ident()} ${pick(["+", "&&", "||", "===", "??"])} ${expr(depth + 1)}`;
  if (r < 0.9) return `${ident()} ? ${ident()} : ${ident()}`;
  if (r < 0.92) return `await ${expr(depth + 1)}`;
  if (r < 0.94) return pick(["`line\nline`", "`\n  line ${x}\n`", "tag`\nline`", "{\n a: 1 }", "{\n}", "[\n1]"]);
  return expr(depth + 1);
}
const trivia = Number(flags.get("trivia") ?? 0);
function gap(): string {
  if (!chance(trivia)) return "";
  return pick(["\n", "\n\n", "\n  ", " /* c */ ", " // c\n", "\n// own\n", "\n/* own */\n", "\n\n// own\n", " /* c */\n", "\n\n\n"]);
}
function chain(depth: number): string {
  let s = pick([ident(), ident(), ident(), `${ident()}${args(depth + 1)}`, `(${ident()} || ${ident()})`, `new ${pick(["Foo", "a.B"])}${args(depth + 1)}`, `(await ${ident()})`, `import("x")`, literal(), array(depth + 1), "this", `(${ident()}?.${pick(props)})`, `(${ident()}?.${pick(props)}())`]);
  const n = 1 + Math.floor(rnd() * (depth > 1 ? 3 : 7));
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const opt = chance(0.1) ? "?" : "";
    if (depth === 0) {
      const g = gap();
      s += g;
    }
    if (r < 0.42) s += `${opt}.${pick(props)}`;
    else if (r < 0.8) s += `${opt ? "?." : ""}${isTs && chance(0.05) ? "<T>" : ""}${args(depth + 1)}`;
    else if (r < 0.85) s += `${opt ? "?." : ""}[${pick(["0", "1", "i", '"k"', ident(), expr(depth + 2)])}]`;
    else if (r < 0.9 && isTs) s += "!";
    else if (r < 0.92) s += "`tpl`";
    else s += `.${pick(props)}${args(depth + 1)}`;
  }
  return s;
}
function expr(depth: number): string {
  if (depth > 3) return chance(0.5) ? ident() : literal();
  const r = rnd();
  if (r < 0.7) return chain(depth);
  if (r < 0.8) return ident();
  if (r < 0.85) return literal();
  if (r < 0.9) return `new ${pick(["Foo", "a.b.C", "(foo())", "(a?.b)"])}${args(depth + 1)}`;
  if (r < 0.95) return `${ident()}${args(depth + 1)}${args(depth + 1)}`;
  if (r < 0.96) return pick([`useEffect(() => { ${expr(depth + 1)}; }, [${ident()}, ${ident()}])`, `useMemo(() => ${expr(depth + 1)}, [${ident()}])`, `useImperativeHandle(ref, () => { ${expr(depth + 1)}; }, [${ident()}])`, `require(${pick(['"x"', "x", '"a", b', "path.join(a, b)"])})`, `define([${literal()}], ${func(depth)})`, `compose(${arrow(depth + 1)}, ${arrow(depth + 1)})`, `connect(${ident()}, ${ident()}, ${ident()})(${ident()})`, `beforeEach(inject(${arrow(depth + 1)}))`, `import(${pick(['"x"', "x", '"x", { with: { type: "json" } }'])})`]);
  return `${pick(["it", "test", "describe", "it.only", "test.each", "beforeEach"])}(${pick(['"name"', "`name`", '"a very long name of a test that goes on and on and on and on and on"'])}, ${chance(0.5) ? arrow(depth) : func(depth)}${chance(0.1) ? ", 1000" : ""})`;
}
function statement(): string {
  const e = chain(0);
  const r = rnd();
  if (r < 0.35) return `${e};`;
  if (r < 0.5) return `const ${pick(["x", "someVariableName", "{ a, b }"])} = ${e};`;
  if (r < 0.6) return `${pick(["x", "this.x", "a.b.c", "someLongerVariableName", "module.exports"])} = ${e};`;
  if (r < 0.66) return `function f() { return ${e}; }`;
  if (r < 0.72) return `const f = ${chance(0.3) ? "async " : ""}() => ${e};`;
  if (r < 0.77) return `if (${e}) {}`;
  if (r < 0.82) return `x = { ${pick(props)}: ${e} };`;
  if (r < 0.86) return `async function f() { await ${e}; }`;
  if (r < 0.9) return `x = ${ident()} ? ${e} : ${chain(1)};`;
  if (r < 0.93) return `x = ${ident()} && ${e};`;
  if (r < 0.95) return `export default ${e};`;
  if (r < 0.96) return `class A { #p; @${pick(["dec", "a.b"])}${args(1)} m() { this.#p${pick(["", ".x", "()"])}.${pick(props)}${args(1)}.${pick(props)}${args(1)}; return ${e}; } }`;
  if (r < 0.97) return `x = \`a \${${e}} b\`;`;
  if (r < 0.985 && (ext === "tsx" || ext === "js")) return `x = <div a={${e}}>{${chain(1)}}</div>;`;
  return `for (const x of ${e}) {}`;
}

const statements: string[] = [];
for (let i = 0; i < count; i++) statements.push(statement());

// Keep only what Prettier accepts.
const dir = flags.get("dir")!;
mkdirSync(dir, { recursive: true });
const parser = isTs ? "typescript" : "babel";
const good: string[] = [];
const expected: string[] = [];
for (const s of statements) {
  try {
    expected.push(await prettier.format(s, { parser, printWidth: width, filepath: `case.${ext}` }));
    good.push(s);
  } catch {}
}
let failures = 0;
const file = `${dir}/case.${ext}`;
const chunk = 1;
for (let i = 0; i < good.length; i += chunk) {
  writeFileSync(file, good[i]);
  const proc = Bun.spawnSync({ cmd: [bin, "format", "file", file, `--printWidth=${width}`], stdout: "pipe", stderr: "pipe" });
  const actual = proc.stdout.toString();
  if (actual !== expected[i]) {
    failures++;
    if (failures <= show) {
      console.log(`### input\n${good[i]}\n--- expected\n${expected[i]}--- actual\n${actual}`);
    }
  }
}
console.log(`${good.length - failures}/${good.length} the same (seed ${flags.get("seed") ?? 1}, ${ext}, width ${width})`);
