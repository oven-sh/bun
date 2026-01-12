import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/25765
// Bun.serve() with unresolvable hostname should show proper DNS error, not EADDRINUSE

test("Bun.serve() with unresolvable hostname shows DNS error", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Bun.serve({ hostname: "something.localhost", fetch: () => new Response("Hello") });`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not claim the port is in use (EADDRINUSE)
  expect(stderr).not.toContain("EADDRINUSE");
  expect(stderr).not.toContain("Is port");

  // Should show a DNS resolution error
  expect(stderr).toContain("ENOTFOUND");
  expect(stderr).toContain("getaddrinfo");

  // Should fail
  expect(exitCode).not.toBe(0);
});

test("Bun.serve() with valid hostname still works", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = Bun.serve({
        hostname: "localhost",
        port: 0,
        fetch: () => new Response("Hello")
      });
      console.log("listening on port", server.port);
      server.stop();
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("listening on port");
  expect(exitCode).toBe(0);
});
