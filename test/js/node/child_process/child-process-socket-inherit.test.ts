import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { connect } from "node:net";

// https://github.com/oven-sh/bun/issues/36936
// On Windows, sockets created with plain socket() are inheritable, so a
// detached child spawned while a server is listening would duplicate the
// listen handle and keep the port open after the parent exits.
test.skipIf(!isWindows)("detached child does not inherit the parent's listening socket", async () => {
  using dir = tempDir("socket-inherit", {
    "parent.mjs": `
      import { spawn } from "node:child_process";
      import { createServer } from "node:http";
      import { tmpdir } from "node:os";

      const server = createServer((_request, response) => response.end("ok"));
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = server.address().port;

      // Spawn a detached child while the listen socket is open, then exit.
      // cwd: the child outlives the test and would otherwise inherit this temp
      // dir as its working directory, making tempDir cleanup fail with EBUSY on
      // Windows while the killed child is still tearing down.
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 100000)"], {
        cwd: tmpdir(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();

      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      console.log(JSON.stringify({ port, childPid: child.pid }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const { port, childPid } = JSON.parse(stdout.trim());

  try {
    // The parent has exited and closed its server, so nothing may be listening
    // on the port even though the detached child is still alive.
    const result = await new Promise<string>(resolve => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", error => resolve((error as NodeJS.ErrnoException).code ?? "error"));
    });
    expect(result).toBe("ECONNREFUSED");
  } finally {
    try {
      process.kill(childPid);
    } catch {}
  }
});
