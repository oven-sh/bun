// What a spread takes from a class has the class's own `prototype`, which no declaration file writes out: what is private in an instance was an error (TS4094) all
// the same. A spread that is `readonly` has a copy. The errors are those of TypeScript 7.0.2.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = { strict: true, noEmit: true, declaration: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] };

const programs: [string, string[]][] = [
  ["export const v = { ...class { private p = 1; }, z: 1 };", []],
  ["export default { ...class { protected p = 1; m() { return this; } } };", []],
  ["export function f() { return [{ ...class { #p = 1; } }]; }", []],
  ["export const v = { ...class { private p = 1; } } as const;", ["1,14 TS4094"]],
  ["export const v = { ...class A { private p = 1; static s = class { #x = 1; }; }, z: 1 };", ["1,14 TS4094"]],
  ["export const v = class { private p = 1; };", ["1,14 TS4094"]],
  ["export const v = { prototype: new (class { private p = 1; })(), z: 1 };", ["1,14 TS4094"]],
];

test.concurrent.each(programs)("%s", async (program, errors) => {
  using dir = tempDir("check-spreads-of-classes", { "tsconfig.json": JSON.stringify({ compilerOptions }), "a.ts": program + "\n" });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect([...stdout.matchAll(/^a\.ts\((\d+,\d+)\): error (TS\d+)/gm)].map(([, at, code]) => `${at} ${code}`)).toEqual(errors);
});
