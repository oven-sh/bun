import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { once } from "node:events";
import http, { type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import { join } from "path";

// Each fixture internally loops hundreds/thousands of requests to hit the
// abort/destroy race. The counts below were validated by running the fixtures
// against the pre-fix release build (bun 1.2.6, commit 8ebd5d53d, before both
// #18485 and #18564) and counting crashes out of 10 runs:
//
//   fixture 1 (#18485): REQUESTS=500 5/5, 1000 5/5, 2000 10/10, 10000 10/10
//   fixture 2 (#18564): ROUNDS=20 1/5, 40-100 8/10, 200 10/10
//
// so a single spawn at 2000 / 200 catches the original bugs 10/10 on a release
// build without ASAN. ASAN/debug only reduces fixture 1 (the 80 s one); fixture
// 2 stays at 200 everywhere, equal to the previous 2x100 total.
const slow = isASAN || isDebug;
uafTest("node-http-uaf-fixture.ts", { REQUESTS: slow ? "2000" : "10000" });
uafTest("node-http-uaf-fixture-2.ts", { ROUNDS: "200" });

function uafTest(fixture: string, extraEnv: Record<string, string>) {
  test.concurrent(
    `should not crash on abort (${fixture})`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, fixture)],
        env: { ...bunEnv, ...extraEnv },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trimEnd().split("\n").at(-1)).toBe("Done");
      expect(exitCode).toBe(0);
    },
    // Measured ~21 s (fixture 1) / ~10 s (fixture 2) on a 16-core debug+ASAN
    // box with the other concurrent tests contending; release runs the full
    // 10k in ~1 s. Keep the 20 s release ceiling for the windows-aarch64 lane
    // that previously ran one fixture to 5006 ms.
    slow ? 60_000 : 20_000,
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

test("'request' and 'clientError' still dispatch on a connection that outlives server.close() and a GC", async () => {
  // A connection that is mid-request when close() runs is not idle, so it
  // survives close() (like Node) and can still complete requests or hit parse
  // errors afterwards. Nothing in JS references the native server's wrapper
  // once close() has run, so the open connection itself has to keep the
  // wrapper (the only GC root of both callbacks) alive until it is gone.
  async function round() {
    let server: Server | null = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": 2 });
      res.end("ok");
    });
    const clientErrors: string[] = [];
    server.on("clientError", (err: any, sock) => {
      clientErrors.push(err.code);
      sock.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const accepted = once(server, "connection");
    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    let received = "";
    let closed = false;
    let waiter = Promise.withResolvers<void>();
    const next = () => waiter.promise.then(() => (waiter = Promise.withResolvers()));
    client.setEncoding("latin1").on("data", chunk => {
      received += chunk;
      waiter.resolve();
    });
    client
      .on("error", () => {})
      .on("close", () => {
        closed = true;
        waiter.resolve();
      });
    await once(client, "connect");
    // Written before waiting for 'connection': with TCP_DEFER_ACCEPT (Linux)
    // the accept is only reported once the first bytes arrive.
    client.write("GET / HTTP/1.1\r\nHost: a\r\n");
    await accepted;

    server.close();
    server = null;
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));

    client.write("\r\n");
    while (!closed && !received.endsWith("\r\n\r\nok")) await next();
    if (!closed) client.write("GET / HTTP/1.1\r\nBad Header\r\n\r\n");
    while (!closed) await next();
    return { status: received.split("\r\n")[0], clientErrors };
  }

  const results = [];
  for (let i = 0; i < 3; i++) results.push(await round());
  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({ status: "HTTP/1.1 200 OK", clientErrors: ["HPE_INVALID_HEADER_TOKEN"] })),
  );
});
