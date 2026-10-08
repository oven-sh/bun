// Differential fuzzer for experimentalTernaries.  bun ternaries.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> --seed=1 --count=2000 --ext=ts --width=80 [--tabs=1] [--tabWidth=4]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) { const m = /^--([\w-]+)=(.*)$/s.exec(arg); if (m) flags.set(m[1], m[2]); }
const bin = flags.get("bin")!, ext = flags.get("ext") ?? "ts", count = Number(flags.get("count") ?? 2000), width = Number(flags.get("width") ?? 80), show = Number(flags.get("show") ?? 10);
const useTabs = flags.get("tabs") === "1", tabWidth = Number(flags.get("tabWidth") ?? 2);
let seed = Number(flags.get("seed") ?? 1);
const isTs = ext.startsWith("ts"), isJsx = ext === "tsx" || ext === "js";
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const ids = ["a", "b", "x", "foo", "isBird", "someCondition", "aVeryLongConditionNameThatGoesOnAndOn", "value", "result", "this", "null", "undefined", "props.value", "a.b.c", "fn()", "i"];
function simple(d: number): string {
  return pick([pick(ids), pick(ids), '"str"', '"a much longer string literal that takes space"', "1", "`t`", "-1", "!x", "foo(a, b)", "foo.bar(baz)", "a?.b", "a!", "[1, 2]", "{ a: 1 }", "() => x", "a + b", "a && b", "a || b || c", "a === b", "typeof x", "await y", "new Foo()", "someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree)", "{ a: 1, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: 2, cccccccccccccccccccccccccccc: 3, dddddddddddd: 4 }", "a.b().c().d()", isJsx ? "<div />" : "q", isJsx ? "<div>text {x}</div>" : "w", isTs && !isJsx ? "x as T" : "z"].filter(s => isTs || !/!$| as /.test(s)));
}
function tern(d: number): string {
  const t = chance(0.12) && d < 2 ? `(${tern(d + 1)})` : simple(d);
  const c = chance(0.25) && d < 3 ? tern(d + 1) : simple(d);
  const a = chance(0.4) && d < 3 ? tern(d + 1) : simple(d);
  return `${t} ? ${c} : ${a}`;
}
const tys = ["A", "B", "string", "number", "T", "Foo<T>", "{ a: string }", "T[]", "infer U", "A | B", "SomeVeryLongTypeNameThatGoesOnAndOnAndOn<WithArguments, AndMore>", "(a: A) => B", "keyof T", "[A, B]", "never"];
function ty(d: number): string { return pick(tys); }
function ctype(d: number): string {
  const check = chance(0.08) && d < 2 ? `(${ctype(d + 1)})` : pick(tys.filter(t => !t.startsWith("infer") && !t.startsWith("(")));
  const ext_ = chance(0.08) && d < 2 ? `(${ctype(d + 1)})` : ty(d);
  const c = chance(0.25) && d < 3 ? ctype(d + 1) : pick(tys.filter(t => !t.startsWith("infer")));
  const a = chance(0.4) && d < 3 ? ctype(d + 1) : pick(tys.filter(t => !t.startsWith("infer")));
  return `${check} extends ${ext_} ? ${c} : ${a}`;
}
function statement(): string {
  const e = tern(0), r = rnd();
  if (isTs && r < 0.15) return pick([`type X<T> = ${ctype(0)};`, `function f<T>(x: ${ctype(0)}): ${ctype(1)} {}`, `type X = Foo<${ctype(0)}>;`, `type X = { a: ${ctype(0)} };`, `type X = (${ctype(0)})[];`, `let x: ${ctype(0)};`, `type X = A | (${ctype(1)});`]);
  if (r < 0.25) return `${e};`;
  if (r < 0.4) return `const ${pick(["x", "someVariableName", "{ a, b }", "aVeryLongVariableNameThatTakesALotOfSpaceOnTheLineeeeeeeeeeeeeeeeeeeeeeeeeeeee"])} = ${e};`;
  if (r < 0.48) return `${pick(["x", "this.x", "a.b.c"])} ${pick(["=", "+=", "??="])} ${e};`;
  if (r < 0.56) return `function f() { ${pick(["return", "throw"])} ${e}; }`;
  if (r < 0.62) return `const f = () => ${e};`;
  if (r < 0.68) return `foo(${chance(0.5) ? "a, " : ""}${e}${chance(0.3) ? ", b" : ""});`;
  if (r < 0.73) return `x = { ${pick(["a", "someLongKey", '"k"', "[c]"])}: ${e} };`;
  if (r < 0.78) return `(${e}).${pick(["foo", "foo()", "foo.bar()", "a.b.c"])};`;
  if (r < 0.81) return `x = (${e})${pick([".foo", ".foo()", "()", "[0]", isTs ? "!" : ".y"])};`;
  if (r < 0.84) return `function f() { return (${e}).foo(); }`;
  if (r < 0.87) return `x = [${e}, ${simple(0)}];`;
  if (r < 0.9) return `class A { p = ${e}; static q = ${simple(0)}; }`;
  if (r < 0.93) return `x = ${pick(["!", "await ", "typeof ", "..."].slice(0, 3))}(${e});`;
  if (r < 0.95) return `x = a + (${e});`;
  if (isJsx && r < 0.99) return pick([`x = <div>{${e}}</div>;`, `x = <div a={${e}} />;`, `x = <div>text {${e}} more</div>;`, `x = <A b={${e}}>{${tern(1)}}</A>;`]);
  return `if (${e}) {}`;
}
const dir = flags.get("dir")!; mkdirSync(dir, { recursive: true });
const parser = isTs ? "typescript" : "babel";
let failures = 0, total = 0;
const file = `${dir}/caset.${ext}`;
for (let i = 0; i < count; i++) {
  const s = statement();
  let expected: string;
  try { expected = await prettier.format(s, { parser, printWidth: width, filepath: `case.${ext}`, experimentalTernaries: true, useTabs, tabWidth }); } catch { continue; }
  total++;
  writeFileSync(file, s);
  const proc = Bun.spawnSync({ cmd: [bin, "format", "file", file, `--printWidth=${width}`, "--experimentalTernaries=true", `--useTabs=${useTabs}`, `--tabWidth=${tabWidth}`], stdout: "pipe", stderr: "pipe" });
  const actual = proc.stdout.toString();
  if (actual !== expected) { failures++; if (failures <= show) console.log(`### input\n${s}\n--- expected\n${expected}--- actual\n${actual}`); }
}
console.log(`${total - failures}/${total} the same (seed ${flags.get("seed") ?? 1}, ${ext}, width ${width}, tabs ${useTabs}, tabWidth ${tabWidth})`);
