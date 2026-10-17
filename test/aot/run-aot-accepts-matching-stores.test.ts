import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { test } from "./supported";

// Under --aot a compound assignment whose result does not fit throws and stores nothing. `bun run --aot` prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test.concurrent.each(["type-rules/number-plus-equals-any", "type-rules/bit-flag-enums"])("%s", async name => {
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
});
