// https://github.com/oven-sh/bun/issues/29166
//
// `Bun.serve({ unix })` leaves the socket file on disk when the process is
// killed by SIGTERM/SIGINT, so re-running the same script fails with
// EADDRINUSE. The fix is a process-global cleanup walk installed on an
// atexit hook and on the SIGTERM/SIGINT signal handlers.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Spawn a child that listens on `socketPath` with `api` ("serve" or "listen"),
// wait for it to print "ready\n", send it `signal`, then wait for it to exit.
async function spawnChildAndKill(socketPath: string, api: "serve" | "listen", signal: "SIGTERM" | "SIGINT") {
  const source =
    api === "serve"
      ? `Bun.serve({
           unix: ${JSON.stringify(socketPath)},
           fetch() { return new Response("ok"); },
         });
         process.stdout.write("ready\\n");`
      : `Bun.listen({
           unix: ${JSON.stringify(socketPath)},
           socket: { data() {}, open() {} },
         });
         process.stdout.write("ready\\n");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Wait for "ready\n" on stdout — at that point the listener is bound and
  // the socket file exists.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("ready\n")) {
    const { value, done } = await reader.read();
    if (done) {
      const stderr = await proc.stderr.text();
      throw new Error(`child exited before ready: ${stderr}`);
    }
    buf += decoder.decode(value);
  }
  reader.releaseLock();

  proc.kill(signal);
  await proc.exited;
}

test.skipIf(isWindows)("#29166 Bun.serve(unix) unlinks socket file on SIGTERM", async () => {
  using dir = tempDir("issue-29166-serve-sigterm", {});
  const sock = join(String(dir), "EADDRINUSE.sock");

  await spawnChildAndKill(sock, "serve", "SIGTERM");

  // The cleanup walk should have removed the socket file. (Before the fix
  // this was still present and the next run hit EADDRINUSE.)
  expect(existsSync(sock)).toBe(false);

  // Re-running the exact same script must succeed — this was the user's
  // original reproducer.
  await spawnChildAndKill(sock, "serve", "SIGTERM");
  expect(existsSync(sock)).toBe(false);
});

test.skipIf(isWindows)("#29166 Bun.serve(unix) unlinks socket file on SIGINT", async () => {
  using dir = tempDir("issue-29166-serve-sigint", {});
  const sock = join(String(dir), "EADDRINUSE.sock");

  await spawnChildAndKill(sock, "serve", "SIGINT");

  expect(existsSync(sock)).toBe(false);
});

test.skipIf(isWindows)("#29166 Bun.listen(unix) unlinks socket file on SIGTERM", async () => {
  using dir = tempDir("issue-29166-listen-sigterm", {});
  const sock = join(String(dir), "EADDRINUSE.sock");

  await spawnChildAndKill(sock, "listen", "SIGTERM");

  expect(existsSync(sock)).toBe(false);
});

test.skipIf(isWindows)("#29166 Bun.serve(unix) unlinks socket file on process.exit(0)", async () => {
  using dir = tempDir("issue-29166-serve-exit", {});
  const sock = join(String(dir), "EADDRINUSE.sock");

  // No explicit server.stop() — rely on the atexit hook.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Bun.serve({
         unix: ${JSON.stringify(sock)},
         fetch() { return new Response("ok"); },
       });
       process.exit(0);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  // Behavior assertion first, exit code last.
  expect(existsSync(sock)).toBe(false);
  expect(exitCode).toBe(0);
});
