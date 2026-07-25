import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("http.Server: listen() on an already-listening server throws ERR_SERVER_ALREADY_LISTEN", async () => {
  const server = createServer((req, res) => res.end("ok"));
  try {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const firstPort = (server.address() as AddressInfo).port;

    let err: any;
    try {
      server.listen(0, "127.0.0.1");
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_SERVER_ALREADY_LISTEN");
    expect((server.address() as AddressInfo).port).toBe(firstPort);

    // close() then listen() again must still work
    await new Promise<void>(r => server.close(() => r()));
    await once(server.listen(0, "127.0.0.1"), "listening");
    expect(server.address()).not.toBeNull();
  } finally {
    server.close();
  }
});
