// https://github.com/oven-sh/bun/issues/30325
//
// `bun install` would hang indefinitely when an HTTPS registry connection
// stalled during the TLS handshake: the HTTP client only armed its idle
// timer once `onWritable` fired *after* the handshake completed, so a server
// that accepted TCP (socket ESTABLISHED) but never answered ClientHello left
// the request — and the whole install — blocked in epoll_wait with no timer.
//
// The fix arms the idle timer in `onOpen()` and makes the duration
// configurable via `BUN_CONFIG_HTTP_IDLE_TIMEOUT` so this test can run in a
// few seconds rather than the 5-minute default.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import * as net from "node:net";
import { join } from "node:path";

// Accepts connections and never writes a byte.
async function silentServer() {
  let connects = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    connects++;
    sockets.add(socket);
    socket.on("data", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    get connects() {
      return connects;
    },
    port: (server.address() as net.AddressInfo).port,
    async [Symbol.asyncDispose]() {
      for (const s of sockets) s.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

// By default that is 5 minutes per attempt and 6 attempts, which looked like a hang: only --verbose mentioned the
// retries, and only once the last one had failed.
describe.concurrent("a retry after a timeout is announced immediately", () => {
  async function install(registry: string, dependencies: Record<string, string>, ...flags: string[]) {
    using dir = tempDir("install-silent-host", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...flags],
      env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1", BUN_CONFIG_HTTP_RETRY_COUNT: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { messages: stderr.split("\n").filter(line => /^(warn|error):/.test(line)), exitCode };
  }

  test("package manifest", async () => {
    await using silent = await silentServer();
    expect(await install(`http://127.0.0.1:${silent.port}/`, { "any-pkg": "1.0.0" })).toEqual({
      messages: [
        "warn: registry requests failed, retrying",
        "error: Timeout downloading package manifest any-pkg",
        "error: any-pkg@1.0.0 failed to resolve",
      ],
      exitCode: 1,
    });
    expect(silent.connects).toBe(2);
  }, 60_000);

  test("tarball", async () => {
    await using silent = await silentServer();
    await using registry = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": {
              name: "BaR",
              version: "0.0.2",
              dist: { tarball: `http://127.0.0.1:${silent.port}/BaR-0.0.2.tgz` },
            },
          },
        }),
    });
    expect(await install(registry.url.href, { BaR: "0.0.2" })).toEqual({
      messages: ["warn: registry requests failed, retrying", "error: Timeout downloading tarball BaR@0.0.2"],
      exitCode: 1,
    });
  }, 60_000);

  // The lines of --verbose about each request are only printed once everything is resolved.
  test("also with --verbose", async () => {
    await using silent = await silentServer();
    const { messages } = await install(`http://127.0.0.1:${silent.port}/`, { "any-pkg": "1.0.0" }, "--verbose");
    expect(messages[0]).toBe("warn: registry requests failed, retrying");
  }, 60_000);

  test("not with --silent", async () => {
    await using silent = await silentServer();
    const { messages } = await install(`http://127.0.0.1:${silent.port}/`, { "any-pkg": "1.0.0" }, "--silent");
    expect(messages.filter(line => line.startsWith("warn:"))).toEqual([]);
  }, 60_000);
});

// What a registry looks like when it drops the first packets of one connection: that connection stays silent, and
// the next one is answered at once. `bunEnv` sets BUN_CONFIG_HTTP_IDLE_TIMEOUT so that the installs of tests get
// through this.
test.concurrent(
  "bun install finishes on a new connection when the first one never answers the TLS handshake",
  async () => {
    const requests: string[] = [];
    let origin = "";
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        if (pathname === "/BaR-0.0.2.tgz") return new Response(Bun.file(join(import.meta.dir, "bar-0.0.2.tgz")));
        return Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: { "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${origin}/BaR-0.0.2.tgz` } } },
        });
      },
    });

    // Takes the ClientHello of the first connection and never answers it. Every later connection is piped to the
    // registry.
    let connects = 0;
    let unanswered = 0;
    const sockets = new Set<net.Socket>();
    const track = (socket: net.Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    };
    const front = net.createServer(socket => {
      track(socket);
      socket.on("error", () => {});
      if (++connects === 1) {
        socket.on("data", chunk => (unanswered += chunk.length));
        return;
      }
      const upstream = net.connect(registry.port!, "127.0.0.1");
      track(upstream);
      upstream.on("error", () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise<void>(resolve => front.listen(0, "127.0.0.1", resolve));
    origin = `https://127.0.0.1:${(front.address() as net.AddressInfo).port}`;

    try {
      using dir = tempDir("install-handshake-stall-once", {
        "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { BaR: "0.0.2" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry: `${origin}/` } }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        // The certificate of the harness is self-signed.
        env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(unanswered).toBeGreaterThan(0);
      expect({
        messages: stderr.split("\n").filter(line => /^(warn|error):/.test(line)),
        requests,
        installed: stdout.split("\n").filter(line => line.startsWith("+ ")),
        exitCode,
      }).toEqual({
        messages: ["warn: registry requests failed, retrying"],
        requests: ["/BaR", "/BaR-0.0.2.tgz"],
        installed: ["+ BaR@0.0.2"],
        exitCode: 0,
      });
      expect(await Bun.file(join(String(dir), "node_modules", "BaR", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>(resolve => front.close(() => resolve()));
    }
  },
  // One second is the shortest idle timeout, and the timer wheel fires it 4 to 8 seconds later. That is more than the
  // 5 seconds a test gets by default.
  60_000,
);

// The test above sets 1 second to be short. The installs of the other tests get the value of `bunEnv`, which has to
// stay below the timeout of the shortest test that installs from the public registry: 100 seconds, in
// dev-server-ssr-100.test.ts.
test.concurrent("bunEnv closes a silent connection before such a test times out", () => {
  expect(Number(bunEnv.BUN_CONFIG_HTTP_IDLE_TIMEOUT)).toBeWithin(1, 100);
});

test.concurrent(
  "bun install times out when the registry accepts TCP but never completes the TLS handshake",
  async () => {
    // Raw TCP listener: accepts the connection, reads (and discards) the
    // ClientHello, and never writes a single byte back. From the client's
    // point of view the socket is ESTABLISHED but the handshake stalls forever.
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on("data", () => {});
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      using dir = tempDir("install-handshake-stall", {
        "package.json": JSON.stringify({
          name: "stall-repro",
          version: "1.0.0",
          dependencies: { lodash: "4.17.21" },
        }),
        "bunfig.toml": Bun.TOML.stringify({
          install: {
            registry: `https://127.0.0.1:${port}/`,
          },
        }),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: {
          ...bunEnv,
          // Trip the idle timer after a few seconds instead of 5 minutes.
          BUN_CONFIG_HTTP_IDLE_TIMEOUT: "3",
          // Don't spin through 5 retries (each its own timeout) — one is enough
          // to prove the request completed with an error rather than hanging.
          BUN_CONFIG_HTTP_RETRY_COUNT: "0",
          // Keep the self-signed / hostname-mismatch check from short-circuiting
          // the handshake with a different error before the stall is observed.
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const combined = stdout + stderr;
      // The manifest GET should have failed with the idle-timeout error. Exact
      // wording differs between paths ("Timeout", "timed out"), so accept either.
      expect(combined.toLowerCase()).toMatch(/time.?out|timed out/);
      // Must have actually exited — a hang would never reach here, and a
      // successful install (somehow) would be wrong.
      expect(exitCode).not.toBe(0);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
  60_000,
);
