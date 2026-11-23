// https://github.com/oven-sh/bun/issues/49375
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

test("closeAllConnections() and close() close a connection that has sent nothing", async () => {
  const server = createServer((req, res) => res.end("ok"));
  const accepted: Socket[] = [];
  server.on("connection", socket => accepted.push(socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const clients: Socket[] = [];
  function open() {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    clients.push(socket);
    return socket;
  }
  try {
    const silent = open();
    const silentClosed = new Promise(resolve => silent.on("close", resolve));
    await once(silent, "connect");
    // Opened after the silent client has connected, so the server accepts it second.
    // When the server has answered this client, it has accepted the silent one.
    const talker = open();
    let response = "";
    talker.on("data", chunk => (response += chunk));
    talker.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    await once(talker, "close");
    expect(response).toEndWith("ok");
    expect(accepted.length).toBe(2);
    const { promise: count, resolve } = Promise.withResolvers<number>();
    server.getConnections((err, n) => resolve(n));
    expect(await count).toBe(1);

    const closed = Promise.withResolvers<Error | undefined>();
    server.closeAllConnections();
    server.close(closed.resolve);
    expect(await closed.promise).toBeUndefined();
    // The silent client never writes. Only the server can end this connection.
    await silentClosed;
  } finally {
    for (const socket of clients) socket.destroy();
    server.close();
    server.closeAllConnections();
  }
});
