import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Regression test: calling .bytes() on a consumed Response body stream
// used to trigger an assertion failure ("Expected an exception to be thrown")
// because ByteBlobLoader.toBufferedValue returned .zero without setting an exception.
test("calling .bytes() on a consumed Response body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("Hello World");
      const body = response.body;
      await body.text();
      // After consuming, tee() to get a new stream backed by a detached ByteBlobLoader
      try { body.tee(); } catch {}
      // Call bytes() which previously crashed due to returning .zero without exception
      try { await body.bytes(); } catch {}
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("assertion");
  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
