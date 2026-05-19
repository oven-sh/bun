import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("req.socket.bytesRead is non-zero after request body received (#28709)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = http.createServer((req, res) => {
    req.on("end", () => {
      try {
        resolve(req.socket.bytesRead);
      } catch (e) {
        reject(e);
      }
      res.end("ok");
    });
    req.on("error", reject);
    req.resume();
  });
  try {
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const clientReq = http.request({ method: "PUT", port });
    clientReq.on("error", reject);
    clientReq.write("hello");
    clientReq.end();
    const bytesRead = await promise;
    expect(bytesRead).toBeGreaterThan(0);
  } finally {
    server.close();
  }
});
