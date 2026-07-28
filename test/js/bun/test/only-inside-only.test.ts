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
  // Drop `stdout | file > describe > test` attribution headers: they repeat
  // the test name, which is what this asserts on.
  const logs = stdout
    .split("\n")
    .filter(l => !l.startsWith("stdout | "))
    .join("\n");
  expect(logs).not.toContain("should not run");
  expect(logs).toIncludeRepeated("should run", 1);
});
