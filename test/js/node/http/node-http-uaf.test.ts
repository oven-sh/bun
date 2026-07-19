import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join } from "path";

uafTest("node-http-uaf-fixture.ts");
uafTest("node-http-uaf-fixture-2.ts");

function uafTest(fixture, iterations = 2) {
  test(
    `should not crash on abort (${fixture})`,
    async () => {
      for (let i = 0; i < iterations; i++) {
        const { exited } = Bun.spawn({
          cmd: [bunExe(), join(import.meta.dir, fixture)],
          env: bunEnv,
          stdout: "inherit",
          stderr: "inherit",
          stdin: "ignore",
        });
        const exitCode = await exited;
        expect(exitCode).not.toBeNull();
        expect(exitCode).toBe(0);
      }
    },
    // The express fixture pushes 10k aborted requests; one iteration runs
    // ~10 s under ASAN instrumentation (~1 s on release), so two iterations
    // can never fit the 5 s default there. The full file measures ~2.1 s on a
    // release x64 box, and the windows-11-aarch64 agent ran a single fixture
    // to 5006 ms - just over the default - so give release the same measured
    // headroom instead of sitting on the line.
    isASAN ? 90_000 : 20_000,
  );
}

test.concurrent.each([
  ["undefined", "undefined"],
  ["null", "null"],
  ["0", "0"],
  ["false", "false"],
])("should not crash when drain fires after onWritable slot is set to %s", async (_, slotExpr) => {
  const src = /* js */ `
    import http from "node:http";
    import net from "node:net";
    import { once } from "node:events";

    let caught;
    process.on("uncaughtException", err => { caught = String(err); });

    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(Buffer.alloc(8 * 1024 * 1024, "a"));
      const sym = Object.getOwnPropertySymbols(res).find(s => s.description === "handle");
      const handle = res[sym];
      handle.onwritable = ${slotExpr};
      while (handle.bufferedAmount > 0) await new Promise(r => setImmediate(r));
      res.end();
    });
    await once(server.listen(0), "listening");

    const sock = net.connect(server.address().port, "127.0.0.1");
    await once(sock, "connect");
    sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
    let received = 0;
    sock.on("data", d => (received += d.length));
    await once(sock, "close");
    console.log(JSON.stringify({ received, caught }));
    server.close();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    stdout: { received: expect.any(Number) },
    stderr: "",
    exitCode: 0,
  });
  expect(JSON.parse(stdout).received).toBeGreaterThan(8 * 1024 * 1024);
});

test("'connection' and 'clientError' callbacks survive GC", async () => {
  // The server's native struct stores these two node:http callbacks on the JS
  // wrapper (GC-visited WriteBarrier slots), not in Strong handles. Force GC
  // between registration and dispatch to prove the wrapper roots them.
  let gotConnection = 0;
  let gotClientError = 0;
  const server = http.createServer((req, res) => res.end());
  server.on("connection", () => void gotConnection++);
  server.on("clientError", (err, sock) => {
    gotClientError++;
    sock.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    Bun.gc(true);

    const sock = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    sock.on("error", () => {});
    await once(sock, "connect");
    Bun.gc(true);
    sock.write("!!!garbage!!!\r\n\r\n");
    await once(sock, "close");

    expect({ gotConnection, gotClientError }).toEqual({ gotConnection: 1, gotClientError: 1 });
  } finally {
    server.close();
  }
});

test.concurrent(
  "async handler's returned promise is traced via the response wrapper, not a per-request Strong",
  async () => {
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

      process.on("uncaughtException", () => {});

      const N = 64;
      const deferreds = [];
      let resolveInflight;
      const inflight = new Promise(r => (resolveInflight = r));

      const server = http.createServer(async (req, res) => {
        const d = Promise.withResolvers();
        deferreds.push(d);
        if (deferreds.length === N) resolveInflight();
        await d.promise;
        res.end("ok");
      });
      server.listen(0, "127.0.0.1", async () => {
        const port = server.address().port;
        const before = heapStats().protectedObjectTypeCounts.Promise ?? 0;

        const received = [];
        const closeResolvers = [];
        const closed = Array.from({ length: N }, (_, i) => new Promise(r => (closeResolvers[i] = r)));
        await Promise.all(Array.from({ length: N }, (_, j) =>
          Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: {
              open(sock) {
                sock.write("GET / HTTP/1.1\\r\\nHost: a\\r\\nConnection: close\\r\\n\\r\\n");
              },
              data(sock, buf) { received[j] = (received[j] ?? "") + buf.toString(); },
              close() { closeResolvers[j](); },
              error() {},
            },
          }),
        ));
        await inflight;

        // GC while every handler is parked on its await: the wrapper (rooted by
        // the server socket) must keep the promise reachable via m_promise.
        Bun.gc(true);
        const during = heapStats().protectedObjectTypeCounts.Promise ?? 0;

        // release and verify every response completes (proves the slot held on)
        for (const d of deferreds) d.resolve();
        await Promise.all(closed);
        const after = heapStats().protectedObjectTypeCounts.Promise ?? 0;

        const statuses = received.map(r => r.split("\\r\\n")[0]);
        console.log(JSON.stringify({
          N,
          allOk: statuses.length === N && statuses.every(s => s === "HTTP/1.1 200 OK"),
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
        N: 64,
        allOk: true,
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
  },
  isASAN ? 30_000 : 15_000,
);
