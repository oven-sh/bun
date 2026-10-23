import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// These programs print under `bun run --aot` what plain Bun prints, as their executables do. The last one is about compiled code: `--debug-aot`.
const programs = join(import.meta.dir, "programs");

test.concurrent.each(["calls/typed-results-with-indirect-tail-calls", "calls/tail-calls-mixed-result-types-large"])(
  "%s",
  async name => {
    const run = async (...flags: string[]) => {
      const { stdout, exitCode } = await runCommand(
        [bunExe(), "run", ...flags, join(programs, name + ".ts")],
        programs,
      );
      return { stdout, exitCode };
    };
    expect(await run("--aot")).toEqual(await run());
  },
);

test.concurrent.each(["type-rules/non-null-assertions"])(
  "what a method of a built-in yields in tail position is held where it stands: %s",
  async name => {
    const run = async (...flags: string[]) => {
      const { stdout, exitCode } = await runCommand(
        [bunExe(), "run", ...flags, join(programs, name + ".ts")],
        programs,
      );
      return { stdout, exitCode };
    };
    const plain = await run();
    expect(plain.exitCode).toBe(0);
    expect(await run("--aot")).toEqual(plain);
  },
);

test("which calls are tail calls is decided by syntax alone", async () => {
  const { stdout, exitCode } = await runCommand(
    [bunExe(), "run", "--debug-aot", join(programs, "calls/tail-position-is-syntax.ts")],
    programs,
  );
  expect({ stdout, exitCode }).toEqual({
    stdout: readFileSync(join(programs, "calls/tail-position-is-syntax.expected.txt"), "utf8"),
    exitCode: 0,
  });
});
