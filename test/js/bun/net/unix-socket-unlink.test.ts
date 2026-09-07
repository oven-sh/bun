import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

// Node.js/libuv behavior for unix domain sockets:
// - bind() does NOT unlink an existing socket file (returns EADDRINUSE)
// - close() DOES unlink the socket file it created
// - a listener still open when the event loop runs dry is closed (and its
//   file unlinked) by environment teardown; process.exit() skips that.
// Bun previously had this inverted (unlinked before bind, leaked on close).

// Runs `script` (which listens on process.argv[2] and prints "listening") in a
// child and reports whether the socket file outlives the child.
async function socketFileAfterExit(script: string, expectedExitCode = 0) {
  using dir = tempDir("uds-unlink-exit", { "listen-fixture.mjs": script });
  const sock = join(String(dir), "s.sock");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "listen-fixture.mjs", sock],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("listening true\n");
  expect(exitCode).toBe(expectedExitCode);
  return existsSync(sock);
}

describe.skipIf(isWindows)("unix domain socket unlink", () => {
  test("Bun.listen removes the socket file on stop()", () => {
    using dir = tempDir("uds-unlink-listen", {});
    const sock = join(String(dir), "a.sock");

    const listener = Bun.listen({
      unix: sock,
      socket: { data() {}, open() {} },
    });
    expect(existsSync(sock)).toBe(true);
    listener.stop();
    expect(existsSync(sock)).toBe(false);
  });

  test("Bun.listen removes the socket file on stop(true)", () => {
    using dir = tempDir("uds-unlink-listen-force", {});
    const sock = join(String(dir), "a.sock");

    const listener = Bun.listen({
      unix: sock,
      socket: { data() {}, open() {} },
    });
    expect(existsSync(sock)).toBe(true);
    listener.stop(true);
    expect(existsSync(sock)).toBe(false);
  });

  test("Bun.serve removes the socket file on stop()", async () => {
    using dir = tempDir("uds-unlink-serve", {});
    const sock = join(String(dir), "a.sock");

    const server = Bun.serve({
      unix: sock,
      fetch: () => new Response("ok"),
    });
    expect(existsSync(sock)).toBe(true);
    await server.stop();
    expect(existsSync(sock)).toBe(false);
  });

  test("Bun.serve removes the socket file on stop(true)", async () => {
    using dir = tempDir("uds-unlink-serve-force", {});
    const sock = join(String(dir), "a.sock");

    const server = Bun.serve({
      unix: sock,
      fetch: () => new Response("ok"),
    });
    expect(existsSync(sock)).toBe(true);
    await server.stop(true);
    expect(existsSync(sock)).toBe(false);
  });

  test("net.Server removes the socket file on close()", async () => {
    using dir = tempDir("uds-unlink-net", {});
    const sock = join(String(dir), "a.sock");

    const server = createServer();
    server.listen(sock);
    await once(server, "listening");
    expect(existsSync(sock)).toBe(true);

    server.close();
    await once(server, "close");
    expect(existsSync(sock)).toBe(false);
  });

  test("Bun.listen does not unlink an existing file before bind", () => {
    using dir = tempDir("uds-no-prebind-unlink", {});
    const sock = join(String(dir), "a.sock");

    const first = Bun.listen({
      unix: sock,
      socket: { data() {}, open() {} },
    });

    // A second listener at the same path must fail; it must not silently
    // unlink the live socket out from under the first listener.
    expect(() => {
      Bun.listen({
        unix: sock,
        socket: { data() {}, open() {} },
      });
    }).toThrow();

    // The original socket file is untouched.
    expect(existsSync(sock)).toBe(true);

    first.stop();
    expect(existsSync(sock)).toBe(false);
  });

  test("net.Server fails with EADDRINUSE on a stale socket file", async () => {
    using dir = tempDir("uds-eaddrinuse", {});
    const sock = join(String(dir), "a.sock");
    // Node.js leaves stale socket files alone and returns EADDRINUSE.
    writeFileSync(sock, "");

    const server = createServer();
    server.listen(sock);
    const [err] = await once(server, "error");
    expect(err.code).toBe("EADDRINUSE");
  });

  test("can re-listen on the same path after stop()", async () => {
    using dir = tempDir("uds-relisten", {});
    const sock = join(String(dir), "a.sock");

    const a = Bun.listen({ unix: sock, socket: { data() {}, open() {} } });
    a.stop();
    expect(existsSync(sock)).toBe(false);

    const b = Bun.listen({ unix: sock, socket: { data() {}, open() {} } });
    expect(existsSync(sock)).toBe(true);
    b.stop();
    expect(existsSync(sock)).toBe(false);
  });

  describe("a listener left open at exit", () => {
    test.concurrent("net.Server: unref'd server's socket file is removed on natural exit", async () => {
      const left = await socketFileAfterExit(`
        import { existsSync } from "node:fs";
        import { createServer } from "node:net";
        const path = process.argv[2];
        const server = createServer(() => {}).listen(path, () => {
          console.log("listening", existsSync(path));
          server.unref();
        });
      `);
      expect(left).toBe(false);
    });

    test.concurrent("net.Server: the same path can be listened on again by the next process", async () => {
      using dir = tempDir("uds-unlink-relisten", {
        "listen-fixture.mjs": `
          import { createServer } from "node:net";
          const server = createServer(() => {}).listen(process.argv[2], () => {
            console.log("listening");
            server.unref();
          });
        `,
      });
      const sock = join(String(dir), "s.sock");
      for (let i = 0; i < 2; i++) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "listen-fixture.mjs", sock],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe("listening\n");
        expect(exitCode).toBe(0);
      }
    });

    test.concurrent("net.Server: natural exit with process.exitCode set still removes the file", async () => {
      const left = await socketFileAfterExit(
        `
        import { existsSync } from "node:fs";
        import { createServer } from "node:net";
        const path = process.argv[2];
        const server = createServer(() => {}).listen(path, () => {
          console.log("listening", existsSync(path));
          process.exitCode = 3;
          server.unref();
        });
      `,
        3,
      );
      expect(left).toBe(false);
    });

    test.concurrent("Bun.listen: unref'd listener's socket file is removed on natural exit", async () => {
      const left = await socketFileAfterExit(`
        import { existsSync } from "node:fs";
        const path = process.argv[2];
        const listener = Bun.listen({ unix: path, socket: { data() {}, open() {} } });
        console.log("listening", existsSync(path));
        listener.unref();
      `);
      expect(left).toBe(false);
    });

    test.concurrent("Bun.serve: unref'd server's socket file is removed on natural exit", async () => {
      const left = await socketFileAfterExit(`
        import { existsSync } from "node:fs";
        const path = process.argv[2];
        const server = Bun.serve({ unix: path, fetch: () => new Response("ok") });
        console.log("listening", existsSync(path));
        server.unref();
      `);
      expect(left).toBe(false);
    });

    // Node calls exit() directly for process.exit() without freeing the
    // environment, so no handle is closed and the file stays. Under
    // BUN_DESTRUCT_VM_ON_EXIT (ASAN CI lanes set it) every exit tears the VM
    // down like a worker's, which closes the listener, so the file goes too.
    const destructsVmOnExit = !["", "0", "false", "no", "off"].includes(
      (bunEnv.BUN_DESTRUCT_VM_ON_EXIT ?? "").toLowerCase(),
    );
    test.concurrent.skipIf(destructsVmOnExit)("net.Server: process.exit() leaves the socket file, like node", async () => {
      const left = await socketFileAfterExit(`
        import { existsSync } from "node:fs";
        import { createServer } from "node:net";
        const path = process.argv[2];
        createServer(() => {}).listen(path, () => {
          console.log("listening", existsSync(path));
          process.exit(0);
        });
      `);
      expect(left).toBe(true);
    });
  });

  test.skipIf(!isLinux)("abstract sockets are not unlinked", () => {
    const listener = Bun.listen({
      unix: "\0bun-uds-unlink-test-" + Math.random().toString(36).slice(2),
      socket: { data() {}, open() {} },
    });
    // Just verify stop() doesn't crash or throw on abstract sockets.
    listener.stop();
  });
});
