import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// server.reload({ websocket: { close() {} } }) — i.e. a websocket config
// without `open` or `message` — is silently discarded by onReloadFromZig.
// WebSocketServerContext.onCreate has already JSC::gcProtect'd every handler
// by that point, so discarding without a matching unprotect permanently
// roots the callbacks (and anything their closures capture).
test("server.reload() with websocket config lacking open/message does not leak protected handlers", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");

    const server = Bun.serve({
      port: 0,
      fetch() { return new Response("ok"); },
      websocket: { open() {}, message() {} },
    });

    const protectedFns = () => heapStats().protectedObjectTypeCounts.Function ?? 0;

    const before = protectedFns();

    const ITERS = 200;
    for (let i = 0; i < ITERS; i++) {
      // Only close/drain/ping/pong — no open/message. onReloadFromZig drops
      // this config; previously the protect() from onCreate was never undone.
      server.reload({
        fetch() { return new Response("ok"); },
        websocket: {
          close() { void i; },
          drain() { void i; },
          ping() { void i; },
          pong() { void i; },
        },
      });
    }

    Bun.gc(true);
    const after = protectedFns();

    server.stop(true);

    // A handful of newly-protected functions is fine (e.g. the last reload's
    // fetch handler). Leaking four handlers per iteration would put the delta
    // near ITERS * 4 = 800.
    console.log(JSON.stringify({ before, after, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { before, after, iters } = JSON.parse(stdout.trim());
  // With the leak, `after - before` is ~iters * 4 (one per close/drain/ping/pong).
  // Without it, the delta should be a small constant independent of `iters`.
  expect(after - before).toBeLessThan(iters);
  expect(exitCode).toBe(0);
});

// A handler defined in a scope that closes over the JS Server value forms a
// native↔JS cycle (server box → protected handler → closure environment →
// Server wrapper → box) that the GC cannot see through. Once the server is
// idle (stopped, no in-flight requests, no live websockets), deinitIfWeCan
// releases the config's handler references, including the gcProtects taken on
// the websocket handlers by WebSocketServerContext.onCreate. Async handlers
// are used so the probe can count them separately from every other protected
// plain Function.
test("stopping an idle server releases its websocket handler protections", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;

    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch() { return new Response("ok"); },
      websocket: { async open(ws) {}, async message(ws, m) {} },
    });
    const afterServe = protectedAsyncFns();
    // stop(true) with nothing in flight goes idle synchronously and runs the
    // handler release in the same call.
    server.stop(true);
    const afterStop = protectedAsyncFns();
    console.log(JSON.stringify({ base, afterServe, afterStop }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { base, afterServe, afterStop } = JSON.parse(stdout.trim());
  expect({ afterServe, afterStop }).toEqual({ afterServe: base + 2, afterStop: base });
  expect(exitCode).toBe(0);
});

// reload() on a stopped (idle) server installs handlers that can never be
// invoked. The reload re-runs the idle release so they do not reinstate the
// cycle the idle release exists to break.
test("a stopped server's reload releases the newly installed websocket handler protections", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;

    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch() { return new Response("ok"); },
      websocket: { async open(ws) {}, async message(ws, m) {} },
    });
    server.stop(true);
    const afterStop = protectedAsyncFns();
    server.reload({
      fetch() { return new Response("reloaded"); },
      websocket: { async open(ws) {}, async message(ws, m) {} },
    });
    const afterReload = protectedAsyncFns();
    console.log(JSON.stringify({ base, afterStop, afterReload }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { base, afterStop, afterReload } = JSON.parse(stdout.trim());
  expect({ afterStop, afterReload }).toEqual({ afterStop: base, afterReload: base });
  expect(exitCode).toBe(0);
});

