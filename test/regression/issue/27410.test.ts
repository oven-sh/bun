import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27410
// Bun.serve should report the actual errno (e.g. EADDRNOTAVAIL, EACCES, EPERM)
// instead of always reporting EADDRINUSE when listen fails.

test("Bun.serve reports EADDRNOTAVAIL instead of EADDRINUSE for non-local address", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        Bun.serve({ port: 0, hostname: "192.0.2.1", fetch() { return new Response("ok") } });
      } catch(e) {
        console.log(e.code);
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("EADDRNOTAVAIL");
  expect(exitCode).toBe(0);
});
