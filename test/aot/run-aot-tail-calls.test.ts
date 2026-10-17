import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { test } from "./supported";

// Typed code's tail calls are tail calls under `bun run --aot`: these programs print what plain Bun prints, as their executables do.
const programs = join(import.meta.dir, "programs");

test.concurrent.each(["calls/typed-results-with-indirect-tail-calls", "calls/tail-calls-mixed-result-types-large"])(
  "%s",
  async name => {
    const run = async (...flags: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", ...flags, join(programs, name + ".ts")],
        cwd: programs,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode };
    };
    expect(await run("--aot")).toEqual(await run());
  },
);

test.concurrent.each(["type-rules/non-null-assertions"])(
  "what a method of a built-in yields in tail position is held where it stands: %s",
  async name => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--aot", join(programs, name + ".ts")],
      cwd: programs,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({
      stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"),
      exitCode: 0,
    });
  },
);

test("which calls are tail calls is decided by syntax alone", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", join(programs, "calls/tail-position-is-syntax.ts")],
    cwd: programs,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: readFileSync(join(programs, "calls/tail-position-is-syntax.expected.txt"), "utf8"),
    exitCode: 0,
  });
});