// gcProtect is counted per value. When two servers share the same handler
// functions, each onCreate protects them once. The idle release of a stopped
// server drops that server's count; a later reload() of the stopped server
// swaps in a new websocket context and must not unprotect the old one a
// second time, or it strips the other server's protection of the same values.
test("reloading a stopped server does not release another server's shared websocket handler protections", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;

    const base = protectedAsyncFns();
    // Both servers protect the same two async handler function values.
    const shared = {
      async open(ws) {},
      async message(ws, m) { ws.send("pong:" + m); },
    };
    const keeper = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("keeper");
      },
      websocket: shared,
    });
    const stopped = Bun.serve({
      port: 0,
      fetch() { return new Response("stopped"); },
      websocket: shared,
    });

    // Goes idle synchronously; releases the stopped server's handler refs.
    stopped.stop(true);
    // The reload's new websocket context uses plain functions so it cannot
    // affect the AsyncFunction count either way.
    stopped.reload({
      fetch() { return new Response("reloaded"); },
      websocket: { open(ws) {}, message(ws, m) {} },
    });
    const afterReload = protectedAsyncFns();

    // The keeper must still serve websockets with the shared handlers.
    const { promise, resolve, reject } = Promise.withResolvers();
    const ws = new WebSocket(keeper.url.href.replace("http", "ws"));
    ws.onmessage = e => resolve(e.data);
    ws.onerror = () => reject(new Error("keeper websocket errored"));
    ws.onclose = e => reject(new Error("keeper websocket closed early: " + e.code));
    ws.onopen = () => ws.send("hi");
    const echoed = await promise;
    ws.onclose = null;
    ws.close();
    keeper.stop(true);
    console.log(JSON.stringify({ base, afterReload, echoed }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { base, afterReload, echoed } = JSON.parse(stdout.trim());
  expect({ afterReload, echoed }).toEqual({ afterReload: base + 2, echoed: "pong:hi" });
  expect(exitCode).toBe(0);
});

// A graceful stop() closes only the listener; websockets upgraded earlier
// stay connected and, because each ServerWebSocket points at the inline
// config.websocket.handler storage, they dispatch through whichever context a
// reload() swaps in. The live-socket count must follow the swap or the idle
// release runs while those sockets can still invoke the new handlers.
test("reload of a gracefully stopped server keeps handlers protected while a websocket is still connected", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;

    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("ok");
      },
      // Plain functions so only the reload's async handlers are counted.
      websocket: { open(ws) {}, message(ws, m) {} },
    });

    const opened = Promise.withResolvers();
    const echoedMessage = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const client = new WebSocket(server.url.href.replace("http", "ws"));
    client.onopen = () => opened.resolve();
    client.onmessage = e => echoedMessage.resolve(e.data);
    client.onerror = () => {
      opened.reject(new Error("client websocket errored"));
      echoedMessage.reject(new Error("client websocket errored"));
    };
    client.onclose = () => closed.resolve();
    await opened.promise;

    // Graceful: the upgraded socket stays connected, so the server is not
    // idle and nothing is released here.
    server.stop();

    server.reload({
      fetch() { return new Response("reloaded"); },
      websocket: {
        async open(ws) {},
        async message(ws, m) { ws.send("pong:" + m); },
      },
    });
    // The connected socket now dispatches to the reload's handlers; they must
    // still be protected.
    const afterReload = protectedAsyncFns();

    Bun.gc(true);
    client.send("hi");
    const echoed = await echoedMessage.promise;
    client.close();
    await closed.promise;
    console.log(JSON.stringify({ base, afterReload, echoed }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { base, afterReload, echoed } = JSON.parse(stdout.trim());
  expect({ afterReload, echoed }).toEqual({ afterReload: base + 2, echoed: "pong:hi" });
  expect(exitCode).toBe(0);
});

// Same mechanism, opposite order: reload first (hot-reload style) while a
// websocket is connected, then stop() gracefully. The carried-over count must
// keep the idle release from firing until the socket actually closes.
test("graceful stop after a reload keeps handlers protected while a websocket is still connected", async () => {
  const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;

    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: { open(ws) {}, message(ws, m) {} },
    });

    const opened = Promise.withResolvers();
    const echoedMessage = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const client = new WebSocket(server.url.href.replace("http", "ws"));
    client.onopen = () => opened.resolve();
    client.onmessage = e => echoedMessage.resolve(e.data);
    client.onerror = () => {
      opened.reject(new Error("client websocket errored"));
      echoedMessage.reject(new Error("client websocket errored"));
    };
    client.onclose = () => closed.resolve();
    await opened.promise;

    server.reload({
      fetch() { return new Response("reloaded"); },
      websocket: {
        async open(ws) {},
        async message(ws, m) { ws.send("pong:" + m); },
      },
    });

    // The socket opened before the reload is still connected, so this
    // graceful stop must not release the reload's handlers.
    server.stop();
    const afterStop = protectedAsyncFns();

    Bun.gc(true);
    client.send("hi");
    const echoed = await echoedMessage.promise;
    client.close();
    await closed.promise;
    console.log(JSON.stringify({ base, afterStop, echoed }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { base, afterStop, echoed } = JSON.parse(stdout.trim());
  expect({ afterStop, echoed }).toEqual({ afterStop: base + 2, echoed: "pong:hi" });
  expect(exitCode).toBe(0);
});
