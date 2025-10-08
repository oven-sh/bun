import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("20092", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/20092.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/regression/issue/20092.fixture.ts:
    (pass) foo > works
    (pass) bar > works

     2 pass
     0 fail
     2 expect() calls
    Ran 2 tests across 1 file."
  `);
});
