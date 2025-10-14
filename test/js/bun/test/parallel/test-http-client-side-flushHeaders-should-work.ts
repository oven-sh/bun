import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
await using server = http.createServer((req, res) => {
  resolve(req.headers);
  res.end();
});

await once(server.listen(0), "listening");
const address = server.address() as AddressInfo;
const req = http.request({
  method: "GET",
  host: "127.0.0.1",
  port: address.port,
});
req.setHeader("foo", "bar");
req.flushHeaders();
const headers = await promise;
expect(headers).toBeDefined();
expect(headers.foo).toEqual("bar");
