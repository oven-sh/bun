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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as net from "node:net";

test("bun install times out when the registry accepts TCP but never completes the TLS handshake", async () => {
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
      "bunfig.toml": `[install]\nregistry = "https://127.0.0.1:${port}/"\n`,
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
}, 60_000);
