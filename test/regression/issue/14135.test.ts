import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("14135", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/14135.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeAll 2
    test 2"
  `);
});
