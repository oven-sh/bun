import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("compat req.socket access after stream finish does not throw", async () => {
  let captured: { bw: unknown; has: boolean; proto: unknown } | undefined;
  const server = http2.createServer((req, res) => {
    res.on("finish", () => {
      captured = {
        bw: req.socket.bytesWritten,
        has: "bytesWritten" in req.socket,
        proto: Object.getPrototypeOf(req.socket),
      };
    });
    res.end("x");
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;
  const client = http2.connect("http://127.0.0.1:" + port);
  const req = client.request({ ":path": "/" });
  req.resume();
  await once(req, "close");
  const { promise, resolve } = Promise.withResolvers<void>();
  client.close(() => resolve());
  await promise;
  server.close();
  await once(server, "close");
  expect(captured).toBeDefined();
  expect(typeof captured!.has).toBe("boolean");
  expect(captured!.proto).toBeDefined();
});
