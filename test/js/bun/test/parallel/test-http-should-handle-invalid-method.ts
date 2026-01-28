import http from "node:http";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import { once } from "node:events";

import { createTest } from "node-harness";
const { expect } = createTest(import.meta.path);

await using server = http.createServer(async (req, res) => {
  expect.unreachable();
});
const { promise, resolve, reject } = Promise.withResolvers();
server.on("connection", socket => {
  socket.on("error", (err: any) => {
    expect(err.code).toBe("HPE_INVALID_METHOD");
    resolve();
  });
});
server.listen(0);
await once(server, "listening");

const socket = createConnection((server.address() as AddressInfo).port, "localhost", () => {
  socket.write(
    `BUN / HTTP/1.1\r\nHost: localhost:${server.address().port}\r\nConnection: close\r\nBig-Header: ` +
      "a".repeat(http.maxHeaderSize) + // will overflow because of host and connection headers
      "\r\n\r\n",
  );
});
socket.on("error", reject);
await promise;
