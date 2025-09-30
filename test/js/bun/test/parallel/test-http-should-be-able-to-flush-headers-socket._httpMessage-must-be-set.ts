import { createTest } from "node-harness";
import { once } from "node:events";
import http, { Server } from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  res.flushHeaders();
});

await once(server.listen(0), "listening");
const { promise, resolve } = Promise.withResolvers();
const address = server.address() as AddressInfo;
const req = http.get(
  {
    hostname: address.address,
    port: address.port,
  },
  resolve,
);

const { socket } = req;
await promise;
expect(socket._httpMessage).toBe(req);
socket.destroy();
