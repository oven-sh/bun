// Tests here also run in Node.js.
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

async function runUpgrade(
  send: (client: Socket, afterUpgrade: Promise<void>, afterReqEnd: Promise<void>) => Promise<void>,
) {
  let head: string | undefined;
  let reqBody = "";
  let sockBytes = "";
  const { promise: upgraded, resolve: onUpgrade } = Promise.withResolvers<Socket>();
  const { promise: reqEnded, resolve: onReqEnd } = Promise.withResolvers<void>();
  const { promise: sockEnded, resolve: onSockEnd } = Promise.withResolvers<void>();

  const server = createServer((req, res) => res.end("x"));
  server.on("upgrade", (req, socket, h) => {
    head = h.toString("latin1");
    req.on("data", d => (reqBody += d));
    req.on("end", onReqEnd);
    socket.on("data", d => (sockBytes += d));
    socket.on("end", onSockEnd);
    socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    onUpgrade(socket);
  });
  let client: Socket | undefined;
  let serverSocket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    client = connect(port, "127.0.0.1");
    await once(client, "connect");
    await send(
      client,
      upgraded.then(s => void (serverSocket = s)),
      reqEnded,
    );
    client.end();
    await sockEnded;
    return { head, reqBody, sockBytes };
  } finally {
    client?.destroy();
    serverSocket?.destroy();
    server.close();
    server.closeAllConnections?.();
  }
}

test("'upgrade' head is the bytes past a Content-Length body (same read)", async () => {
  // Node v26 contract: the parser stops at the end of the HTTP message, so the
  // head buffer is everything after the Content-Length body that arrived in
  // the same TCP read. The body itself reaches the request stream, and later
  // writes reach the raw socket.
  const result = await runUpgrade(async (client, afterUpgrade, afterReqEnd) => {
    // headers + 5-byte body + 5 extra bytes, one write.
    client.write(
      "GET / HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: p\r\nContent-Length: 5\r\n\r\nHELLOAFTER",
    );
    await afterUpgrade;
    await afterReqEnd;
    // Extra tunnel data after the initial read: must not be skipped.
    client.write("MORE");
  });
  expect(result).toEqual({ head: "AFTER", reqBody: "HELLO", sockBytes: "MORE" });
});

test("'upgrade' head is empty when the body exactly fills the initial read", async () => {
  // connectHead.length === contentLength: nothing past the body in this read,
  // so head is empty and later tunnel bytes are not skipped.
  const result = await runUpgrade(async (client, afterUpgrade, afterReqEnd) => {
    client.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: p\r\nContent-Length: 5\r\n\r\nHELLO");
    await afterUpgrade;
    await afterReqEnd;
    client.write("LATER");
  });
  expect(result).toEqual({ head: "", reqBody: "HELLO", sockBytes: "LATER" });
});

test("'upgrade' head is empty when the Content-Length body has not fully arrived", async () => {
  // When only the headers arrive first (body + tunnel bytes in a later read),
  // Node emits 'upgrade' with an empty head and the post-body bytes reach the
  // raw socket as data.
  const result = await runUpgrade(async (client, afterUpgrade) => {
    client.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: p\r\nContent-Length: 5\r\n\r\n");
    await afterUpgrade;
    client.write("HELLOAFTER");
  });
  expect(result).toEqual({ head: "", reqBody: "HELLO", sockBytes: "AFTER" });
});
