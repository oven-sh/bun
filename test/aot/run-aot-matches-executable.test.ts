import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

// Rules of --aot about functions. `bun run --aot` prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test("a function made of text at run time is as the language has it", async () => {
  const file = join(programs, "language/function-constructor-semantics.js");
  const said = [];
  for (const flags of [[], ["--aot"]]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, file],
      cwd: dirname(file),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    said.push(await Promise.all([proc.stdout.text(), proc.exited]));
  }
  expect(said[1]).toEqual(said[0]);
  expect(said[0][0]).toContain("GeneratorFunction(): writable true, a store holds: true");
});

test.concurrent.each([
  "commonjs/sloppy-caller-and-arguments",
  "commonjs/generator-function-prototype-store",
  "type-rules/wrong-object-kind-argument",
  "commonjs/use-strict-function",
  "objects/object-assign-indexed-target-untyped",
])("%s", async name => {
  const file = [".ts", ".js", "/main.ts"].map(end => join(programs, name + end)).find(path => existsSync(path))!;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", file],
    cwd: dirname(file),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"),
    exitCode: 0,
  });
});
