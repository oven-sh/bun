import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("calling bytes() on a consumed blob ReadableStream does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const resp = new Response("test data");
      // Consume the body, which clears the blob store
      await resp.bytes();
      // Access the body stream directly and call bytes() on it.
      // This should not cause an assertion failure / crash.
      try { await resp.body.bytes(); } catch {}
      console.log("OK");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
