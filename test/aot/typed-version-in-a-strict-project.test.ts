import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;
const installed = "export function add(a, b) {\n  return a + b;\n}\n";
const typed = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

function project(main: string, typedFile = typed) {
  return tempDirWithBunTypes("aot-typed-version-strict", {
    "main.ts": main,
    "tsconfig.json": JSON.stringify({ compilerOptions: { module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true } }),
    "node_modules/adder/package.json": JSON.stringify({ name: "adder", version: "1.0.0", type: "module", main: "index.js" }),
    "node_modules/adder/index.js": installed,
    ".sound/adder/sound.json": JSON.stringify({
      sound: 2,
      name: "adder",
      version: "1.0.0",
      when: {},
      lay: { "index.js": createHash("sha256").update(installed).digest("hex") },
      needs: [],
    }),
    ".sound/adder/lay/index.js": typedFile,
  });
}

async function build(folder: string) {
  const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "app"];
  const { stderr, exitCode, signal } = await spawned(command, folder, env);
  const errors = stderr.split("\n").flatMap(line => /^error: (TS\d+): /.exec(line)?.[1] ?? []);
  return { errors, exitCode, signal };
}

describe("a typed version of a package without declarations, in a strict project", () => {
  test(
    "the importer needs no declaration file",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, 2));\n`);
        expect(await build(String(dir))).toEqual({ errors: [], exitCode: 0, signal: null });
        const { stdout, exitCode } = await spawned([join(String(dir), isWindows ? "app.exe" : "app")], String(dir), bunEnv);
        expect({ stdout, exitCode }).toEqual({ stdout: "3\n", exitCode: 0 });
      }),
    buildTimeout,
  );

  test(
    "the importer is checked against its types",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, "2"));\n`);
        expect(await build(String(dir))).toEqual({ errors: ["TS2345"], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "a typed version that is rejected declares nothing",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, 2));\n`, typed.replace("a + b", "a - b"));
        expect(await build(String(dir))).toEqual({ errors: ["TS7016"], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );
});
