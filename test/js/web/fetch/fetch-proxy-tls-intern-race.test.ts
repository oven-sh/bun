import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import net from "node:net";

async function createConnectProxy() {
  const server = net.createServer((client) => {
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

  const NUM_WORKERS = 4;
  const ROUNDS = 50;

  const workerCode = `
    const { workerData, parentPort } = require("worker_threads");
    async function run() {
      let ok = 0;
      for (let i = 0; i < workerData.n; i++) {
        try {
          const r = await fetch("https://127.0.0.1:" + workerData.bp + "/", {
            proxy: "http://127.0.0.1:" + workerData.pp,
            keepalive: false,
            tls: { rejectUnauthorized: false },
          });
          if ((await r.text()) === "ok") ok++;
        } catch(e) { /* count as failure */ }
      }
      parentPort.postMessage(ok);
    }
    run();
  `;

  const promises: Promise<number>[] = [];
  const workers: Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new Worker(workerCode, {
      eval: true,
      workerData: { bp: backend.port, pp: proxy.port, n: ROUNDS },
    });
    workers.push(w);
    promises.push(
      new Promise<number>((resolve) => {
        w.on("message", (data: number) => resolve(data));
        w.on("error", () => resolve(0));
        w.on("exit", () => resolve(0));
      })
    );
  }

  const results = await Promise.all(promises);
  const total = results.reduce((a, b) => a + b, 0);

  expect(total).toBe(NUM_WORKERS * ROUNDS);

  proxy.server.close();
}, 60_000);
