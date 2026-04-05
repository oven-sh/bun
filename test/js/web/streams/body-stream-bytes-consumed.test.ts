import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("calling bytes() on a consumed body stream does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("Hello World");
      const body = response.body;
      await response.arrayBuffer();
      try { await body.bytes(); } catch {}
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
});
