import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";

test("session.destroy(error) propagates the error to in-flight streams", async () => {
  const server = http2.createServer();
  server.on("stream", () => {});
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const client = http2.connect(`http://127.0.0.1:${port}`);
  try {
    await once(client, "connect");
    const req = client.request({ ":path": "/" });
    req.on("response", () => {});
    req.end();

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    req.on("error", resolve);
    req.on("close", () => reject(new Error("stream closed without error")));

    const myErr = Object.assign(new Error("boom"), { code: "ERR_HTTP2_SESSION_ERROR" });
    client.on("error", () => {});
    client.destroy(myErr);

    const err = await promise;
    expect(err).toBe(myErr);
  } finally {
    client.destroy();
    server.close();
    await once(server, "close");
  }
});
