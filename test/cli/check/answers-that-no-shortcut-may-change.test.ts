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
