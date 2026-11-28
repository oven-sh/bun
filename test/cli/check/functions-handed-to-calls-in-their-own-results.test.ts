// A call has its signature when its errors are reported. The errors of a call that no overload fits print what the function that is handed to it returns, and
// here that is the call itself. To infer the arguments for a type predicate, what that function returns is checked once more inside the call: printing came
// around to the second check, took it for a circle, told TS7023 and made the function return any.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] };

test.concurrent.each([
  [
    'export function f(a: number) { return ["a"].filter(f); }\nexport const q: never = f(1);\n',
    ["TS2769", "TS2322 string[]"],
  ],
  ['export const f = (a: number) => ["a"].filter(f);\nexport const q: never = f(1);\n', ["TS2769", "TS2322 string[]"]],
  [
    'export const o = { m(a: number) { return ["a"].filter(o.m); } };\nexport const q: never = o.m(1);\n',
    ["TS2769", "TS2322 string[]"],
  ],
  [
    'export class K { m(a: number) { return ["a"].filter(this.m); } }\nexport const q: never = new K().m(1);\n',
    ["TS2769", "TS2322 string[]"],
  ],
  [
    'export function f(a: number) { return [["a"].filter(f), 1]; }\nexport const q: never = f(1);\n',
    ["TS2769", "TS2322 (number | string[])[]"],
  ],
  [
    'export function f(a: number) { return ["a"].filter(g); }\nexport function g(a: number) { return ["a"].filter(f); }\nexport const q: never = f(1);\n',
    ["TS2769", "TS2769", "TS2322 string[]"],
  ],
  [
    'export const q: never = g(1);\nexport function g(a: number) { return () => [2n].map(f)[0]; }\nexport function f(a: number) { return ["a"].filter(f); }\n',
    ["TS2322 () => string[]", "TS2345", "TS2769"],
  ],
] as const)("%s", async (program, expected) => {
  using dir = tempDir("check-functions-handed-to-calls", {
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "a.ts": program,
  });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const told = [...stdout.matchAll(/^a\.ts.*error (TS\d+): (?:Type '(.*)' is not assignable to type 'never')?/gm)];
  expect(told.map(it => (it[2] ? `${it[1]} ${it[2]}` : it[1])).sort()).toEqual([...expected].sort());
});
