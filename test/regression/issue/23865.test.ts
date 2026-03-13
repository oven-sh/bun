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
    (fail) abc
      ^ this test timed out after 50ms.

     0 pass
     1 fail
     1 expect() calls
    Ran 1 test across 1 file."
  `);
});
