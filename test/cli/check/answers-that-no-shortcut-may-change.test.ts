import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

async function check(source: string) {
  using dir = tempDir("check-answers-that-no-shortcut-may-change", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return stdout + stderr;
}

const typeOfList = async (source: string) =>
  /Type '(.*)' is not assignable to type 'number'/.exec(await check("export {};\n" + source))?.[1];

test.each([
  [
    "a template literal type is a subtype of another",
    "class Holder { x = 1 }\ndeclare const a: Holder, p: `id-${string}`, q: `id-${number}`;\nconst n: number = [a, p, q];",
    "(Holder | `id-${string}`)[]",
  ],
  [
    "a template literal type has what the class asks for",
    "class Long { readonly length: number = 0 }\ndeclare const l: Long, p: `id-${string}`;\nconst n: number = [l, p];",
    "Long[]",
  ],
  [
    "a mapped text is a subtype of another",
    "class Holder { x = 1 }\ndeclare const a: Holder, p: Uppercase<string>, q: Uppercase<`id-${string}`>;\nconst n: number = [a, p, q];",
    "(Holder | Uppercase<string>)[]",
  ],
  [
    "texts and numbers beside a class stay",
    'class Holder { x = 1 }\ndeclare const a: Holder, p: "one", q: 2;\nconst n: number = [a, p, q];',
    '("one" | 2 | Holder)[]',
  ],
])("beside a class, %s", async (_, source, expected) => {
  expect(await typeOfList(source)).toBe(expected);
});

const rows = (count: number, from: number) =>
  Array.from({ length: count }, (_, index) => `  if (c()) v = ${from + index};\n`).join("");
const aroundLoop = (above: number, below: number) =>
  `export {};\ndeclare function c(): boolean;\nfunction f(x: { a: number }) {\n  let v = 0;\n${rows(above, 1)}  while (c()) {}\n  x;\n${rows(below, 5000)}  x;\n}\n`;

test(
  "a reference below a loop ends its walk where the reference above left its type",
  async () => {
    expect({
      together: (await check(aroundLoop(1400, 800))).includes("TS2563"),
      below: (await check(aroundLoop(1400, 2005))).includes("TS2563"),
    }).toEqual({ together: false, below: true });
  },
  longLimit,
);

const stores = (count: number, target: string) =>
  Array.from({ length: count }, (_, index) => `  ${target} = ${index};\n`).join("");
const typesHeldAgainstNever = async (source: string) =>
  Array.from(
    (
      await check(
        'export {};\nconst K = "a";\ndeclare const p: string;\ndeclare function any(): boolean;\n' +
          "type T = { a: number; [k: string]: number };\ndeclare const o: T;\n" +
          source,
      )
    ).matchAll(/Type '(.*)' is not assignable to type 'never'/g),
    match => match[1],
  );

test.each<[string, (count: number) => string, string[]]>([
  [
    "it was given a value",
    count => `let u: T | undefined;\nu = { a: 1 };\n${stores(count, "u[K]")}const r: never = u;\n`,
    ["T"],
  ],
  [
    "it was tested",
    count =>
      `function f(v: T | undefined) {\n  if (!v) return;\n${stores(count, "v[p]")}${stores(count, "v[K]")}  const r: never = v;\n}\n`,
    ["T"],
  ],
  [
    "it is stored to in between",
    count =>
      `let u: T | undefined = any() ? { a: 1 } : undefined;\nif (u) {\n${stores(count, "u[K]")}  const r1: never = u;\n  u = undefined;\n` +
      `${stores(count, "o[K]")}  const r2: never = u;\n  u = { a: 2 };\n${stores(count, "u[p]")}  const r3: never = u;\n}\n`,
    ["T", "undefined", "T"],
  ],
  [
    "a for-in runs over a member of it that may be missing",
    count =>
      `function f(v: { a?: object; [k: string]: unknown } | null) {\n  for (const k in v?.a) {\n${stores(count, "v[K]")}${stores(count, "v[p]")}    const r1: never = v;\n  }\n  const r2: never = v;\n}\n`,
    [
      "{ [k: string]: unknown; a?: object | undefined; }",
      "{ [k: string]: unknown; a?: object | undefined; } | null",
      "null",
    ],
  ],
  [
    "it is added to in between",
    count =>
      `function f() {\n  let c: number | string = 0;\n  c += 1;\n${stores(count, "o[K]")}  c += 1;\n${stores(count, "o[p]")}  c++;\n  const r: never = c;\n}\n`,
    ["number"],
  ],
  [
    "a member of it is read behind them",
    count =>
      `function f(v: { a: number | string; [k: string]: number | string }) {\n  v.a = 1;\n${stores(count, "v[p]")}  const r1: never = v.a;\n  v[K] = "s";\n` +
      `${stores(count, "o[p]")}  const r2: never = v.a;\n  const r3: never = v;\n}\n`,
    ["number", "string", "{ [k: string]: string | number; a: string | number; }"],
  ],
])(
  "behind many stores under keys a name has the type that it has behind one, where %s",
  async (_, source, expected) => {
    expect({
      behindOne: await typesHeldAgainstNever(source(1)),
      behindMany: await typesHeldAgainstNever(source(100)),
    }).toEqual({
      behindOne: expected,
      behindMany: expected,
    });
  },
);

test.each([
  ["a written name stands in front of a constant key", "class C { a() {} [K]() {} }", 2],
  ["a constant key stands in front of a written name", "class C { [K]() {} a() {} }", 2],
  ["a written name stands between two constant keys", "class C { [K]() {} a() {} [K]() {} }", 3],
  ["all three stand under one constant key", "class C { [K]() {} [K]() {} [K]() {} }", 3],
  ["two are static and two are not", "class C { static [K]() {} [K]() {} static [K]() {} [K]() {} }", 4],
  ["another key stands between them", "class C { [K]() {} [L]() {} [K]() {} [L]() {} }", 4],
])("every function with a body under one name is called a duplicate, where %s", async (_, source, count) => {
  const printed = await check(`export {};\nconst K = "a";\nconst L = "b";\n${source}\n`);
  expect(printed.match(/error TS2393/g)?.length).toBe(count);
});
