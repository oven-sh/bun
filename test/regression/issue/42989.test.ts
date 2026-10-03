import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/42989
// Bun 1.3.14 printed this warning when the timeout fired. Bun 1.4.0 left it in
// the stderr buffer until the process exited.
//
// The warning is only registered when `idleTimeout` is not passed, so the test
// waits for the default 10 second timeout. A process that is killed never
// flushes at exit, so the warning must already be on the pipe before SIGKILL.
test("Bun.serve prints the idle timeout warning when the timeout fires, not at exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        fetch: () => new Promise(() => {}),
      });
      fetch(server.url).catch(e => console.log("client error:", e.code));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The server runs the timeout handler before it closes the socket, so the
  // client error on stdout means the warning was already written.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (!stdout.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  expect(stdout).toBe("client error: ECONNRESET\n");

  proc.kill("SIGKILL");
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("warn: Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure.");
}, 30_000);
