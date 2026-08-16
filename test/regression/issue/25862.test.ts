import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

// Test for https://github.com/oven-sh/bun/issues/25862
// Pipelined data sent immediately after CONNECT request headers should be
// delivered to the `head` parameter of the 'connect' event handler.

test("CONNECT request should receive pipelined data in head parameter", async () => {
  const PIPELINED_DATA = "PIPELINED_DATA";
  const { promise: headReceived, resolve: resolveHead } = Promise.withResolvers<Buffer>();

  await using server = http.createServer();

  server.on("connect", (req, socket, head) => {
    resolveHead(head);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.end();
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port, address } = server.address() as AddressInfo;

  const { promise: clientDone, resolve: resolveClient } = Promise.withResolvers<void>();

  const client = net.connect({ port, host: address }, () => {
    // Send CONNECT request with pipelined data in the same write
    // This simulates what Cap'n Proto's KJ HTTP library does
    client.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n${PIPELINED_DATA}`);
  });

  client.on("data", () => {
    // We got the response, we can close
    client.end();
  });

  client.on("close", () => {
    resolveClient();
  });

  const head = await headReceived;
  await clientDone;

  expect(head).toBeInstanceOf(Buffer);
  expect(head.length).toBe(PIPELINED_DATA.length);
  expect(head.toString()).toBe(PIPELINED_DATA);
});
