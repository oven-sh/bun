import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
await using server = http.createServer(async (req, res) => {
  expect(req.headers["empty-header"]).toBe("");
  res.writeHead(200, { "x-test": "test", "empty-header": "" });
  res.end();
});

server.listen(0);
await once(server, "listening");

const socket = createConnection((server.address() as AddressInfo).port, "localhost", () => {
  socket.write(
    `GET / HTTP/1.1\r\nHost: localhost:${server.address().port}\r\nConnection: close\r\nEmpty-Header:\r\n\r\n`,
  );
});

socket.on("data", data => {
  const headers = data.toString("utf-8").split("\r\n");
  expect(headers[0]).toBe("HTTP/1.1 200 OK");
  expect(headers[1]).toBe("x-test: test");
  expect(headers[2]).toBe("empty-header: ");
  socket.end();
  resolve();
});

socket.on("error", reject);

await promise;
