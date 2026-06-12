import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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

// Static/file routes dispatch without JS and bump pendingRequests with no
// released-handlers guard, so a late request on a surviving keep-alive
// connection makes the released server transiently non-idle. A reload() in
// that window must still be skipped: the release already ran, so nothing
// the reload installs could ever be unprotected again.
//
// Skipped on Windows: the late request there never reaches the router (the
// precondition check below trips with "late static request never became
// pending"), so the pending window this race needs cannot open. The
// short-circuit under test is platform-independent.
test.skipIf(isWindows)(
  "reload() during a late static-route response on a released server does not leave handler protections behind",
  async () => {
    const script = /* js */ `
    ${protectedAsyncFnsPrelude}
    const net = require("node:net");
    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      // Big enough that a paused client forces backpressure, holding the
      // request pending while reload() runs.
      routes: { "/big": new Response(Buffer.alloc(8 << 20, 65)) },
      fetch() { return new Response("ok"); },
      websocket: { async open(ws) {}, async message(ws, m) {} },
    });
    const afterServe = protectedAsyncFns();

    const socket = net.connect(server.port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });

    // Serve one request first: the listener uses deferred accept, so a
    // connection that has not sent data yet dies with the listener instead
    // of surviving stop().
    const firstDone = Promise.withResolvers();
    let buffered = "";
    socket.on("data", d => {
      buffered += d.toString("latin1");
      if (buffered.includes("\\r\\n\\r\\nok")) firstDone.resolve();
    });
    socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: keep-alive\\r\\n\\r\\n");
    await firstDone.promise;

    // Graceful: only the listener closes; the established idle connection
    // does not keep the server from releasing its handlers.
    server.stop();
    const afterStop = protectedAsyncFns();

    // The static route still serves on the surviving connection. The paused
    // client never drains, so the response backpressures and the request
    // stays pending.
    socket.pause();
    socket.write("GET /big HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
    for (let i = 0; server.pendingRequests === 0; i++) {
      if (i > 400) throw new Error("late static request never became pending");
      await Bun.sleep(5);
    }

    server.reload({
      fetch() { return new Response("reloaded"); },
      websocket: { async open(ws) {}, async message(ws, m) {} },
    });
    const afterReload = protectedAsyncFns();

    // Abort the response; the completion that drops pendingRequests to zero
    // runs the idle pass synchronously in the same call.
    socket.destroy();
    for (let i = 0; server.pendingRequests > 0; i++) {
      if (i > 400) throw new Error("aborted static response never completed");
      await Bun.sleep(5);
    }
    const final = protectedAsyncFns();
    console.log(JSON.stringify({ base, afterServe, afterStop, afterReload, final }));
  `;

    const { base, afterServe, afterStop, afterReload, final } = await runProbe(script);
    expect({ afterServe, afterStop, afterReload, final }).toEqual({
      afterServe: base + 2,
      afterStop: base,
      afterReload: base,
      final: base,
    });
  },
);

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

// Server-side ws.close()/ws.terminate() set the closed flag and then
// synchronously re-enter on_close, which skips its own accounting; the
// methods balance the count themselves. If they did not, the live-socket
// count would stay above zero forever and the idle release could never run.
test.each(["close", "terminate"])("server-side ws.%s() keeps the live-socket count balanced", async method => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: {
        async open(ws) { ws.KICK_METHOD(); },
        async message(ws, m) {},
      },
    });

    const closed = Promise.withResolvers();
    const client = new WebSocket(server.url.href.replace("http", "ws"));
    client.onclose = () => closed.resolve();
    client.onerror = () => closed.resolve();
    await closed.promise;

    // The kicked socket must have been fully uncounted: this graceful stop
    // finds the server idle and releases the handlers.
    server.stop();
    let afterStop = protectedAsyncFns();
    for (let i = 0; i < 200 && afterStop !== base; i++) {
      await Bun.sleep(10);
      afterStop = protectedAsyncFns();
    }
    console.log(JSON.stringify({ base, afterStop }));
  `.replace("KICK_METHOD", method);

  const { base, afterStop } = await runProbe(script);
  expect(afterStop).toBe(base);
});

// stop(true) called from inside a websocket close handler: the calling
// socket's own decrement lands only after stop() returns, so the idle pass
// must still fire then (the transient draining flag is already cleared).
test("stop(true) from inside a websocket close handler still releases the handlers", async () => {
  const script = /* js */ `
    ${protectedAsyncFnsPrelude}
    const base = protectedAsyncFns();
    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: {
        open(ws) {},
        message(ws, m) {},
        // The only async handler, so the probe tracks exactly this closure,
        // which also captures \`server\` (the cycle the release breaks).
        async close(ws) {
          server.stop(true);
        },
      },
    });

    const clientClosed = Promise.withResolvers();
    const client = new WebSocket(server.url.href.replace("http", "ws"));
    const opened = Promise.withResolvers();
    client.onopen = () => opened.resolve();
    client.onclose = () => clientClosed.resolve();
    client.onerror = () => {
      opened.resolve();
      clientClosed.resolve();
    };
    await opened.promise;

    client.close();
    await clientClosed.promise;

    let afterStop = protectedAsyncFns();
    for (let i = 0; i < 200 && afterStop !== base; i++) {
      await Bun.sleep(10);
      afterStop = protectedAsyncFns();
    }
    console.log(JSON.stringify({ base, afterStop }));
  `;

  const { base, afterStop } = await runProbe(script);
  expect(afterStop).toBe(base);
});

// ws.close() from inside a message handler can drain the last socket of a
// stopped server, running the release while the dispatch is still on the
// stack. The released slots are zeroed, so the dispatch tail (the error
// callback for a throw after close) sees empty values instead of unrooted
// cells.
test("release during an in-flight dispatch does not call released handlers", async () => {
  const script = /* js */ `
    const server = Bun.serve({
      port: 0,
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: {
        open(ws) {},
        message(ws, m) {
          ws.close();
          throw new Error("boom");
        },
        error(e) {
          console.log("error-handler-ran");
        },
      },
    });

    const opened = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const client = new WebSocket(server.url.href.replace("http", "ws"));
    client.onopen = () => opened.resolve();
    client.onclose = () => closed.resolve();
    client.onerror = () => {
      opened.resolve();
      closed.resolve();
    };
    await opened.promise;

    // Graceful: the connected socket is the only thing keeping the server
    // from the idle release.
    server.stop();

    client.send("hi");
    await closed.promise;
    console.log("done");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The throw after close() surfaces through the default uncaught reporter
  // (stderr plus a nonzero exit, the same as a server that never had an
  // error handler); the released error handler must not run.
  expect(stdout).toBe("done\n");
  expect(stderr).toContain("boom");
  expect(exitCode).toBe(1);
});
