import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("calling bytes() on a consumed body stream does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("Hello World");
      response.arrayBuffer();
      const body = response.body;
      try { await body.bytes(); } catch {}
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Must not crash (panic/assertion failure)
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("assertion");
  expect(exitCode).toBe(0);
});
