import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("5961", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/5961.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    hi!"
  `);
  expect(exitCode).toBe(0);
});
