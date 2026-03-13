import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
await using server = http.createServer((req, res) => {
  resolve([req, res]);
});
await once(server.listen(0), "listening");
const address = server.address() as AddressInfo;
http.get({
  host: "127.0.0.1",
  port: address.port,
  headers: [
    ["foo", "bar"],
    ["foo", "baz"],
    ["host", "127.0.0.1"],
    ["host", "127.0.0.2"],
    ["host", "127.0.0.3"],
  ],
});

const [req, res] = await promise;
expect(req.headers.foo).toBe("bar, baz");
expect(req.headers.host).toBe("127.0.0.1");

res.end();
