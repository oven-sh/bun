import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  res.end();
});
let socket;
server.on("clientError", err => {
  expect(err.code).toBe("HPE_INVALID_METHOD");
  expect(err.rawPacket.toString()).toBe("*");

  socket.end();
});
await once(server.listen(0), "listening");
const address = server.address() as AddressInfo;
socket = createConnection({ port: address.port });

await once(socket, "connect");
socket.write("*");
await once(socket, "close");
