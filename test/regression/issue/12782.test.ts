import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// tests that an error in preload prevents tests from running
test("12782", async () => {
  const result = Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/12782.foo.fixture.ts",
      import.meta.dir + "/12782.bar.fixture.ts",
      "--preload",
      import.meta.dir + "/12782.setup.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/regression/issue/12782.foo.fixture.ts:
    1 | import { beforeAll } from "bun:test";
    2 | 
    3 | const FOO = process.env.FOO ?? "";
    4 | 
    5 | beforeAll(() => {
    6 |   if (!FOO) throw new Error("Environment variable FOO is not set");
                                                                         ^
    error: Environment variable FOO is not set
        at <anonymous> (file:NN:NN)
    (fail) (unnamed)

    test/regression/issue/12782.bar.fixture.ts:
    (pass) bar > should not run
    (pass) bar > inner describe > should not run

     2 pass
     1 fail
    Ran 3 tests across 2 files."
  `);
  expect(exitCode).toBe(1);
});
