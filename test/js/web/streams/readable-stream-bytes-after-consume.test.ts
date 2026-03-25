import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: Response.bytes() uses a fast path that detaches the blob store
// without marking the ReadableStream as disturbed. A subsequent body.bytes()
// call would reach the blob source with a null store, causing a crash.
test("ReadableStream.bytes() after Response body consumed via fast path throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("test data");
      const body = response.body;
      await response.bytes();
      try {
        await body.bytes();
        process.exit(1);
      } catch (e) {
        console.log(e.message);
        process.exit(0);
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toContain("ReadableStream");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
