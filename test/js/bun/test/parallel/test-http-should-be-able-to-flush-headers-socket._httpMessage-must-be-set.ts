import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
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

await promise;
// Once the response (the flushed headers) has arrived, the request is still
// attached to its socket.
const { socket } = req;
expect(socket._httpMessage).toBe(req);
socket.destroy();
