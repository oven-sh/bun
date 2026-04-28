// Regression guard for the TCPSocket/TLSSocket wrapper retention model.
//
// TCPSocket/TLSSocket hold their JS wrapper via jsc.JSRef: strong while the
// socket is active so callbacks can always recover the wrapper, weak once the
// socket is closed so GC can reclaim it. This test exercises both directions.

import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tls as tlsCert } from "harness";

test("socket.data setter works inside connectError", async () => {
  // Before the JSRef migration, handleConnectError reset the cached raw
  // JSValue to .zero *before* invoking the connectError callback. The
  // `socket.data = x` setter then called `dataSetCached(.zero, ...)` —
  // a null JSCell — which segfaulted (release) / tripped UBSan (debug).
  // With JSRef the wrapper is downgraded (not zeroed) and setData resolves
  // the wrapper via getThisValue(), so the assignment works and the data
  // round-trips.
  //
  // Run in a subprocess so a crash is observed as a non-zero exit instead
  // of taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { promise, resolve } = Promise.withResolvers();
        Bun.connect({
          hostname: "127.0.0.1",
          port: 1,
          socket: {
            connectError(socket) {
              socket.data = { marker: "after-connect-error" };
              console.log(JSON.stringify(socket.data));
              resolve();
            },
            data() {},
          },
        }).catch(() => {});
        await promise;
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Positive assertion first: if the setter crashed, stdout is empty and
  // this fails with a clear message. On release builds the crash surfaces
  // as a non-zero exit; on debug-asan it surfaces as a UBSan null-deref.
  expect(stdout.trim()).toBe('{"marker":"after-connect-error"}');
  expect(exitCode).toBe(0);
  void stderr;
});

// Drive GC until the given object-type count is at or below `max`, or the
// iteration budget is exhausted. Returns the final count so the assertion
// message is useful on failure.
async function gcUntilCountAtMost(type: string, max: number): Promise<number> {
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    const count = heapStats().objectTypeCounts[type] || 0;
    if (count <= max) return count;
    await Bun.sleep(10);
  }
  return heapStats().objectTypeCounts[type] || 0;
}

test("active TCP socket wrapper survives GC until closed", async () => {
  // The server writes on a timer and records whether the client received
  // data after the test dropped its only JS reference to the client socket.
  // If the wrapper were not held strong while active, GC would finalize it
  // and the data callback would never fire.
  let received = false;
  let serverSide: any;

  await using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        serverSide = s;
      },
      data() {},
    },
  });

  // Scope the client reference so it is eligible for GC after this block.
  const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
  await (async () => {
    const client = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data() {
          received = true;
        },
        close() {
          markClosed();
        },
      },
    });
    // Drop the only local reference; the native side's strong ref must keep
    // the wrapper alive for the upcoming data callback.
    void client;
  })();

  // Aggressively GC while the socket is still open.
  for (let i = 0; i < 10; i++) {
    Bun.gc(true);
    await Bun.sleep(2);
  }

  // Server writes — the client's data callback must still fire.
  serverSide.write("hello");
  for (let i = 0; i < 50 && !received; i++) await Bun.sleep(5);
  expect(received).toBe(true);

  // Close and verify the wrapper becomes collectable.
  serverSide.end();
  await closed;

  const count = await gcUntilCountAtMost("TCPSocket", 3);
  expect(count).toBeLessThanOrEqual(3);
});

// Windows has a pre-existing TLSSocket lingerer in the upgradeTLS path
// (see the `isWindows ? 3 : 2` slack in socket.test.ts "should not leak
// memory"); on Windows 11 aarch64 the residual count is higher and varies,
// making a tight GC bound unreliable there. The Strong-release path this
// guards is platform-independent, so Linux/macOS coverage suffices.
test.skipIf(isWindows)("upgradeTLS raw + tls wrappers are both collectable after close", async () => {
  // upgradeTLS produces two TLSSocket wrappers (the raw passthrough and the
  // TLS socket) sharing one underlying connection. When the connection closes,
  // the raw socket is cleaned up via WrappedHandler.onClose which must release
  // its strong ref so both wrappers can be GC'd. A missed transition here pins
  // one of them forever.
  await using tlsServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const baseline = heapStats().objectTypeCounts.TLSSocket || 0;

  for (let i = 0; i < 5; i++) {
    const { promise: done, resolve } = Promise.withResolvers<void>();
    await (async () => {
      let body = "";
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: tlsServer.port,
        socket: {
          data() {},
          close() {},
          error() {},
        },
      });
      const [raw, tls] = socket.upgradeTLS({
        tls: tlsCert,
        socket: {
          drain(s) {
            s.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
          },
          data(s, chunk) {
            body += chunk.toString();
            if (body.includes("\r\n\r\n")) s.end();
          },
          close() {
            resolve();
          },
          error() {
            resolve();
          },
        },
      });
      void raw;
      void tls;
    })();
    await done;
  }

  // All upgradeTLS-created wrappers should be collectable now. We created
  // 5 × 2 = 10 TLSSocket wrappers; if the Strong release on close is missed,
  // they all pin and the count stays ≥ baseline + 10.
  const count = await gcUntilCountAtMost("TLSSocket", baseline + 2);
  expect(count).toBeLessThanOrEqual(baseline + 2);
});

