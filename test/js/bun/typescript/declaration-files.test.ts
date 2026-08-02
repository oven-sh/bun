// TypeScript declaration files (.d.ts / .d.mts / .d.cts) imported at runtime.
// https://github.com/oven-sh/bun/issues/36751
//
// Declaration files are parsed so type-only declarations synthesize real
// (undefined) bindings, relative runtime specifiers inside them resolve to
// declaration siblings, and bare specifiers match the "types" exports
// condition. A declaration graph therefore loads and links instead of
// throwing "export 'X' not found" / "Cannot find module './x.mjs'".

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(dir: unknown, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("type-only re-exports across .d.mts files link (issue repro)", async () => {
  using dir = tempDir("dts-36751", {
    "EventTypes.d.mts": `export type ValueOf<T> = T[keyof T];
export const BUEvents = { A: "a" } as const;
`,
    "utils.d.mts": `export { ValueOf, BUEvents } from "./EventTypes.d.mts";
`,
    "index.ts": `import { ValueOf, BUEvents } from "./utils.d.mts";
console.log("OK:", JSON.stringify(BUEvents));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "index.ts");
  expect(stderr).toBe("");
  expect(stdout).toBe(`OK: {"A":"a"}\n`);
  expect(exitCode).toBe(0);
});

test.concurrent("type aliases, interfaces and declare statements become undefined exports", async () => {
  using dir = tempDir("dts-synth", {
    "api.d.ts": `export type Alias = string;
export interface Shape {
  x: number;
}
export declare const version: string;
export declare function helper(): void;
export declare class Client {}
export declare enum Flags {}
export declare namespace NS {
  const x: number;
}
type LocalOnly = number;
declare const hidden: LocalOnly;
export { LocalOnly, hidden };
`,
    "index.ts": `import * as api from "./api.d.ts";
console.log(JSON.stringify(Object.keys(api).sort()));
console.log(JSON.stringify(Object.values(api).map(v => typeof v)));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "index.ts");
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.split("\n")[0])).toEqual([
    "Alias",
    "Client",
    "Flags",
    "LocalOnly",
    "NS",
    "Shape",
    "helper",
    "hidden",
    "version",
  ]);
  for (const t of JSON.parse(stdout.split("\n")[1])) {
    expect(t).toBe("undefined");
  }
  expect(exitCode).toBe(0);
});

test.concurrent("export type { } and export type * from are kept in declaration files", async () => {
  using dir = tempDir("dts-export-type", {
    "types.d.mts": `export type A = number;
export interface B {}
`,
    "index.d.mts": `export type { A } from "./types.d.mts";
export type * from "./types.d.mts";
`,
    "main.ts": `import * as m from "./index.d.mts";
console.log(JSON.stringify(Object.keys(m).sort()));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "main.ts");
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["A", "B"]);
  expect(exitCode).toBe(0);
});

test.concurrent("relative .mjs specifiers in declaration files resolve to .d.mts siblings", async () => {
  // tsc-style declaration emit: the .d.mts graph references "./helper.mjs"
  // which only ships as "helper.d.mts" (type-only module, no runtime file).
  using dir = tempDir("dts-sibling", {
    "helper.d.mts": `export type Prettify<T> = { [K in keyof T]: T[K] };
export interface Options {
  debug?: boolean;
}
`,
    "index.d.mts": `import { Prettify, Options } from "./helper.mjs";
export { type Prettify, Options };
`,
    "main.ts": `import * as m from "./index.d.mts";
console.log(JSON.stringify(Object.keys(m).sort()));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "main.ts");
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["Options", "Prettify"]);
  expect(exitCode).toBe(0);
});

test.concurrent("declaration sibling resolution covers .js, .mjs and .cjs specifiers", async () => {
  using dir = tempDir("dts-sibling-exts", {
    "a.d.ts": `export type AType = 1;
`,
    "b.d.mts": `export interface BType {}
`,
    "c.d.cts": `export type CType = 2;
`,
    // ".js" maps to a ".d.ts" sibling, or falls back to ".d.mts" when no
    // ".d.ts" exists; ".cjs" maps to ".d.cts".
    "wrapper.d.ts": `export { AType } from "./a.js";
export { BType } from "./b.js";
export { CType } from "./c.cjs";
`,
    "main.ts": `import * as m from "./wrapper.d.ts";
console.log(JSON.stringify(Object.keys(m).sort()));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "main.ts");
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["AType", "BType", "CType"]);
  expect(exitCode).toBe(0);
});

test.concurrent("bare specifiers in declaration files match the types exports condition", async () => {
  // The package's runtime entry doesn't export the type name; its "types"
  // entry does. Declaration-file importers must pick the "types" entry.
  using dir = tempDir("dts-types-condition", {
    "node_modules/some-lib/package.json": `{
  "name": "some-lib",
  "type": "module",
  "exports": {
    ".": {
      "types": "./index.d.mts",
      "default": "./index.mjs"
    }
  }
}`,
    "node_modules/some-lib/index.mjs": `export const runtimeOnly = 1;
`,
    "node_modules/some-lib/index.d.mts": `export type LibOptions = { a: number };
export declare const runtimeOnly: number;
`,
    "wrapper.d.mts": `export { LibOptions } from "some-lib";
`,
    "main.ts": `import * as m from "./wrapper.d.mts";
console.log(JSON.stringify(Object.keys(m)));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "main.ts");
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["LibOptions"]);
  expect(exitCode).toBe(0);
});

test.concurrent("runtime values declared in the imported declaration file itself are preserved", async () => {
  using dir = tempDir("dts-values", {
    "mixed.d.mts": `export type T = number;
export const value = 42;
`,
    "index.ts": `import { value } from "./mixed.d.mts";
console.log(value);
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "index.ts");
  expect(stderr).toBe("");
  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});

test.concurrent("normal .ts files still elide type-only exports", async () => {
  // The declaration-file behavior must not leak into regular TypeScript:
  // a type-only export in a .ts file does not produce a runtime binding.
  using dir = tempDir("dts-scope", {
    "types.ts": `export type OnlyAType = number;
export const real = 1;
`,
    "index.ts": `import * as m from "./types.ts";
console.log(JSON.stringify(Object.keys(m)));
`,
  });
  const { stdout, stderr, exitCode } = await run(dir, "index.ts");
  expect(stderr).toBe("");
  expect(stdout).toBe(`["real"]\n`);
  expect(exitCode).toBe(0);
});
