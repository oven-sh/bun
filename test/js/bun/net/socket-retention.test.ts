// Regression guard for the TCPSocket/TLSSocket wrapper retention model.
//
// TCPSocket/TLSSocket hold their JS wrapper via jsc.JSRef: strong while the
// socket is active so callbacks can always recover the wrapper, weak once the
// socket is closed so GC can reclaim it. This test exercises both directions.

// @ts-ignore: generateHeapSnapshotForDebugging is not in bun-types
import { generateHeapSnapshotForDebugging, heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";

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

// The wrappers a native Strong holds right now, by class. A Strong is taken
// and released synchronously, so these counts are exact and need no GC.
function protectedCounts(): { TLSSocket: number; TCPSocket: number } {
  const { TLSSocket = 0, TCPSocket = 0 } = heapStats().protectedObjectTypeCounts;
  return { TLSSocket, TCPSocket };
}

// Live cells of `className` that a GC root reaches: native wrappers, and the
// rest (the prototype has the same class name and wraps nothing).
//
// heapStats().objectTypeCounts cannot answer this. JSC scans the machine stack
// conservatively, so a stale word in a native frame that is still on the stack
// keeps a cell alive until something writes over that word. JSC's debugging
// heap snapshot can: it runs a full GC and records every root and every edge
// that GC marks through, except the conservative scan. A cell that only a
// stack word keeps alive is in the snapshot, but no recorded root reaches it.
function rootedCells(className: string): { wrappers: number; others: number } {
  const { nodes, nodeClassNames, edges, roots } = generateHeapSnapshotForDebugging();
  // nodes: <id, size, classNameIndex, flags, labelIndex, cellAddress, wrappedAddress>
  // edges: <fromId, toId, typeIndex, data>
  // roots: <id, reasonIndex, reachabilityReasonIndex>
  const edgesFrom = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i += 4) {
    const to = edgesFrom.get(edges[i]);
    if (to) to.push(edges[i + 1]);
    else edgesFrom.set(edges[i], [edges[i + 1]]);
  }
  const reached = new Set<number>();
  const pending: number[] = [];
  for (let i = 0; i < roots.length; i += 3) pending.push(roots[i]);
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const to of edgesFrom.get(id) ?? []) pending.push(to);
  }
  const classIndex = nodeClassNames.indexOf(className);
  const counts = { wrappers: 0, others: 0 };
  for (let i = 0; i < nodes.length; i += 7) {
    if (nodes[i + 2] !== classIndex || !reached.has(nodes[i])) continue;
    if (nodes[i + 6] === "0x0") counts.others++;
    else counts.wrappers++;
  }
  return counts;
}

test("upgradeTLS raw + tls wrappers are both collectable after close", async () => {
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

  const baseline = protectedCounts().TLSSocket;
  const upgrades: { TLSSocket: number; TCPSocket: number }[] = [];

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
      const before = protectedCounts();
      const [raw, tls] = socket.upgradeTLS({
        tls: { ...tlsCert, ca: tlsCert.cert },
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
      const after = protectedCounts();
      upgrades.push({
        TLSSocket: after.TLSSocket - before.TLSSocket,
        TCPSocket: after.TCPSocket - before.TCPSocket,
      });
      void raw;
      void tls;
    })();
    await done;
  }

  // The upgrade moves the Strong from the open TCP wrapper to the two TLS
  // wrappers that replace it.
  expect(upgrades).toEqual(Array(5).fill({ TLSSocket: 2, TCPSocket: -1 }));

  // The last close handler resolved `done` from inside the close dispatch, and
  // that dispatch releases the tls wrapper on its way out. Let it return.
  await new Promise<void>(resolve => setImmediate(resolve));

  // We created 5 × 2 = 10 TLSSocket wrappers. If the Strong release on close is
  // missed, they stay protected.
  expect(protectedCounts().TLSSocket).toBe(baseline);
  // No other root reaches one either, so all of them are collectable.
  // `others` is the prototype: the walk does find rooted cells of this class.
  expect(rootedCells("TLSSocket")).toEqual({ wrappers: 0, others: 1 });
  // The heap snapshot takes a few seconds in a debug build.
}, 30_000);

