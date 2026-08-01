import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  res.end("ok");
});
await once(server.listen(0), "listening");
const { port } = server.address() as AddressInfo;

const { promise, resolve } = Promise.withResolvers();
http.request(`http://localhost:${port}/`, resolve).end();
const response = await promise;
expect(response.req.agent.defaultPort).toBe(80);
expect(response.req.protocol).toBe("http:");
response.resume();
await once(response, "end");
