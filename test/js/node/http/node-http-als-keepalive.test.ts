import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The native TCP socket captures the async context once at connect time; a
// keep-alive agent reuses that socket for later requests, so 'response'/'data'
// /'end' must re-enter the owning request's AsyncLocalStorage scope rather
// than inherit the first request's.
test("AsyncLocalStorage context is preserved across keep-alive socket reuse", async () => {
  const als = new AsyncLocalStorage<string>();
  const server = http.createServer((req, res) => res.end("ok"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const sockets: unknown[] = [];
  const seen: Record<string, Record<string, string | undefined>> = {};

  try {
    const one = (store: string) =>
      new Promise<void>((resolve, reject) =>
        als.run(store, () => {
          const req = http.request({ host: "127.0.0.1", port, path: "/", agent }, res => {
            seen[store].response = als.getStore();
            res.on("data", () => (seen[store].data = als.getStore()));
            res.on("end", () => {
              seen[store].end = als.getStore();
              resolve();
            });
            res.on("error", reject);
          });
          seen[store] = {};
          req.on("socket", s => {
            sockets.push(s);
            seen[store].socket = als.getStore();
          });
          req.on("error", reject);
          req.end();
        }),
      );

    await one("R1");
    await new Promise<void>(r => setImmediate(() => setImmediate(r)));
    await one("R2");
    await one("R3");

    // The same pooled socket served all three requests.
    expect(sockets).toEqual([sockets[0], sockets[0], sockets[0]]);
    // Each request's 'socket'/'response'/'data'/'end' saw its own store,
    // not the context the native socket captured at connect time (R1).
    expect(seen).toEqual({
      R1: { socket: "R1", response: "R1", data: "R1", end: "R1" },
      R2: { socket: "R2", response: "R2", data: "R2", end: "R2" },
      R3: { socket: "R3", response: "R3", data: "R3", end: "R3" },
    });
  } finally {
    agent.destroy();
    server.close();
  }
});
