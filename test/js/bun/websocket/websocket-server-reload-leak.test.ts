import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each test runs its scenario in a child process (gcProtect bookkeeping is
// process-global) and reports measurements as one JSON line on stdout.
async function runProbe(script: string): Promise<any> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

// Counts protected AsyncFunction cells so the probe is insensitive to every
// other gcProtected plain Function in the process.
const protectedAsyncFnsPrelude = /* js */ `
  const { heapStats } = require("bun:jsc");
  const protectedAsyncFns = () => heapStats().protectedObjectTypeCounts.AsyncFunction ?? 0;
`;

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

  const { before, after, iters } = await runProbe(script);
  // With the leak, `after - before` is ~iters * 4 (one per close/drain/ping/pong).
  // Without it, the delta should be a small constant independent of `iters`.
  expect(after - before).toBeLessThan(iters);
});

// A handler defined in a scope that closes over the JS Server value forms a
// native↔JS cycle (server box → protected handler → closure environment →
// Server wrapper → box) that the GC cannot see through. Once the server is
// idle (stopped, no in-flight requests, no live websockets), deinitIfWeCan
// releases the config's handler references, including the gcProtects taken on
// the websocket handlers by WebSocketServerContext.onCreate.
test("stopping an idle server releases its websocket handler protections", async () => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
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

  const { base, afterServe, afterStop } = await runProbe(script);
  expect({ afterServe, afterStop }).toEqual({ afterServe: base + 2, afterStop: base });
});

// reload() on a stopped (idle) server is skipped entirely: the server can
// never dispatch the handlers it would install, so nothing new may end up
// protected (which would reinstate the cycle the idle release breaks).
test("a stopped server's reload does not leave newly installed websocket handler protections behind", async () => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
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

  const { base, afterStop, afterReload } = await runProbe(script);
  expect({ afterStop, afterReload }).toEqual({ afterStop: base, afterReload: base });
});

// gcProtect is counted per value. When two servers share the same handler
// functions, each onCreate protects them once. The idle release of a stopped
// server drops that server's count; a later reload() of the stopped server
// must not unprotect them again, or it strips the other server's protection
// of the same values.
test("reloading a stopped server does not release another server's shared websocket handler protections", async () => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
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

  const { base, afterReload, echoed } = await runProbe(script);
  expect({ afterReload, echoed }).toEqual({ afterReload: base + 2, echoed: "pong:hi" });
});

// A graceful stop() closes only the listener; websockets upgraded earlier
// stay connected and dispatch through whichever context a reload() installs,
// so the idle release must wait for them. Once the last one closes, the
// release has to fire right then: no request or finalizer is coming to
// trigger it later. Covers both orderings of stop() and reload().
test.each([
  ["stop() then reload()", /* js */ `server.stop(); doReload();`],
  ["reload() then stop()", /* js */ `doReload(); server.stop();`],
])("handlers stay protected while a websocket survives %s, then release when it closes", async (_order, sequence) => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
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

    const doReload = () =>
      server.reload({
        fetch() { return new Response("reloaded"); },
        websocket: {
          async open(ws) {},
          async message(ws, m) { ws.send("pong:" + m); },
        },
      });
    // The connected socket keeps the server from going idle throughout.
    ${sequence}

    // The socket now dispatches to the reload's handlers; they must still be
    // protected, and still work.
    const whileConnected = protectedAsyncFns();
    Bun.gc(true);
    client.send("hi");
    const echoed = await echoedMessage.promise;
    client.close();
    await closed.promise;

    // The server-side close drains the last live socket, which must run the
    // deferred idle release. The server event can lag the client's close
    // event by a beat, so poll for it.
    let afterClose = protectedAsyncFns();
    for (let i = 0; i < 200 && afterClose !== base; i++) {
      await Bun.sleep(10);
      afterClose = protectedAsyncFns();
    }
    console.log(JSON.stringify({ base, whileConnected, echoed, afterClose }));
  `;

  const { base, whileConnected, echoed, afterClose } = await runProbe(script);
  expect({ whileConnected, echoed, afterClose }).toEqual({
    whileConnected: base + 2,
    echoed: "pong:hi",
    afterClose: base,
  });
});
