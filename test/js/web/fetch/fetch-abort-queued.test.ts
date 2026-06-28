// When `active_requests_count >= max_simultaneous_requests`, new fetch()
// requests sit in the HTTP thread's queue without a socket. Their
// `async_http_id` is therefore not in `socket_async_http_abort_tracker`, so
// `drainQueuedShutdowns` used to silently drop the abort and `drainEvents`
// would early-return without touching the queue. If every active request was
// itself hung, the aborted request's promise never settled even though
// `controller.abort()` had fired.
//
// The fix makes `drainEvents` fail-fast any queued task whose `aborted` signal
// is already set, regardless of whether a slot is free.
//
// Runs in a child process so we can set BUN_CONFIG_MAX_HTTP_REQUESTS without
// affecting the rest of the test suite.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* js */ `
  import { createServer } from "net";
  import { once } from "events";

  // Server that accepts connections and never responds.
  const sockets = [];
  const server = createServer(socket => { sockets.push(socket); });
  server.listen(0);
  await once(server, "listening");
  const port = server.address().port;

  // Fill the single available slot with a request that will hang forever.
  const hung = fetch("http://127.0.0.1:" + port + "/hung").catch(e => e);

  // Wait until the server has actually seen the connection so we know the
  // slot is occupied before queueing the next request.
  while (sockets.length === 0) await new Promise(r => setImmediate(r));

  // This request is queued behind max_simultaneous_requests; it has no socket.
  const controller = new AbortController();
  const queued = fetch("http://127.0.0.1:" + port + "/queued", {
    signal: controller.signal,
  });
  // Suppress unhandled-rejection noise while we wait below.
  queued.catch(() => {});

  // Give the HTTP thread a chance to pick it up (it can't — slot is full).
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  controller.abort();

  try {
    await queued;
    console.log("FAIL: queued fetch resolved");
  } catch (e) {
    if (e?.name === "AbortError") {
      console.log("OK: queued fetch rejected with AbortError");
    } else {
      console.log("FAIL: queued fetch rejected with", e?.name, e?.message);
    }
  }

  // The hung request should still be pending — aborting the queued one must
  // not have disturbed it.
  const hungState = await Promise.race([
    hung.then(() => "settled"),
    new Promise(r => setImmediate(() => r("pending"))),
  ]);
  console.log("hung request is", hungState);

  for (const s of sockets) s.destroy();
  server.close();
  await hung;
`;

test("aborting a fetch that is queued behind max_simultaneous_requests rejects the promise", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // ASAN debug builds unconditionally print a signal-handler warning to
  // stderr at startup; ignore that line.
  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderrLines).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["OK: queued fetch rejected with AbortError", "hung request is pending"]);
  expect(exitCode).toBe(0);
});

// Same property at the process-wide ceiling (4x the per-origin cap): four
// stalled origins pin the process at 4 * 1, so a fetch to a fifth, untouched
// origin is queued without a socket. Aborting it must still reject its promise.
const ceilingFixture = /* js */ `
  import { createServer } from "net";
  import { once } from "events";

  // Five servers that accept connections and never respond; only the first
  // four are fetched, so the fifth origin has no in-flight requests at all.
  const sockets = [];
  const servers = [];
  for (let i = 0; i < 5; i++) {
    const server = createServer(socket => { sockets.push(socket); });
    server.listen(0);
    await once(server, "listening");
    servers.push(server);
  }
  const ports = servers.map(server => server.address().port);

  const hung = ports.slice(0, 4).map(port => fetch("http://127.0.0.1:" + port + "/hung").catch(e => e));
  while (sockets.length < 4) await new Promise(r => setImmediate(r));

  const controller = new AbortController();
  const queued = fetch("http://127.0.0.1:" + ports[4] + "/queued", {
    signal: controller.signal,
  });
  queued.catch(() => {});

  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // The fifth origin must never get a socket: it is queued by the process-wide
  // ceiling, not in flight, so the abort is of a request with no connection.
  console.log("connections before abort:", sockets.length);
  controller.abort();

  try {
    await queued;
    console.log("FAIL: queued fetch resolved");
  } catch (e) {
    if (e?.name === "AbortError") {
      console.log("OK: queued fetch rejected with AbortError");
    } else {
      console.log("FAIL: queued fetch rejected with", e?.name, e?.message);
    }
  }

  const hungStates = await Promise.all(
    hung.map(p => Promise.race([p.then(() => "settled"), new Promise(r => setImmediate(() => r("pending")))])),
  );
  console.log("hung requests are", hungStates.join(","));

  for (const s of sockets) s.destroy();
  for (const server of servers) server.close();
  await Promise.all(hung);
`;

test("aborting a fetch that is queued behind the process-wide request ceiling rejects the promise", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", ceilingFixture],
    env: { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "connections before abort: 4",
    "OK: queued fetch rejected with AbortError",
    "hung requests are pending,pending,pending,pending",
  ]);
  expect(exitCode).toBe(0);
});
