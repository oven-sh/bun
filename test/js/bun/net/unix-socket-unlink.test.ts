import { describe, expect, test } from "bun:test";
import { isLinux, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

// Node.js/libuv behavior for unix domain sockets:
// - bind() does NOT unlink an existing socket file (returns EADDRINUSE)
// - close() DOES unlink the socket file it created
// Bun previously had this inverted (unlinked before bind, leaked on close).

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

  test.skipIf(!isLinux)("abstract sockets are not unlinked", () => {
    const listener = Bun.listen({
      unix: "\0bun-uds-unlink-test-" + Math.random().toString(36).slice(2),
      socket: { data() {}, open() {} },
    });
    // Just verify stop() doesn't crash or throw on abstract sockets.
    listener.stop();
  });
});
