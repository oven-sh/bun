import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers<string>();
await using server = http.createServer((req, res) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    resolve(body);
    res.end();
  });
});

await once(server.listen(0), "listening");
const address = server.address() as AddressInfo;
const req = http.request({
  method: "POST",
  host: "127.0.0.1",
  port: address.port,
  headers: { "content-type": "text/plain" },
});

req.flushHeaders();
req.write("bun");
req.end("rocks");

const body = await promise;
expect(body).toBe("bunrocks");
