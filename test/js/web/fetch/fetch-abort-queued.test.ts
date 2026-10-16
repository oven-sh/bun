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
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

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

// The JS thread names a request to the HTTP thread by an id (abort, request-body write, receive
// resume), so two live requests must never have the same id. Every fetch() takes an id, with or
// without a `signal` option: only requests that have no signal store at all, such as the package
// manifest requests of `bun install`, carry the id 0.
// - The id is 64-bit. The first two tests below give two requests ids that are 2**32 apart.
// - The last test aborts the first fetch of a process while it waits behind a request with id 0.
// The id counter is process-wide, so each scenario runs in its own process. The tests are not
// concurrent: a debug build needs 2 s to load bun:internal-for-testing in each process.

async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: options.cwd,
    env: { ...bunEnv, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  try {
    return { report: JSON.parse(stdout), exitCode };
  } catch {
    return { report: { stdout, stderr }, exitCode };
  }
}

// Gives "pending", or the name of the error that rejected the fetch.
const state = /* js */ `
  const state = promise => (Bun.peek.status(promise) === "rejected" ? Bun.peek(promise).name : Bun.peek.status(promise));
`;

// start("a") and start("b") are fetches that the server holds open. roundTrip() is a fetch that completes.
const heldRequests = /* js */ `
  import { fetchRequestIdInternals } from "bun:internal-for-testing";
  const { skipIds } = fetchRequestIdInternals;

  const arrived = { a: Promise.withResolvers(), b: Promise.withResolvers() };
  const server = Bun.serve({
    port: 0,
    // A held response must end only when its client aborts it.
    idleTimeout: 0,
    fetch(req) {
      const name = new URL(req.url).pathname.slice(1);
      if (!(name in arrived)) return new Response("ok");
      arrived[name].resolve();
      return new Promise(() => {});
    },
  });
  const start = name => {
    const controller = new AbortController();
    const promise = fetch(new URL(name, server.url), { signal: controller.signal });
    promise.catch(() => {});
    return { controller, promise };
  };
  // The HTTP thread handles every queued abort before it starts a queued request. So when this
  // fetch completes, the result of each abort() that came before it has been delivered.
  const roundTrip = async () => (await fetch(new URL("ok", server.url), { keepalive: false })).text();
  ${state}
`;

test("an abort reaches only its own request when another live request is 2**32 ids later", async () => {
  const fixture = /* js */ `
    ${heldRequests}
    const idOfA = skipIds(0);
    const a = start("a");
    // a took one id. Skip the rest of the 2**32 block, so that b gets the id 2**32 after it.
    const idOfB = skipIds(2 ** 32 - 1);
    // b connects after a. With one id for both, that id would now name the socket of b.
    await arrived.a.promise;
    const b = start("b");
    await arrived.b.promise;

    a.controller.abort();
    await roundTrip();
    const afterAbortOfA = { a: state(a.promise), b: state(b.promise) };
    b.controller.abort();
    await roundTrip();
    const afterAbortOfB = { a: state(a.promise), b: state(b.promise) };
    console.log(JSON.stringify({ idDistance: idOfB - idOfA, afterAbortOfA, afterAbortOfB }));
    process.exit(0);
  `;
  expect(await run(["-e", fixture])).toEqual({
    report: {
      idDistance: 2 ** 32,
      afterAbortOfA: { a: "AbortError", b: "pending" },
      afterAbortOfB: { a: "AbortError", b: "AbortError" },
    },
    exitCode: 0,
  });
});

test("an abort reaches its request after a request 2**32 ids later has completed", async () => {
  const fixture = /* js */ `
    ${heldRequests}
    const idOfA = skipIds(0);
    const a = start("a");
    await arrived.a.promise;
    // The next fetch gets the id 2**32 after the id of a. It starts and completes while a is live.
    const idOfLater = skipIds(2 ** 32 - 1);
    const later = await roundTrip();

    a.controller.abort();
    await roundTrip();
    console.log(JSON.stringify({ idDistance: idOfLater - idOfA, later, a: state(a.promise) }));
    process.exit(0);
  `;
  expect(await run(["-e", fixture])).toEqual({
    report: { idDistance: 2 ** 32, later: "ok", a: "AbortError" },
    exitCode: 0,
  });
});

test("an abort reaches the first fetch of a process behind a request without an abort signal", async () => {
  // The registry accepts TCP connections and never answers. A TLS connect to it stays pending, and
  // with the HTTP/2 client enabled, every later request to it waits on that one connect.
  const sockets: net.Socket[] = [];
  await using registry = net.createServer(socket => {
    sockets.push(socket);
    socket.on("error", () => {});
  });
  await once(registry.listen(0, "127.0.0.1"), "listening");
  const url = `https://127.0.0.1:${(registry.address() as net.AddressInfo).port}/`;

  using dir = tempDir("fetch-abort-queued", {
    "package.json": JSON.stringify({ name: "fetch-abort-queued", version: "1.0.0" }),
    "index.cjs": /* js */ `
      const sentinel = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      // See roundTrip in the tests above.
      const roundTrip = async () => (await fetch(sentinel.url, { keepalive: false })).text();
      ${state}
      // Each require() below asks the registry for a package manifest: a request without an abort
      // signal. The require() does not return, but it runs the event loop while it waits.
      setImmediate(() => {
        setImmediate(async () => {
          // Two manifest requests wait on the connect now. These two fetches wait behind them.
          const first = new AbortController();
          const second = new AbortController();
          const firstFetch = fetch(${JSON.stringify(url)}, { signal: first.signal });
          const secondFetch = fetch(${JSON.stringify(url)}, { signal: second.signal });
          firstFetch.catch(() => {});
          secondFetch.catch(() => {});
          await roundTrip();

          // The control: the abort of a request that waits on the connect works.
          second.abort();
          await roundTrip();
          const afterAbortOfSecond = { first: state(firstFetch), second: state(secondFetch) };
          first.abort();
          await roundTrip();
          const afterAbortOfFirst = { first: state(firstFetch), second: state(secondFetch) };
          console.log(JSON.stringify({ afterAbortOfSecond, afterAbortOfFirst }));
          process.exit(0);
        });
        try { require("fetch-abort-queued-missing-b"); } catch {}
      });
      try { require("fetch-abort-queued-missing-a"); } catch {}
    `,
  });

  const result = await run(["--install=force", "index.cjs"], {
    cwd: String(dir),
    env: {
      BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      BUN_CONFIG_REGISTRY: url,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
    },
  });
  for (const socket of sockets) socket.destroy();
  expect({ ...result, connections: sockets.length }).toEqual({
    report: {
      afterAbortOfSecond: { first: "pending", second: "AbortError" },
      afterAbortOfFirst: { first: "AbortError", second: "AbortError" },
    },
    exitCode: 0,
    // All four requests waited on one connect.
    connections: 1,
  });
});
