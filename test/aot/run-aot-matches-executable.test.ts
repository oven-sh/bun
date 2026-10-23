import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// Rules of --aot about functions. `bun run --debug-aot`, which runs compiled code, prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test("a function made of text at run time is as the language has it, but for caller and arguments", async () => {
  const file = join(programs, "language/function-constructor-semantics.js");
  const said: [string, number][] = [];
  for (const flags of [[], ["--debug-aot"]]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, file],
      cwd: dirname(file),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    said.push(await Promise.all([proc.stdout.text(), proc.exited]));
  }
  const otherRows = ([stdout, exitCode]: [string, number]) => [
    stdout.split("\n").filter(line => !line.startsWith("caller and arguments")),
    exitCode,
  ];
  expect(otherRows(said[1])).toEqual(otherRows(said[0]));
  expect(said[1][0]).toBe(readFileSync(join(programs, "language/function-constructor-semantics.expected.txt"), "utf8"));
  expect(said[0][0]).toContain("GeneratorFunction(): writable true, a store holds: true");
});

test.concurrent.each([
  "commonjs/sloppy-caller-and-arguments",
  "commonjs/use-strict-function",
  "objects/object-assign-indexed-target-untyped",
  "typed-objects/field-attributes-changed-through-untyped-code",
])("%s", async name => {
  const file = [".ts", ".js", "/main.ts"].map(end => join(programs, name + end)).find(path => existsSync(path))!;
  const { stdout, exitCode } = await run([bunExe(), "run", "--debug-aot", file], dirname(file));
  // A stored output says where an executable differs from plain Bun on purpose. Without one, plain Bun is what it has to print.
  const stored = join(programs, name + ".expected.txt");
  const printsUnderPlainBun = async () => {
    await using plain = Bun.spawn({
      cmd: [bunExe(), "run", file],
      cwd: dirname(file),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    return await plain.stdout.text();
  };
  expect({ stdout, exitCode }).toEqual({
    stdout: existsSync(stored) ? readFileSync(stored, "utf8") : await printsUnderPlainBun(),
    exitCode: 0,
  });
});
