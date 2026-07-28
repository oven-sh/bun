import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// make sure beforeAll runs in the right order
test("21830", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/21830.fixture.ts"],
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
    stdout | test/regression/issue/21830.fixture.ts > Create Show Tests > create show test
    Create Show Tests pre
    Create Show Tests post
    stdout | test/regression/issue/21830.fixture.ts > Get Show Data Tests > get show data tests
    Get Show Data Tests pre
    Get Show Data Tests post
    stdout | test/regression/issue/21830.fixture.ts > Show Deletion Tests
    Show Deletion Tests pre 
    Show Deletion test post"
  `);
});
