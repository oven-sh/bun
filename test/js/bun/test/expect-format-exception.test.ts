import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect error formatting does not crash when formatting throws", async () => {
  // When expect() receives a non-mock value and the error formatter encounters
  // a JS exception while formatting the value, it should throw a proper error
  // instead of crashing with an assertion failure in releaseAssertNoException.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      delete globalThis.Loader;
      const v1 = Bun.jest();
      const v2 = v1.expect(Bun);
      let threw = false;
      try { v2.nthCalledWith(Bun, v2, v2, Bun, v2); } catch { threw = true; }
      if (!threw) process.exit(2);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr is not asserted because ASAN debug builds emit warnings to stderr
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
