// scripts/agent.ts starts the Buildkite agent on a CI machine. A job starts the
// moment the agent registers, so on an OpenRC machine the agent first waits
// until dockerd listens: a docker client that comes before that is refused.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { waitForSocket } from "../../scripts/agent.ts";

/** A process that listens on `socket` and never takes a connection, like a daemon that does not serve yet. */
async function listener(socket: string) {
  const daemon = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `require("node:net").createServer().listen(process.argv[1], () => {
        require("node:fs").writeSync(1, "listening");
        Bun.sleepSync(600_000);
      });`,
      socket,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await daemon.stdout.getReader().read();
  expect(new TextDecoder().decode(value)).toBe("listening");
  return daemon;
}

test.skipIf(isWindows)("the agent waits until the daemon listens", async () => {
  using dir = tempDir("ci-agent", {});
  const socket = join(String(dir), "docker.sock");

  // The first connection is tried at once, and nothing listens yet.
  const listens = waitForSocket(socket, 60_000, 1);
  const server = createServer();
  await new Promise<void>(resolve => server.listen(socket, resolve));
  try {
    expect(await listens).toBe(true);
  } finally {
    server.close();
  }
});

test.skipIf(isWindows)("a daemon that listens and does not serve yet is enough", async () => {
  using dir = tempDir("ci-agent", {});
  const socket = join(String(dir), "docker.sock");
  await using daemon = await listener(socket);

  expect(await waitForSocket(socket, 60_000, 1)).toBe(true);
  expect(daemon.exitCode).toBeNull();
});

test.skipIf(isWindows)("the wait ends without a daemon when its time is used up", async () => {
  using dir = tempDir("ci-agent", {});

  expect(await waitForSocket(join(String(dir), "docker.sock"), 200, 10)).toBe(false);
});

test.skipIf(isWindows)("the socket of a daemon that is gone is not a daemon", async () => {
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