// Debug-only: relies on `[alloc] new/destroy(T)` tracing in bun.new/destroy
// which is compiled out in release builds.
test.skipIf(!isDebug)("upgradeDuplexToTLS frees its DuplexUpgradeContext after close", async () => {
  // tls.connect({socket: <Duplex>}) goes through jsUpgradeDuplexToTLS which
  // heap-allocates a DuplexUpgradeContext. On close the context enqueues a
  // .Close task that is supposed to deinit() and bun.destroy() it. Previously
  // the task only called upgrade.close() — a no-op once UpgradedDuplex.onClose
  // has already torn the wrapper down — so deinit() was dead code (it even
  // referenced a nonexistent `this.destroy()`), and every duplex-upgraded
  // TLS connection leaked one context allocation.
  //
  // The leaked struct holds no live JS roots by the time it leaks, so it is
  // invisible to heapStats().objectTypeCounts. We instead use the debug
  // allocator log to assert every new(DuplexUpgradeContext) is paired with a
  // destroy(DuplexUpgradeContext).
  const script = `
    const tls = require("node:tls");
    const net = require("node:net");
    const { Duplex } = require("node:stream");
    const { once } = require("node:events");

    const server = Bun.serve({
      port: 0,
      tls: ${JSON.stringify(tlsCert)},
      fetch() { return new Response("ok"); },
    });

    async function round() {
      const raw = net.connect({ host: "127.0.0.1", port: server.port });
      await once(raw, "connect");
      // Wrap in a plain Duplex so net.ts takes the upgradeDuplexToTLS path
      // rather than native socket.upgradeTLS.
      const proxy = new Duplex({
        write(chunk, enc, cb) { raw.write(chunk, enc, cb); },
        final(cb) { raw.end(); cb(); },
        read() {},
      });
      raw.on("data", c => proxy.push(c));
      raw.on("close", () => proxy.push(null));
      const sock = tls.connect({ socket: proxy, servername: "localhost", rejectUnauthorized: false });
      await once(sock, "secureConnect");
      sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
      await once(sock, "close");
      raw.destroy();
    }

    for (let i = 0; i < 5; i++) await round();
    // Let the deferred .Close tasks drain.
    for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(5); }
    server.stop(true);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: undefined, BUN_DEBUG_alloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Output.scoped() writes to stdout; merge both in case that ever changes.
  const log = stdout + stderr;
  const created = [...log.matchAll(/\[alloc\] new\(DuplexUpgradeContext\)/g)].length;
  const destroyed = [...log.matchAll(/\[alloc\] destroy\(DuplexUpgradeContext\)/g)].length;
  // Sanity: the upgrade path actually ran. Every context must be freed.
  expect({ created, destroyed }).toEqual({ created: 5, destroyed: 5 });
  expect(exitCode).toBe(0);
}, 60_000);

test("node:net reconnect after connectError does not accumulate wrappers", async () => {
  // node:net reuses the same native socket across reconnects. With JSRef,
  // handleConnectError downgrades the wrapper (instead of clearing the raw
  // JSValue cache), so subsequent getThisValue() calls return the same
  // wrapper rather than creating orphaned duplicates that each call
  // finalize() on GC.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const net = require("node:net");
        const { heapStats } = require("bun:jsc");
        const socket = new net.Socket();
        let attempt = 0;
        socket.on("error", () => {
          if (attempt++ < 10) {
            socket.connect({ port: 1, host: "127.0.0.1", autoSelectFamily: false });
          } else {
            socket.destroy();
            (async () => {
              for (let i = 0; i < 30; i++) { Bun.gc(true); await Bun.sleep(10); }
              const n = heapStats().objectTypeCounts.TCPSocket || 0;
              console.log(JSON.stringify({ count: n }));
            })();
          }
        });
        socket.connect({ port: 1, host: "127.0.0.1", autoSelectFamily: false });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { count } = JSON.parse(stdout.trim().split("\n").pop()!);
  // Prototype/structure plus at most one live wrapper.
  expect(count).toBeLessThanOrEqual(3);
  expect(exitCode).toBe(0);
  void stderr;
}, 30_000);
