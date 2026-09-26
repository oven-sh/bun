// scripts/agent.ts starts the Buildkite agent on a CI machine. A job starts the
// moment the agent registers, so on an OpenRC machine the agent first waits
// until dockerd listens: a docker client that comes before that is refused.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { waitForSocket } from "../../scripts/agent.ts";

/**
 * A process that listens on `socket` and never takes a connection, like a
 * daemon that does not serve yet. Its read of stdin keeps the thread, and ends
 * when the pipe closes, so the process does not outlive the test runner.
 */
async function listener(socket: string) {
  const daemon = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `require("node:net").createServer().listen(process.argv[1], () => {
        const fs = require("node:fs");
        fs.writeSync(1, "listening");
        for (;;) {
          try {
            if (fs.readSync(0, Buffer.alloc(1)) === 0) process.exit(0);
          } catch (error) {
            if (error.code !== "EAGAIN") throw error;
            Bun.sleepSync(10);
          }
        }
      });`,
      socket,
    ],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await daemon.stdout.getReader().read();
  expect(new TextDecoder().decode(value)).toBe("listening");
  return daemon;
}

describe.concurrent.skipIf(isWindows)("the wait of the agent for dockerd", () => {
  test("the agent waits until the daemon listens", async () => {
    using dir = tempDir("ci-agent", {});
    const socket = join(String(dir), "docker.sock");

    // The first connection is tried at once, and nothing listens yet.
    const listens = waitForSocket(socket, 60_000, 1);
    const server = createServer();
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(socket, listening.resolve);
    try {
      await listening.promise;
      expect(await listens).toBe(true);
    } finally {
      server.close();
    }
  });

  test("a daemon that listens and does not serve yet is enough", async () => {
    using dir = tempDir("ci-agent", {});
    const socket = join(String(dir), "docker.sock");
    await using daemon = await listener(socket);

    expect(await waitForSocket(socket, 60_000, 1)).toBe(true);
    expect(daemon.exitCode).toBeNull();
  });

  test("the wait without a daemon ends when its time is used up, and not before", async () => {
    using dir = tempDir("ci-agent", {});
    const [wait, interval] = [500, 1];

    const started = Date.now();
    expect(await waitForSocket(join(String(dir), "docker.sock"), wait, interval)).toBe(false);
    // The last attempt is the last one whose successor would come after the time.
    expect(Date.now() - started).toBeGreaterThanOrEqual(wait - interval);
  });

  test("the socket of a daemon that is gone is not a daemon", async () => {
    using dir = tempDir("ci-agent", {});
    const socket = join(String(dir), "docker.sock");
    {
      await using daemon = await listener(socket);
      daemon.kill("SIGKILL");
      await daemon.exited;
    }

    expect(existsSync(socket)).toBe(true);
    expect(await waitForSocket(socket, 200, 10)).toBe(false);
  });
});
