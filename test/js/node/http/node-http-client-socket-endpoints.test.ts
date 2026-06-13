// https://github.com/oven-sh/bun/issues/32169
// The node:http client's req.socket must report the connection's real
// local/peer endpoints like Node.js does, not placeholder values.
// This test also passes when run under Node.js.
import { expect, it } from "bun:test";
import { once } from "node:events";
import http, { createServer } from "node:http";
import type { AddressInfo } from "node:net";

it("client req.socket reports the connection's real endpoints", async () => {
  const peerSeenByServer = Promise.withResolvers<{ remoteAddress: string; remotePort: number }>();
  const server = createServer((req, res) => {
    peerSeenByServer.resolve({
      remoteAddress: req.socket.remoteAddress!,
      remotePort: req.socket.remotePort!,
    });
    res.end("hello");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    let req!: import("node:http").ClientRequest;
    const res = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      req = http.get({ host: "127.0.0.1", port }, resolve);
      req.on("error", reject);
    });
    const peer = await peerSeenByServer.promise;

    // What the client reports about itself must match what the server
    // observed about it, and vice versa.
    expect({
      localAddress: req.socket.localAddress,
      localPort: req.socket.localPort,
      localFamily: req.socket.localFamily,
      remoteAddress: req.socket.remoteAddress,
      remotePort: req.socket.remotePort,
      remoteFamily: req.socket.remoteFamily,
    }).toEqual({
      localAddress: peer.remoteAddress,
      localPort: peer.remotePort,
      localFamily: "IPv4",
      remoteAddress: "127.0.0.1",
      remotePort: port,
      remoteFamily: "IPv4",
    });

    // res.socket reports the same connection.
    expect({
      localAddress: res.socket.localAddress,
      localPort: res.socket.localPort,
      localFamily: res.socket.localFamily,
      remoteAddress: res.socket.remoteAddress,
      remotePort: res.socket.remotePort,
      remoteFamily: res.socket.remoteFamily,
    }).toEqual({
      localAddress: peer.remoteAddress,
      localPort: peer.remotePort,
      localFamily: "IPv4",
      remoteAddress: "127.0.0.1",
      remotePort: port,
      remoteFamily: "IPv4",
    });

    res.resume();
    await once(res, "end");
  } finally {
    server.close();
  }
});
