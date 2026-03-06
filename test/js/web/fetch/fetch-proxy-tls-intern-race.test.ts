// Regression test: SSLConfig intern/deref race causing use-after-free in proxy tunnel
// See: https://github.com/oven-sh/bun/pull/27838
//
// Uses multiple workers firing concurrent fetch batches to create cross-thread
// contention on the shared SSLConfig.GlobalRegistry. Each worker's JS thread
// calls intern() while HTTP threads call deref(). Concurrent batches maximize
// the overlap between deref() and the next intern() call.
//
// On ASAN builds with unfixed code, this triggers heap-use-after-free when
// intern() does ref() 0->1 on a dying config.

import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import { Worker } from "node:worker_threads";

async function createConnectProxy() {
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);
      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort!.lastIndexOf(":");
      const host = hostPort!.slice(0, colon);
      const port = Number(hostPort!.slice(colon + 1));
      const upstream = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const extra = head.subarray(headerEnd + 4);
        if (extra.length > 0) upstream.write(extra);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

test("SSLConfig intern/deref race does not cause use-after-free", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const proxy = await createConnectProxy();

  const NUM_WORKERS = 8;
  const WAVES = 20;
  const BATCH = 16;

  // Each worker fires WAVES waves of BATCH concurrent fetches.
  // Concurrent batches cause multiple intern() and deref() calls to overlap
  // across threads, maximizing the chance of hitting the race window.
  const workerCode = `
    const { workerData, parentPort } = require("worker_threads");
    async function run() {
      let ok = 0;
      for (let wave = 0; wave < workerData.waves; wave++) {
        const batch = [];
        for (let i = 0; i < workerData.batch; i++) {
          batch.push(
            fetch("https://127.0.0.1:" + workerData.bp + "/", {
              proxy: "http://127.0.0.1:" + workerData.pp,
              keepalive: false,
              tls: { rejectUnauthorized: false },
            }).then(r => r.text()).then(t => { if (t === "ok") ok++; }).catch(() => {})
          );
        }
        await Promise.all(batch);
      }
      parentPort.postMessage(ok);
    }
    run();
  `;

  const promises: Promise<number>[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new Worker(workerCode, {
      eval: true,
      workerData: { bp: backend.port, pp: proxy.port, waves: WAVES, batch: BATCH },
    });
    promises.push(
      new Promise<number>(resolve => {
        w.on("message", (data: number) => resolve(data));
        w.on("error", () => resolve(0));
        w.on("exit", () => resolve(0));
      }),
    );
  }

  const results = await Promise.all(promises);
  const total = results.reduce((a, b) => a + b, 0);

  expect(total).toBe(NUM_WORKERS * WAVES * BATCH);

  proxy.server.close();
}, 120_000);
