import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("only-inside-only", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/only-inside-only.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(stdout).not.toContain("should not run");
  expect(stdout).toIncludeRepeated("should run", 1);
});
