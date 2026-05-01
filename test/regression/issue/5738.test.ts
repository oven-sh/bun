import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// tests that test(1), describe(test(2)), test(3) run in order 1,2,3 instead of 2,1,3
test("5738", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/5738.fixture.ts"],
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
    1 - beforeAll
    1 - beforeEach
    1 - test
    1 - afterEach
    2 - beforeAll
    1 - beforeEach
    2 - beforeEach
    2 - test
    2 - afterEach
    1 - afterEach
    2 - afterAll
    1 - afterAll"
  `);
});
