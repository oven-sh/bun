import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as net from "node:net";

// Several tests below carry an explicit 30s budget rather than bun:test's 5s
// default. The socket timer is driven by uSockets' sweep, whose tick is 4
// seconds (`LIBUS_TIMEOUT_GRANULARITY`), so the workload cannot be shrunk below
// it: proving the timer did *not* fire means out-waiting a full tick. Same
// reason `test/cli/install/bun-install-stalled-tls.test.ts` does it.

// A raw TCP listener that accepts the connection, swallows the ClientHello, and
// never writes a byte back. To an `https:` client the socket is ESTABLISHED but
// the handshake stalls forever, so the request never leaves the connect phase.
// Same code path a dropped SYN takes (`first_call` is never reached), but
// deterministic enough to assert on.
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

async function stalledTlsPort(): Promise<number> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("data", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return (server.address() as net.AddressInfo).port;
}

test("connectTimeout rejects a stalled connect with TimeoutError", async () => {
  const port = await stalledTlsPort();
  await expect(
    fetch(`https://127.0.0.1:${port}/`, { connectTimeout: 250, tls: { rejectUnauthorized: false } }),
  ).rejects.toMatchObject({
    name: "TimeoutError",
    message: "The connection timed out.",
  });
});

test("timeout is a whole-request deadline and still bounds the connect phase", async () => {
  const port = await stalledTlsPort();
  // `timeout` bounds the whole request, so a connect that never completes is
  // caught by the overall deadline rather than a connect-specific one.
  await expect(
    fetch(`https://127.0.0.1:${port}/`, { timeout: 250, tls: { rejectUnauthorized: false } }),
  ).rejects.toMatchObject({
    name: "TimeoutError",
    message: "The operation timed out.",
  });
});

test("timeout fires mid-body, even while bytes are actively arriving", async () => {
  // The whole point of `timeout`: the connection is never idle, so `socketTimeout`
  // (10 minutes here) provably cannot be what cuts this off. The drip is bounded so
  // a build without `timeout` fails the assertion rather than hanging.
  const TIMEOUT_MS = 1_000;
  let remaining = 40; // 40 * 50ms = ~2s of steady dripping, well past TIMEOUT_MS.
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (remaining-- <= 0) {
              controller.close();
              return;
            }
            controller.enqueue(new TextEncoder().encode("drip"));
            await Bun.sleep(50);
          },
        }),
      );
    },
  });

  const response = await fetch(server.url, { timeout: TIMEOUT_MS, socketTimeout: 600_000 });
  await expect(response.text()).rejects.toMatchObject({
    name: "TimeoutError",
    message: "The operation timed out.",
  });
});

test("timeout does not fire on a request that finishes in time", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const response = await fetch(server.url, { timeout: 60_000 });
  expect(await response.text()).toBe("ok");
});

test("connectTimeout wins over a longer timeout, with the more specific message", async () => {
  // Both deadlines cover a stalled connect. The connect-specific one fires first
  // and reports the reason that actually tells a retry policy what went wrong.
  const port = await stalledTlsPort();
  await expect(
    fetch(`https://127.0.0.1:${port}/`, {
      connectTimeout: 250,
      timeout: 60_000,
      tls: { rejectUnauthorized: false },
    }),
  ).rejects.toMatchObject({
    name: "TimeoutError",
    message: "The connection timed out.",
  });
});

test("timeout of 0 disables every timeout", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const response = await fetch(server.url, { timeout: 0 });
  expect(await response.text()).toBe("ok");
});

test("connectTimeout cancels a streaming request body with the timeout reason", async () => {
  // https://fetch.spec.whatwg.org/#abort-fetch step 5: the request body must be
  // cancelled with the abort reason, the same way `AbortSignal.timeout` does it.
  const port = await stalledTlsPort();
  const { promise: cancelled, resolve: onCancel } = Promise.withResolvers<{ name: string; message: string }>();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("chunk"));
    },
    cancel(reason) {
      onCancel(reason);
    },
  });

  await expect(
    fetch(`https://127.0.0.1:${port}/`, {
      method: "POST",
      body,
      connectTimeout: 250,
      tls: { rejectUnauthorized: false },
    }),
  ).rejects.toMatchObject({ name: "TimeoutError", message: "The connection timed out." });

  const reason = await cancelled;
  expect({ name: reason.name, message: reason.message }).toEqual({
    name: "TimeoutError",
    message: "The connection timed out.",
  });
});

