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

// Each route that can be upgraded (and the fallback) used to get a uWS WebSocketContext of its own on every
// reload, and contexts are only freed with the app. 400 reloads of 12 routes kept 5 MiB (release) or 8 MiB (ASAN);
// the same reloads without `websocket` grow by 0.5 and 1.5 MiB. The 7800 route registrations take 4 to 5 s on ASAN.
test("server.reload() does not keep a WebSocketContext per route and reload", async () => {
  await expectRssDeltaBelow([join(import.meta.dir, "websocket-server-reload-context-fixture.ts")], {
    release: 2.5,
    debug: 4.5,
  });
}, 30_000);

function connect(url: URL | string) {
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = reject;
  return promise;
}

// The answer to `message`, or how the connection closed instead.
function ask(ws: WebSocket, message: string) {
  const { promise, resolve } = Promise.withResolvers<string>();
  ws.onmessage = event => resolve(String(event.data));
  ws.onclose = event => resolve(`closed ${event.code}`);
  ws.send(message);
  return promise;
}

// The handlers of the latest reload already applied to sockets that were open before it.
test("server.reload() applies the new maxPayloadLength to sockets opened before it", async () => {
  const config = (maxPayloadLength: number) => ({
    port: 0,
    fetch(req: Request, server: Bun.Server<undefined>) {
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
  using server = Bun.serve(config(1024 * 1024));

  const before = await connect(server.url);
  const big = Buffer.alloc(1000, "x").toString();
  expect(await ask(before, big)).toBe("got 1000 bytes");

  server.reload(config(64));
  const after = await connect(server.url);

  expect(await ask(before, "small")).toBe("got 5 bytes");
  expect(await Promise.all([ask(before, big), ask(after, big)])).toEqual(["closed 1009", "closed 1009"]);
});

test("server.reload() from inside a websocket handler", async () => {
  const config = (version: number) => ({
    port: 0,
    fetch(req: Request, server: Bun.Server<undefined>) {
      if (server.upgrade(req)) return;
      return new Response("not a websocket", { status: 400 });
    },
    websocket: {
      message(ws: Bun.ServerWebSocket, message: string | Buffer) {
        if (message === "reload") server.reload(config(version + 1));
        ws.send(`v${version} ${message}`);
      },
    },
  });
  using server = Bun.serve(config(1));

  const ws = await connect(server.url);
  expect([await ask(ws, "reload"), await ask(ws, "reload"), await ask(ws, "hi")]).toEqual([
    "v1 reload",
    "v2 reload",
    "v3 hi",
  ]);
  ws.onclose = null;
  ws.close();
});

// Which route matched and its params belong to the HTTP route, not to the context the routes share.
test.each([true, false])("routes upgrade with their own data across a reload (fallback: %p)", async withFallback => {
  const config = (version: number) => ({
    port: 0,
    routes: {
      "/a/:name": (req: Bun.BunRequest<"/a/:name">, server: Bun.Server<string>) =>
        server.upgrade(req, { data: `a:${req.params.name}` }) ? undefined : new Response("no", { status: 500 }),
      "/b/:name": (req: Bun.BunRequest<"/b/:name">, server: Bun.Server<string>) =>
        server.upgrade(req, { data: `b:${req.params.name}` }) ? undefined : new Response("no", { status: 500 }),
    },
    fetch: withFallback
      ? (req: Request, server: Bun.Server<string>) =>
          server.upgrade(req, { data: "fallback" }) ? undefined : new Response("no", { status: 500 })
      : undefined,
    websocket: {
      message(ws: Bun.ServerWebSocket<string>, message: string | Buffer) {
        ws.send(`v${version} ${ws.data} ${message}`);
      },
    },
  });
  using server = Bun.serve(config(1));

  async function echo(path: string) {
    const ws = await connect(new URL(path, server.url));
    const answer = await ask(ws, "hi");
    ws.onclose = null;
    ws.close();
    return answer;
  }

  const paths = withFallback ? ["/a/x", "/b/y", "/other"] : ["/a/x", "/b/y"];
  expect(await Promise.all(paths.map(echo))).toEqual(
    withFallback ? ["v1 a:x hi", "v1 b:y hi", "v1 fallback hi"] : ["v1 a:x hi", "v1 b:y hi"],
  );
  server.reload(config(2));
  expect(await Promise.all(paths.map(echo))).toEqual(
    withFallback ? ["v2 a:x hi", "v2 b:y hi", "v2 fallback hi"] : ["v2 a:x hi", "v2 b:y hi"],
  );
});
