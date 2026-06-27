import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls } from "harness";

// Sentry BUN-3KFE: SEGV in drain_queued_shutdowns derefing a freed socket
// left in the abort tracker after Handler::on_close fell through on a
// DeadSocket/PooledSocket ext. See PR #32862 for the root-cause analysis.
//
// All production events were macOS aarch64 release; on Linux debug+ASAN the
// per-tick assert_abort_tracker_sockets_alive() check never fired pre-fix
// over ~10k iterations, so this test asserts the abort/close race stays
// memory-safe under ASAN: a leaked tracker entry trips ASAN (or the debug
// invariant check) in the child and fails the exit-code assertion.

const handshakeFailFixture = /* ts */ `
import { createServer } from "node:net";
import { once } from "node:events";

const ITERS = 200;

const server = createServer((socket) => {
  // Accept TCP, read the ClientHello, then reset: the client's TLS handshake
  // fails mid-flight while the JS side is racing an abort() against it.
  socket.once("data", () => {
    socket.resetAndDestroy?.() ?? socket.destroy();
  });
  socket.on("error", () => {});
});
server.listen(0);
await once(server, "listening");
const port = (server.address() as any).port;
const url = "https://127.0.0.1:" + port + "/";

let aborted = 0;
let errored = 0;
for (let i = 0; i < ITERS; i++) {
  const controller = new AbortController();
  const p = fetch(url, {
    signal: controller.signal,
    // @ts-ignore
    tls: { rejectUnauthorized: false },
  }).then(
    () => {},
    (e) => {
      if (e.name === "AbortError") aborted++;
      else errored++;
    },
  );
  // Vary the abort timing relative to connect/handshake so every
  // close_and_fail ordering is hit.
  switch (i % 5) {
    case 0:
      controller.abort();
      break;
    case 1:
      queueMicrotask(() => controller.abort());
      break;
    case 2:
      setTimeout(() => controller.abort(), 0);
      break;
    case 3:
      setTimeout(() => controller.abort(), 1);
      break;
    case 4:
      await Bun.sleep(1);
      controller.abort();
      break;
  }
  await p;
}
server.close();
console.log(JSON.stringify({ iters: ITERS, aborted, errored }));
`;

test.skipIf(!isASAN)("abort racing a TLS handshake failure does not leave a stale abort-tracker entry", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", handshakeFailFixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const summary = stdout.trim();
  expect({ summary, stderr, exitCode }).toEqual({
    summary: expect.stringMatching(/^\{"iters":200,"aborted":\d+,"errored":\d+\}$/),
    stderr: expect.any(String),
    exitCode: 0,
  });

  const { iters, aborted, errored } = JSON.parse(summary);
  expect({ iters, total: aborted + errored }).toEqual({ iters: 200, total: 200 });
});

const connectionCloseFixture = /* ts */ `
const ITERS = 250;

using server = Bun.serve({
  port: 0,
  tls: ${JSON.stringify(tls)},
  fetch() {
    return new Response("", { headers: { connection: "close" } });
  },
});
const url = "https://localhost:" + server.port + "/";

let settled = 0;
for (let i = 0; i < ITERS; i++) {
  const controller = new AbortController();
  const p = fetch(url, {
    signal: controller.signal,
    // @ts-ignore
    tls: { ca: ${JSON.stringify(tls.cert)} },
  }).then(
    (r) => r.arrayBuffer().catch(() => {}),
    () => {},
  ).finally(() => { settled++; });
  switch (i % 4) {
    case 0:
      controller.abort();
      break;
    case 1:
      queueMicrotask(() => controller.abort());
      break;
    case 2:
      setTimeout(() => controller.abort(), 0);
      break;
    case 3:
      await Bun.sleep(0);
      controller.abort();
      break;
  }
  await p;
}
console.log(JSON.stringify({ iters: ITERS, settled }));
`;

test.skipIf(!isASAN)(
  "abort racing a TLS Connection: close response does not leave a stale abort-tracker entry",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", connectionCloseFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ summary: stdout.trim(), stderr, exitCode }).toEqual({
      summary: JSON.stringify({ iters: 250, settled: 250 }),
      stderr: expect.any(String),
      exitCode: 0,
    });
  },
);
