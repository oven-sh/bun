import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("async handler's returned promise is traced via the response wrapper, not a per-request Strong", async () => {
  // Each async node:http request used to store the handler's pending promise
  // in a JSC::Strong on the native struct. Strong handles are GC roots that
  // heapStats().protectedObjectTypeCounts walks, so with N in-flight async
  // requests the Promise count there grew by N. The promise now lives in the
  // wrapper's WriteBarrier m_promise slot instead: still reachable (the
  // socket's Strong on the wrapper keeps it alive), just not a root. Runs in
  // a subprocess so the heapStats snapshot starts from a clean baseline.
  const src = /* js */ `
    const http = require("node:http");
    const { heapStats } = require("bun:jsc");

    const N = 16;
    const ABORT_FROM = 8;
    let hits = 0;
    const deferreds = Array.from({ length: N }, () => Promise.withResolvers());
    const inflight = Promise.withResolvers();

    const server = http.createServer(async (req, res) => {
      const j = Number(req.url.slice(1));
      if (++hits === N) inflight.resolve();
      await deferreds[j].promise;
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const before = heapStats().protectedObjectTypeCounts.Promise ?? 0;

      const received = [];
      const closeResolvers = [];
      const closed = Array.from({ length: N }, (_, i) => new Promise(r => (closeResolvers[i] = r)));
      const sockets = await Promise.all(Array.from({ length: N }, (_, j) =>
        Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            open(sock) {
              sock.write("GET /" + j + " HTTP/1.1\\r\\nHost: a\\r\\nConnection: close\\r\\n\\r\\n");
            },
            data(sock, buf) { received[j] = (received[j] ?? "") + buf.toString(); },
            close() { closeResolvers[j](); },
            error() {},
            connectError(_, err) { closeResolvers[j](err); },
          },
        }),
      ));
      await inflight.promise;

      // GC while every handler is parked on its await: the wrapper (rooted by
      // the server socket) must keep the promise reachable via m_promise.
      Bun.gc(true);
      const during = heapStats().protectedObjectTypeCounts.Promise ?? 0;

      // Abort the tail while their handlers are still parked so the abort
      // path threads the wrapper cell into mark_request_as_done and clears
      // the slot there, then release every handler so the head's on_resolve
      // runs with the flag still set and the tail's runs with it cleared.
      for (let i = ABORT_FROM; i < N; i++) sockets[i].end();
      await Promise.all(closed.slice(ABORT_FROM));

      for (const d of deferreds) d.resolve();
      await Promise.all(closed);
      Bun.gc(true);
      const after = heapStats().protectedObjectTypeCounts.Promise ?? 0;

      const statuses = received.slice(0, ABORT_FROM).map(r => (r ?? "").split("\\r\\n")[0]);
      console.log(JSON.stringify({
        N,
        okResponses: statuses.filter(s => s === "HTTP/1.1 200 OK").length,
        abortedGotNoBytes: received.slice(ABORT_FROM).every(r => r === undefined),
        promiseRootsDuring: during - before,
        promiseRootsAfter: after - before,
      }));
      process.exit(0);
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const parsed = JSON.parse(stdout.trim() || "null");
  expect({ parsed, stderr, exitCode }).toEqual({
    parsed: {
      N: 16,
      okResponses: 8,
      abortedGotNoBytes: true,
      promiseRootsDuring: expect.any(Number),
      promiseRootsAfter: expect.any(Number),
    },
    stderr: "",
    exitCode: 0,
  });
  // A handful of unrelated Strong<Promise> may come and go; what matters is
  // the count does not scale with N. With the per-request Strong the delta
  // was >= N; with the traced slot it is a small constant.
  expect(parsed.promiseRootsDuring).toBeLessThan(parsed.N / 2);
  expect(parsed.promiseRootsAfter).toBeLessThan(parsed.N / 2);
});
