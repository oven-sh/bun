import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

// A keep-alive agent reuses one TCP socket for later requests, so
// 'response'/'data'/'end' must re-enter the owning request's ALS scope
// rather than inherit whichever request first connected the socket.
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

test("AsyncLocalStorage context is preserved for 'error' on a reused keep-alive socket", async () => {
  const als = new AsyncLocalStorage<string>();
  // net.Server so the second request can be answered with a raw socket destroy.
  const server = net.createServer(sock => {
    let reqs = 0;
    sock.on("data", () => {
      reqs++;
      if (reqs === 1) sock.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok");
      else sock.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const sockets: unknown[] = [];

  try {
    await new Promise<void>((resolve, reject) =>
      als.run("R1", () => {
        const q = http.request({ host: "127.0.0.1", port, agent }, res => {
          res.resume();
          res.on("end", resolve);
          res.on("error", reject);
        });
        q.on("socket", s => sockets.push(s));
        q.on("error", reject);
        q.end();
      }),
    );
    await new Promise<void>(r => setImmediate(() => setImmediate(r)));

    const errorStore = await new Promise<string | undefined>((resolve, reject) =>
      als.run("R2", () => {
        const q = http.request({ host: "127.0.0.1", port, agent });
        q.on("socket", s => sockets.push(s));
        q.on("response", () => reject(new Error("expected a socket error, got a response")));
        q.on("error", () => resolve(als.getStore()));
        q.end();
      }),
    );

    expect({ reused: sockets[0] === sockets[1], errorStore }).toEqual({ reused: true, errorStore: "R2" });
  } finally {
    agent.destroy();
    server.close();
  }
});