test("tls.connect over a Duplex roots the origin and listener thunks through the wrapper, not as Strong handles", async () => {
  // UpgradedDuplex keeps the origin stream and its four native listener
  // thunks reachable via WriteBarrier slots on the JSTLSSocket wrapper.
  // Holding each as a separate Strong handle makes every TLS-over-duplex
  // connection add five HandleSet entries that live as long as the native
  // struct, independent of the wrapper's GC lifetime.
  //
  // heapStats().protectedObjectTypeCounts reports HandleSet-rooted values by
  // class, so with Strong handles N live upgrades contribute +4N Function and
  // +N origin objects; with visited slots they contribute none (the
  // wrapper's own self-reference is the only per-upgrade Strong).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const tls = require("node:tls");
        const { Duplex } = require("node:stream");
        const { heapStats } = require("bun:jsc");

        const protectedCounts = () => {
          const c = heapStats().protectedObjectTypeCounts;
          return { Function: c.Function ?? 0, Object: c.Object ?? 0 };
        };

        // Warm up so lazy module state doesn't skew the delta.
        const warm = tls.connect({
          socket: new Duplex({ read() {}, write(_c, _e, cb) { cb(); } }),
          rejectUnauthorized: false,
        });

        Bun.gc(true);
        const before = protectedCounts();

        const N = 20;
        const live = [];
        for (let i = 0; i < N; i++) {
          const origin = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
          live.push(tls.connect({ socket: origin, rejectUnauthorized: false }));
        }

        Bun.gc(true);
        const after = protectedCounts();

        console.log(JSON.stringify({
          N,
          fn: after.Function - before.Function,
          obj: after.Object - before.Object,
        }));
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { N, fn, obj } = JSON.parse(stdout.trim());
  // Without the visited slots these are fn≈4N and obj≈N. A small constant
  // slack absorbs any unrelated Strong created during the loop.
  expect(fn).toBeLessThan(N);
  expect(obj).toBeLessThan(N);
  expect(exitCode).toBe(0);
  void stderr;
});

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

// Windows routes `unix:` through WindowsNamedPipeContext. A connect that fails
// before libuv queues it (here: a TLS config that cannot build a context)
// reports the error through `handle_connect_error` while the socket is still
// detached, so that path releases nothing. The attempt ref taken in
// `connect_inner` must be released by the caller, as the POSIX path does.
test.skipIf(!isWindows)(
  "a named-pipe connect that fails synchronously does not leak the native socket",
  async () => {
    const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const socket = { open() {}, data() {}, close() {}, error() {}, connectError() {} };
    const opts = {
      unix: "\\\\\\\\.\\\\pipe\\\\bun-missing-" + process.pid,
      tls: { cert: "not a cert", key: "not a key" },
    };
    async function run(n) {
      for (let i = 0; i < n; i += 100) {
        await Promise.all(Array.from({ length: 100 }, () => Bun.connect({ ...opts, socket }).catch(() => {})));
      }
      for (let k = 0; k < 3; k++) {
        Bun.gc(true);
        await new Promise(r => setImmediate(r));
      }
    }
    // Live mimalloc pages: allocator bookkeeping, independent of OS reclamation.
    function pageCount() {
      return heapStats().mimalloc.page_bins.reduce((a, b) => a + b.current, 0);
    }
    await run(4000);
    const before = pageCount();
    await run(4000);
    const after = pageCount();
    console.log(JSON.stringify({ before, after, delta: after - before }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { before, after, delta } = JSON.parse(stdout.trim().split("\n").pop()!);
    // Without the balancing deref each run of 4000 leaks about 16 pages
    // (release) and many more under debug. With it the delta is heap noise.
    expect(delta, `mimalloc page count: ${before} -> ${after}`).toBeLessThan(10);
    expect(exitCode).toBe(0);
  },
  60_000,
);
