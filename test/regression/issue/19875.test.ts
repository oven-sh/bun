import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("19875", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/19875.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" }, // tests '.only()'
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/regression/issue/19875.fixture.ts:
    (todo) only > todo > fail

     0 pass
     1 todo
     0 fail
    Ran 1 test across 1 file."
  `);
});
