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
    stdout | test/regression/issue/19758.fixture.ts > foo
    -- foo beforeAll
    stdout | test/regression/issue/19758.fixture.ts > foo > bar
    -- bar beforeAll
    stdout | test/regression/issue/19758.fixture.ts > foo > bar > bar.1
    bar.1
    stdout | test/regression/issue/19758.fixture.ts > foo > baz
    -- baz beforeAll
    stdout | test/regression/issue/19758.fixture.ts > foo > baz > baz.1
    baz.1"
  `);
});
