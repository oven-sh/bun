import { expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow } from "harness";
import { join } from "node:path";

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

// Every ws() registration (the "/*" fallback plus each GET-capable callback
// route) allocated a uWS WebSocketContext that the app only freed when it was
// destroyed. So each server.reload() of a websocket-enabled server kept one
// more generation of contexts. Now the app keeps one context and each ws()
// registration writes the behavior into it.
test("server.reload() on a websocket-enabled server does not keep a WebSocketContext per reload", async () => {
  // 600 reloads of 12 routes keep 7 to 9 MiB of contexts on bun 1.4.3. Fixed:
  // 0 to 1 MiB, on release and on an ASAN build with the quarantine off.
  // Each reload registers 13 websocket routes and an ASAN build spends about
  // 1 ms on each, so the fixture runs for 10 to 15 s there.
  await expectRssDeltaBelow([join(import.meta.dir, "websocket-server-reload-context-fixture.ts")], {
    release: 4,
    debug: 5,
  });
}, 60_000);

// With one shared context, the limits of the latest reload apply to sockets
// that were open before it, like the handlers already did.
test("server.reload() applies the new websocket maxPayloadLength to sockets opened before the reload", async () => {
  const config = (maxPayloadLength: number) => ({
    port: 0,
    fetch(req: Request, server: Bun.Server) {
      if (server.upgrade(req)) return;
      return new Response("not a websocket", { status: 400 });
    },
    websocket: {
      maxPayloadLength,
      message(ws: Bun.ServerWebSocket, message: string | Buffer) {
        ws.send(`got ${message.length} bytes`);
      },
    },
  });
  using server = Bun.serve(config(1 << 20));

  const open = () => {
    const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
    const ws = new WebSocket(server.url);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
    return promise;
  };
  const ask = (ws: WebSocket, message: string) => {
    const { promise, resolve } = Promise.withResolvers<string>();
    ws.onmessage = event => resolve(String(event.data));
    ws.onclose = event => resolve(`closed ${event.code}`);
    ws.send(message);
    return promise;
  };

  const before = await open();
  const big = Buffer.alloc(1000, "x").toString();
  expect(await ask(before, big)).toBe("got 1000 bytes");

  server.reload(config(64));
  const after = await open();

  expect(await ask(before, "small")).toBe("got 5 bytes");
  expect(await Promise.all([ask(before, big), ask(after, big)])).toEqual(["closed 1006", "closed 1006"]);
});

// The per-route upgrade data (which route matched, its params) lives in the
// HTTP route, not in the shared context, so every route still upgrades with
// its own data, with or without the `/*` fallback, before and after a reload.
test("websocket routes keep their own upgrade data on the shared context", async () => {
  const config = (version: number, withFallback: boolean) => ({
    port: 0,
    routes: {
      "/a/:name": (req: Bun.BunRequest<"/a/:name">, server: Bun.Server) =>
        server.upgrade(req, { data: `a:${req.params.name}` }) ? undefined : new Response("no", { status: 500 }),
      "/b/:name": (req: Bun.BunRequest<"/b/:name">, server: Bun.Server) =>
        server.upgrade(req, { data: `b:${req.params.name}` }) ? undefined : new Response("no", { status: 500 }),
    },
    fetch: withFallback
      ? (req: Request, server: Bun.Server) =>
          server.upgrade(req, { data: "fallback" }) ? undefined : new Response("no", { status: 500 })
      : undefined,
    websocket: {
      message(ws: Bun.ServerWebSocket<string>, message: string | Buffer) {
        ws.send(`v${version} ${ws.data} ${message}`);
      },
    },
  });

  const echo = (server: Bun.Server, path: string) => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(new URL(path, server.url));
    ws.onerror = reject;
    ws.onclose = event => reject(new Error(`closed ${event.code}`));
    ws.onmessage = event => {
      ws.onclose = null;
      ws.close();
      resolve(String(event.data));
    };
    ws.onopen = () => ws.send("hi");
    return promise;
  };

  for (const withFallback of [true, false]) {
    using server = Bun.serve(config(1, withFallback));
    const paths = withFallback ? ["/a/x", "/b/y", "/other"] : ["/a/x", "/b/y"];
    expect(await Promise.all(paths.map(path => echo(server, path)))).toEqual(
      withFallback ? ["v1 a:x hi", "v1 b:y hi", "v1 fallback hi"] : ["v1 a:x hi", "v1 b:y hi"],
    );
    server.reload(config(2, withFallback));
    expect(await Promise.all(paths.map(path => echo(server, path)))).toEqual(
      withFallback ? ["v2 a:x hi", "v2 b:y hi", "v2 fallback hi"] : ["v2 a:x hi", "v2 b:y hi"],
    );
  }
});
