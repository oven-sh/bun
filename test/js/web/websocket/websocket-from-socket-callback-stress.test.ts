// Stress repro for segfault in WebSocketUpgradeClient.buildRequestBody
// (_mi_heap_realloc_zero NULL heap) observed on linux x86_64_baseline
// StandaloneExecutable when `new WebSocket()` is constructed from inside a
// Bun.connect onData callback with proxy env vars set at runtime.
//
// Run under ASAN: bun bd test test/js/web/websocket/websocket-from-socket-callback-stress.test.ts
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("WebSocket created inside Bun.connect onData with runtime proxy env does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", FIXTURE],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("DONE");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

const FIXTURE = /* js */ `
const ITERATIONS = 200;

// WebSocket server that accepts upgrades and immediately closes.
const wsServer = Bun.serve({
  port: 0,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("no upgrade", { status: 400 });
  },
  websocket: {
    open(ws) { ws.close(); },
    message() {},
  },
});

// Minimal HTTP proxy that tunnels CONNECT and forwards plain ws:// upgrades.
const proxyServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) { socket.data = { buf: Buffer.alloc(0), upstream: null }; },
    data(socket, chunk) {
      const d = socket.data;
      if (d.upstream) { d.upstream.write(chunk); return; }
      d.buf = Buffer.concat([d.buf, chunk]);
      const headEnd = d.buf.indexOf("\\r\\n\\r\\n");
      if (headEnd === -1) return;
      // For ws:// through an HTTP proxy, client sends the upgrade directly
      // (absolute-URI or CONNECT). Either way, just tunnel to the ws server.
      Bun.connect({
        hostname: "127.0.0.1",
        port: wsServer.port,
        socket: {
          open(up) {
            d.upstream = up;
            up.data = socket;
            const head = d.buf.subarray(0, headEnd + 4).toString();
            if (head.startsWith("CONNECT ")) {
              socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
              const rest = d.buf.subarray(headEnd + 4);
              if (rest.length) up.write(rest);
            } else {
              up.write(d.buf);
            }
          },
          data(up, chunk) { up.data?.write(chunk); },
          close(up) { up.data?.end(); },
          error() {},
        },
      }).catch(() => socket.end());
    },
    close(socket) { socket.data?.upstream?.end(); },
    error() {},
  },
});

const proxyUrl = "http://127.0.0.1:" + proxyServer.port;

// Exercise the runtime process.env proxy setter (Bun__setEnvValue path).
process.env.HTTP_PROXY = proxyUrl;
process.env.HTTPS_PROXY = proxyUrl;
process.env.http_proxy = proxyUrl;
process.env.NO_PROXY = "";

// TCP server that pushes a byte immediately so the client's onData fires.
const tcpServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(s) { s.write("x"); },
    data() {},
    close() {},
    error() {},
  },
});

let done = 0;
const { promise, resolve, reject } = Promise.withResolvers();

function settle() {
  done++;
  if (done === ITERATIONS) resolve();
}

for (let i = 0; i < ITERATIONS; i++) {
  Bun.connect({
    hostname: "127.0.0.1",
    port: tcpServer.port,
    socket: {
      data(socket) {
        // Re-touch process.env to interleave Bun__setEnvValue with WebSocket construction.
        process.env.NO_PROXY = i % 2 ? "" : "unused.example";
        // Crash site: new WebSocket from inside socket onData, plain ws://, with proxy.
        const ws = new WebSocket("ws://127.0.0.1:" + wsServer.port + "/a/long/ish/path/to/force/allocPrint/growth?q=" + Buffer.alloc(512, "x").toString(), {
          proxy: proxyUrl,
          headers: { "X-Stress": String(i) },
        });
        ws.addEventListener("close", () => { settle(); socket.end(); });
        ws.addEventListener("error", () => { settle(); socket.end(); });
      },
      error() { settle(); },
      close() {},
      connectError() { settle(); },
    },
  }).catch(() => settle());
}

await promise;
tcpServer.stop(true);
proxyServer.stop(true);
wsServer.stop(true);
console.log("DONE", done);
`;
