// What a mapped type ranges over is found by asking the type that it maps, twice at each level of a nest of mapped types. TypeScript keeps it once it's found,
// also where the innermost couldn't be instantiated: there both requests were made again at each level, up to the limit of 5,000,000 instantiations.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const nest = (name: string, depth: number, innermost = "{ a: 1 }") =>
  `${`${name}<`.repeat(depth)}${innermost}${">".repeat(depth)}`;
const declared = (name: string, type: string) => `export declare const ${name}: ${type};`;
const isNever = (name: string) => `export const is_${name}: never = ${name};`;

// The errors are those of TypeScript 7.0.2.
test.concurrent.each([
  ["as deep as may be", [declared("z", nest("Partial", 100)), isNever("z")], ["(2,14) TS2322"]],
  ["one level too deep", [declared("z", nest("Partial", 101)), isNever("z")], ["(2,14) TS2322", "(2,14) TS2589"]],
  ["far too deep", [declared("z", nest("Required", 400)), isNever("z")], ["(2,14) TS2322", "(2,14) TS2589"]],
  [
    "with a name that maps itself",
    ["type M<T> = { [K in keyof T as K]: T[K] };", declared("z", nest("M", 101)), isNever("z")],
    ["(3,14) TS2322", "(3,14) TS2589"],
  ],
  [
    "of a union",
    [declared("z", nest("Partial", 101, "{ a: 1 } | { b: 2 }")), isNever("z")],
    ["(2,14) TS2322", "(2,14) TS2589"],
  ],
  [
    "one type at two places",
    [declared("z", nest("Partial", 101)), declared("w", nest("Partial", 101)), isNever("z"), isNever("w")],
    ["(3,14) TS2322", "(3,14) TS2589", "(4,14) TS2322", "(4,14) TS2589"],
  ],
  [
    "asked for its keys first",
    [
      `type A = ${nest("Partial", 105)};`,
      "type B = keyof A;",
      "export const b: B = 1;",
      declared("z", "A"),
      isNever("z"),
    ],
    ["(3,17) TS2589", "(5,14) TS2322"],
  ],
  [
    "of a type parameter",
    [
      `export function f<T>(z: ${nest("Partial", 105, "T")}) { const y: never = z; return z; }`,
      "export const x: never = f<{ a: 1 }>(null!);",
    ],
    ["(1,981) TS2322", "(1,981) TS2589", "(2,14) TS2322", "(2,25) TS2589"],
  ],
] as [string, string[], string[]][])("mapped types nested in one another: %s", async (_, source, errors) => {
  using dir = tempDir("check-mapped-types-nested", { "tsconfig.json": tsconfig, "main.ts": source.join("\n") + "\n" });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`).sort()).toEqual(errors);
});
