import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

// Regression: `@azure/msal-node`'s `LoopbackClient.closeServer` calls
//   server.close();
//   server.closeAllConnections();
//   server.unref();
// in sequence. Bun used to null out the internal server reference in
// `close()`, so the subsequent `closeAllConnections()` was a no-op —
// the keep-alive socket kept the event loop alive and the process hung.
// Issue: https://github.com/oven-sh/bun/issues/30501
test("closeAllConnections() after close() force-closes in-flight sockets", async () => {
  const { promise: requestReceived, resolve: resolveReceived } = Promise.withResolvers<void>();
  const server = http.createServer((req, _res) => {
    // Signal receipt but DO NOT reply — socket is "in flight" (not idle)
    // when the teardown sequence runs. This is the case where close()
    // alone (which only closes idle connections) cannot reclaim the
    // socket, and closeAllConnections() must do it.
    resolveReceived();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const sock = connect(port, "127.0.0.1");
  const { promise: sockClosed, resolve: resolveClosed } = Promise.withResolvers<void>();
  sock.on("close", () => resolveClosed());
  sock.on("error", () => {});
  await once(sock, "connect");
  sock.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
  await requestReceived;

  // msal-style teardown — no waiting between calls
  server.close();
  server.closeAllConnections();
  server.unref();

  // The client socket must be force-closed by closeAllConnections().
  // Without the fix, the socket stays open indefinitely (msal hang).
  await sockClosed;
});

// Regression: when a caller does close() and then listen() again before
// the previous shutdown's allClosed promise has fulfilled, the stale
// callback must not null out the newly-created server handle.
test("listen() during an in-flight close() doesn't corrupt the new server", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));

  await once(server.listen(0, "127.0.0.1"), "listening");

  // Fire-and-forget close; don't wait for the allClosed callback.
  server.close();

  // Re-listen immediately while the previous shutdown is still settling.
  await once(server.listen(0, "127.0.0.1"), "listening");
  const secondAddress = server.address() as AddressInfo | null;
  expect(secondAddress).not.toBeNull();
  const secondPort = secondAddress!.port;
  expect(secondPort).toBeInteger();

  // Drain the new server — address() must still return a port after
  // microtasks run (this is where the stale close callback would have
  // hit, pre-fix).
  await new Promise(r => setImmediate(r));
  expect((server.address() as AddressInfo | null)?.port).toBe(secondPort);

  // Confirm the new server actually serves requests, not just has a port.
  const res = await fetch(`http://127.0.0.1:${secondPort}`);
  expect(await res.text()).toBe("ok");

  await new Promise<void>(r => server.close(() => r()));
});

// Regression: close() now leaves the native handle populated (so
// closeAllConnections()/unref() can still reach it), which means ref()
// must not re-pin the event loop on an already-closed server. A stray
// ref() after close() would otherwise keep the loop alive until GC.
test("ref() after close() does not keep the event loop alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const server = http.createServer();
        server.listen(0, "127.0.0.1", () => {
          server.close();
          // Pre-fix this re-activated the poll ref on a closed server and
          // pinned the loop (no listener, no connections) until GC.
          server.ref();
          process.stdout.write("REF_DONE\\n");
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // If ref() re-pinned the loop, the subprocess never exits and
  // `proc.exited` never resolves — the runner's timeout catches that.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("REF_DONE");
  expect(exitCode).toBe(0);
});

// End-to-end: spawn a child that opens an HTTP server, accepts a
// keep-alive connection, and calls the msal teardown. Must exit
// immediately — not wait for the keep-alive idle timeout to reclaim
// the in-flight socket.
test("process exits after close() + closeAllConnections() + unref() teardown", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const net = require("node:net");
        const server = http.createServer((req, _res) => {
          // Never reply — keep the socket in-flight (not idle) so that
          // only closeAllConnections() (abrupt) can reclaim it.
          server.close();
          server.closeAllConnections();
          server.unref();
          process.stdout.write("TEARDOWN_DONE\\n");
        });
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const sock = net.connect(port, "127.0.0.1", () => {
            sock.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: keep-alive\\r\\n\\r\\n");
          });
          sock.on("data", () => {});
          sock.on("error", () => {});
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // If the teardown path is broken, the subprocess never exits and
  // `proc.exited` never resolves — the bun:test runner's default 5s
  // timeout catches that.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Surface any uncaught exception / ASAN trace before the exit-code
  // assertion so failures point at the real cause.
  expect(stderr).toBe("");
  expect(stdout).toContain("TEARDOWN_DONE");
  expect(exitCode).toBe(0);
});
