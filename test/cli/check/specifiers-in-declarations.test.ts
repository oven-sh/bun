import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

const options = {
  strict: true,
  types: [],
  lib: ["es2022"],
  module: "esnext",
  moduleResolution: "bundler",
};

/** `bun build --dts` in `cwd`. Returns the text of the declaration file `written`, a path in the output directory. */
async function declarationsOf(cwd: string, entryPoint: string, written: string, flags: string[] = []) {
  const cmd = [bunExe(), "build", "--dts", "--packages=external", ...flags, "--outdir", join(cwd, "out"), entryPoint];
  await using proc = spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  return readFileSync(join(cwd, "out", written), "utf8");
}

// What is expected is what tsc 7.0.2 writes for the same project.

test("a file that `typesVersions` map is named by what is mapped to it", async () => {
  // `other` hands out types of `pkg` that its importer does not import.
  using dir = tempDir("bun-build-dts-specifiers", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      version: "1.0.0",
      types: "index.d.ts",
      typesVersions: { "*": { "*": ["ts4.0/*"] } },
    }),
    "node_modules/pkg/ts4.0/index.d.ts": `import { T } from "./sub";\nexport interface Main { m: number }\nexport declare function make(): T;\n`,
    "node_modules/pkg/ts4.0/sub.d.ts": `export interface T { a: number }\n`,
    "node_modules/other/package.json": JSON.stringify({ name: "other", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/other/index.d.ts": `import { Main, make } from "pkg";\nexport declare function main(): Main;\nexport declare function sub(): ReturnType<typeof make>;\n`,
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true } }),
    "a.ts": `import { main, sub } from "other";\nexport const below = sub();\nexport const entry = main();\n`,
  });
  // TypeScript 6 maps `pkg/ts4.0/sub` once more, to `ts4.0/ts4.0/sub`, and finds nothing.
  expect(await declarationsOf(String(dir), "a.ts", "a.d.ts")).toBe(
    `export declare const below: import("pkg/sub").T;\nexport declare const entry: import("pkg").Main;\n`,
  );
});

test("the main file of a package, where `typesVersions` map only that", async () => {
  using dir = tempDir("bun-build-dts-specifiers", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      version: "1.0.0",
      types: "index.d.ts",
      typesVersions: { "*": { "index.d.ts": ["ts/index.d.ts"] } },
    }),
    "node_modules/pkg/ts/index.d.ts": `export interface Main { m: number }\n`,
    "node_modules/pkg/index.d.ts": `export interface Unmapped { u: number }\n`,
    "node_modules/other/package.json": JSON.stringify({ name: "other", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/other/index.d.ts": `import { Main } from "pkg";\nexport declare function main(): Main;\n`,
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true } }),
    "a.ts": `import { main } from "other";\nexport const entry = main();\n`,
  });
  expect(await declarationsOf(String(dir), "a.ts", "a.d.ts")).toBe(`export declare const entry: import("pkg").Main;\n`);
});

test("the output of a referenced project is named by its package alone, or not at all", async () => {
  const project = { ...options, composite: true, outDir: "dist", rootDir: "src" };
  const manifest = (name: string) =>
    JSON.stringify({ name, version: "1.0.0", main: "dist/index.js", types: "dist/index.d.ts" });
  using dir = tempDir("bun-build-dts-specifiers", {
    "packages/a/package.json": manifest("@s/a"),
    "packages/a/tsconfig.json": JSON.stringify({ compilerOptions: project, include: ["src"] }),
    "packages/a/src/sub.ts": `export interface T { a: number }\n`,
    "packages/a/src/index.ts": `import type { T } from "./sub";\nexport function make(): T { return { a: 1 }; }\n`,
    "packages/b/package.json": manifest("@s/b"),
    "packages/b/tsconfig.json": JSON.stringify({
      compilerOptions: project,
      include: ["src"],
      references: [{ path: "../a" }],
    }),
    "packages/b/src/index.ts": `import { make } from "@s/a";\nexport const value = make();\n`,
  });
  mkdirSync(join(String(dir), "node_modules/@s"), { recursive: true });
  symlinkSync(join(String(dir), "packages/a"), join(String(dir), "node_modules/@s/a"), "junction");
  const root = ["--root", join(String(dir), "packages")];
  // Not `@s/a/dist/sub`: `dist/sub.d.ts` is not the main file of `@s/a`, so the next path to the file is tried.
  expect(await declarationsOf(join(String(dir), "packages/b"), "src/index.ts", "b/src/index.d.ts", root)).toBe(
    `export declare const value: import("@s/a/src/sub").T;\n`,
  );
});
