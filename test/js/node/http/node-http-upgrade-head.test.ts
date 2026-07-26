// Tests here also run in Node.js.
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

test("'upgrade' head is the bytes past a Content-Length body (same read)", async () => {
  // Node v26 contract: the parser stops at the end of the HTTP message, so the
  // head buffer is everything after the Content-Length body that arrived in
  // the same TCP read. The body itself reaches the request stream, and later
  // writes reach the raw socket.
  let sawHead: string | undefined;
  let reqBody = "";
  let sockBytes = "";
  const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<Socket>();
  const { promise: reqEnded, resolve: onReqEnd } = Promise.withResolvers<void>();
  const { promise: sockEnded, resolve: onSockEnd } = Promise.withResolvers<void>();

  const server = createServer((req, res) => res.end("x"));
  server.on("upgrade", (req, socket, head) => {
    sawHead = head.toString("latin1");
    req.on("data", d => (reqBody += d));
    req.on("end", onReqEnd);
    socket.on("data", d => (sockBytes += d));
    socket.on("end", onSockEnd);
    socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    onUpgrade(socket);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    await once(client, "connect");
    // headers + 5-byte body + 5 extra bytes, one write.
    client.write(
      "GET / HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: p\r\nContent-Length: 5\r\n\r\nHELLOAFTER",
    );
    const serverSocket = await upgraded;
    await reqEnded;
    // Extra tunnel data after the initial read: must not be skipped.
    client.write("MORE");
    client.end();
    await sockEnded;

    expect({ head: sawHead, reqBody, sockBytes }).toEqual({
      head: "AFTER",
      reqBody: "HELLO",
      sockBytes: "MORE",
    });

    serverSocket.end();
    client.destroy();
  } finally {
    server.close();
  }
});

test("'upgrade' head is empty when the Content-Length body has not fully arrived", async () => {
  // When only the headers arrive first (body + tunnel bytes in a later read),
  // Node emits 'upgrade' with an empty head and the post-body bytes reach the
  // raw socket as data.
  let sawHead: string | undefined;
  let reqBody = "";
  let sockBytes = "";
  const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<Socket>();
  const { promise: sockEnded, resolve: onSockEnd } = Promise.withResolvers<void>();

  const server = createServer((req, res) => res.end("x"));
  server.on("upgrade", (req, socket, head) => {
    sawHead = head.toString("latin1");
    req.on("data", d => (reqBody += d));
    socket.on("data", d => (sockBytes += d));
    socket.on("end", onSockEnd);
    socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    onUpgrade(socket);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    await once(client, "connect");
    client.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: p\r\nContent-Length: 5\r\n\r\n");
    const serverSocket = await upgraded;
    expect(sawHead).toBe("");
    client.write("HELLOAFTER");
    client.end();
    await sockEnded;

    expect({ reqBody, sockBytes }).toEqual({ reqBody: "HELLO", sockBytes: "AFTER" });

    serverSocket.end();
    client.destroy();
  } finally {
    server.close();
  }
});
