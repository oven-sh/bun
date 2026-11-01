import { createTest } from "node-harness";
import { once } from "node:events";
import http, { createServer } from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

await using server = createServer((req, res) => {
  expect(req.url).toBe("/hello");
  res.writeHead(200);
  res.end("world");
});
server.listen(0);
await once(server, "listening");
const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
const { resolve, reject, promise } = Promise.withResolvers();
http.get(new URL("/hello", url), res => {
  try {
    expect((res as any).req.agent.protocol).toBe("http:");
    resolve();
  } catch (e) {
    reject(e);
  }
});
await promise;