test("without connectTimeout, a stalled connect falls through to the socket timer", async () => {
  // Fail-safe for the above: prove the rejection comes from the connect
  // deadline and not from something else in the stalled-handshake path. With no
  // connect deadline the idle timer is what eventually fires, and it reports a
  // different message.
  const port = await stalledTlsPort();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
         await fetch("https://127.0.0.1:${port}/", { tls: { rejectUnauthorized: false } });
       } catch (e) {
         console.log(e.name + ": " + e.message);
       }`,
    ],
    env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({
    stdout: "TimeoutError: The operation timed out.",
    exitCode: 0,
  });
}, 30_000);

test("connectTimeout does not fire once connected", async () => {
  // The server answers long after `connect` elapses, but the connect phase
  // itself finished immediately: only the idle timer may apply past that point.
  const { promise: requestStarted, resolve: onRequest } = Promise.withResolvers<void>();
  const { promise: release, resolve: respond } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    async fetch() {
      onRequest();
      await release;
      return new Response("late");
    },
  });

  const pending = fetch(server.url, { connectTimeout: 50, socketTimeout: 60_000 });
  await requestStarted;
  // The connect deadline has long expired by the time the server replies.
  await Bun.sleep(200);
  respond();
  expect(await (await pending).text()).toBe("late");
});

test("socketTimeout rejects a stalled response body", async () => {
  const { promise: release, resolve: finish } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            await release;
            controller.close();
          },
        }),
      );
    },
  });

  const response = await fetch(server.url, { socketTimeout: 1_000 });
  await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
  finish();
}, 30_000);

// Note: that a per-request `socketTimeout` overrides the process-wide
// `BUN_CONFIG_HTTP_IDLE_TIMEOUT` is already covered by "socketTimeout rejects a
// stalled response body" above: it fires at ~1s against the 300s process
// default, which only happens if the per-request value replaced the default.
// The reverse direction (a larger per-request value outlasting a smaller
// default) exercises the same `effective_idle_timeout_seconds` branch, so it is
// not tested separately.

// https://github.com/oven-sh/bun/issues/16682
test("a numeric timeout longer than the socket-idle default is respected", async () => {
  const { promise: release, resolve: respond } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    async fetch() {
      await release;
      return new Response("ok");
    },
  });
  // Process-wide socket-idle default is 1s; the request asks for 10 minutes.
  // Without the fix, the idle default preempts the caller's deadline at ~1–5s.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await fetch(${JSON.stringify(server.url.href)}, { timeout: 600_000 });
       console.log(await r.text());`,
    ],
    env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
    stderr: "pipe",
  });
  await Bun.sleep(6_000);
  respond();
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
}, 30_000);

test("timeout: false disables the socket timer", async () => {
  const { promise: release, resolve: respond } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    async fetch() {
      await release;
      return new Response("ok");
    },
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await fetch(${JSON.stringify(server.url.href)}, { timeout: false });
       console.log(await r.text());`,
    ],
    env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
    stderr: "pipe",
  });
  await Bun.sleep(6_000);
  respond();
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
}, 30_000);

test("connectTimeout of 0 means no connect deadline", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const response = await fetch(server.url, { connectTimeout: 0 });
  expect(await response.text()).toBe("ok");
});

test("an explicit socketTimeout outranks timeout: false", async () => {
  // `timeout: false` turns everything off, but a socketTimeout the caller spelled
  // out is what they actually meant, so it has to survive.
  const { promise: release, resolve: respond } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            await release;
            controller.close();
          },
        }),
      );
    },
  });

  const response = await fetch(server.url, { timeout: false, socketTimeout: 1_000 });
  await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
  respond();
}, 30_000);

// Argument validation throws synchronously, like `maxRedirects` and `protocol`.
test.each([
  [-1, "fetch: 'timeout' must be a non-negative integer number of milliseconds, or false"],
  [1.5, "fetch: 'timeout' must be a non-negative integer number of milliseconds, or false"],
  [NaN, "fetch: 'timeout' must be a non-negative integer number of milliseconds, or false"],
  ["5s", "fetch: 'timeout' must be a boolean or a non-negative integer number of milliseconds"],
  [{ total: 5 }, "fetch: 'timeout' must be a boolean or a non-negative integer number of milliseconds"],
])("rejects an invalid timeout: %p", (value, message) => {
  expect(() => fetch("http://127.0.0.1:1/", { timeout: value as never })).toThrow(message);
});

test.each([
  ["connectTimeout", "fetch: 'connectTimeout' must be a non-negative integer number of milliseconds, or false"],
  ["socketTimeout", "fetch: 'socketTimeout' must be a non-negative integer number of milliseconds, or false"],
])("rejects an invalid %s", (key, message) => {
  expect(() => fetch("http://127.0.0.1:1/", { [key]: -5 } as never)).toThrow(message);
});
