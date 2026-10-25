import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `
import { check, load, loadAndSum } from "loose";
function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": value " + JSON.stringify(run()));
  } catch (error: any) {
    console.log(label + ": " + error.name + (error.issues ? " at " + error.issues.map((issue: any) => JSON.stringify(issue.path)).join() : ""));
  }
}
for (const text of ['{"x":1,"y":2}', '{"x":"s","y":2}', '{"x":1}', "[1,2]", "null", '{"x":{"x":1},"y":[2]}']) {
  attempt("load " + text, () => load(text));
  attempt("loadAndSum " + text, () => loadAndSum(text));
  attempt("check " + text, () => check(JSON.parse(text)));
}
`;
const index = `
import { JSON } from "bun"; import { validate } from "bun:bundle";
export type Point = { x: number; y: number };
export function load(text: string): Point { return JSON.parse<Point>(text); }
export function check(value: unknown): Point { return validate<Point>(value); }
export function loadAndSum(text: string): number { const point = JSON.parse<Point>(text); return point.x * 2 + point.y; }
`;
const expected = `load {"x":1,"y":2}: value {"x":1,"y":2}
loadAndSum {"x":1,"y":2}: value 4
check {"x":1,"y":2}: value {"x":1,"y":2}
load {"x":"s","y":2}: TypeError at ["x"]
loadAndSum {"x":"s","y":2}: TypeError at ["x"]
check {"x":"s","y":2}: TypeError at ["x"]
load {"x":1}: TypeError at ["y"]
loadAndSum {"x":1}: TypeError at ["y"]
check {"x":1}: TypeError at ["y"]
load [1,2]: TypeError at []
loadAndSum [1,2]: TypeError at []
check [1,2]: TypeError at []
load null: TypeError at []
loadAndSum null: TypeError at []
check null: TypeError at []
load {"x":{"x":1},"y":[2]}: TypeError at ["x"],["y"]
loadAndSum {"x":{"x":1},"y":[2]}: TypeError at ["x"],["y"]
check {"x":{"x":1},"y":[2]}: TypeError at ["x"],["y"]
`;

const packages: Record<string, { files: Record<string, string>; warns: boolean }> = {
  "without type errors": { files: { "index.ts": index }, warns: false },
  "with a type error in the file that validates": {
    files: { "index.ts": index + `export const wrong: number = "not a number";\n` },
    warns: true,
  },
  "with a type error in another file": {
    files: {
      "index.ts": index + `export * from "./other";\n`,
      "other.ts": `export const wrong: number = "not a number";\n`,
    },
    warns: true,
  },
  "whose file begins with @ts-nocheck": {
    files: { "index.ts": "// @ts-nocheck" + index + `export const wrong: number = "not a number";\n` },
    warns: false,
  },
};
for (const [name, { files, warns }] of Object.entries(packages)) {
  test(`JSON.parse<T> and validate<T> validate in a TypeScript package ${name}`, async () => {
    using dir = tempDir("aot-validation-in-packages", {
      "main.ts": main,
      "node_modules/loose/package.json": `{ "name": "loose", "version": "1.0.0", "main": "index.ts" }`,
      ...Object.fromEntries(Object.entries(files).map(([file, text]) => ["node_modules/loose/" + file, text])),
    });
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile], String(dir));
    expect({ warns: built.stderr.includes("TS100009"), exitCode: built.exitCode }).toEqual({ warns, exitCode: 0 });
    const compiled = await run([outfile], String(dir));
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
  }, 120_000);

  // TODO: only an ahead-of-time build makes the validators today. Under `bun run`, "bun:bundle" has no export named `validate`.
  test.todo(`bun run validates in a TypeScript package ${name}`, async () => {
    using dir = tempDir("aot-validation-in-packages", {
      "main.ts": main,
      "node_modules/loose/package.json": `{ "name": "loose", "version": "1.0.0", "main": "index.ts" }`,
      ...Object.fromEntries(Object.entries(files).map(([file, text]) => ["node_modules/loose/" + file, text])),
    });
    const plain = await run([bunExe(), "run", "./main.ts"], String(dir));
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
  });
}
