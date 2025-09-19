import { test, expect } from "bun:test";
import { bunExe, bunEnv, normalizeBunSnapshot } from "harness";

test("21177", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21177.fixture.ts", "-t", "true is true"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
  expect(exitCode).toBe(0);
});
