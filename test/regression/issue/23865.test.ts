import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// the test should time out, not crash
test("23865", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "./23865.fixture.ts"],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun test <version> (<revision>)"`);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "23865.fixture.ts:
    1 | // Should not crash
    2 | test("abc", () => {
    3 |   expect(async () => {
    4 |     await Bun.sleep(100);
    5 |     throw new Error("uh oh!");
    6 |   }).toThrow("uh oh!");
             ^
    error: Received function returned a promise that was still pending when the test timed out
        at <anonymous> (file:NN:NN)
    (fail) abc
      ^ this test timed out after 50ms.

     0 pass
     1 fail
     1 expect() calls
    Ran 1 test across 1 file."
  `);
});
