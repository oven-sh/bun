import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// tests that beforeAll runs in order instead of immediately
test("19758", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/19758.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    -- foo beforeAll
    -- bar beforeAll
    bar.1
    -- baz beforeAll
    baz.1"
  `);
});
