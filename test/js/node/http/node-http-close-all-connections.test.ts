// These tests also pass on Node.js. `server.closeAllConnections()` destroys the
// tracked connections and leaves the listen socket alone, so the server keeps
// accepting traffic and a later `close(cb)` still completes normally.
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";

async function listenAndConnect(server: Server) {
  const connected = once(server, "connection");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const client = connect(port, "127.0.0.1");
  client.on("error", () => {});
  await once(client, "connect");
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

  const [serverSocket] = await connected;
  return { port, client, serverSocket };
}

test("closeAllConnections() destroys the connections but keeps the server listening", async () => {
  const server = createServer((req, res) => res.end("ok"));
  let closeEvents = 0;
  server.on("close", () => closeEvents++);
  try {
    const { port, client, serverSocket } = await listenAndConnect(server);
    // Read the response so the connection is idle but still kept alive.
    await once(client, "data");

    const clientClosed = once(client, "close");
    server.closeAllConnections();

    expect(serverSocket.destroyed).toBe(true);
    await clientClosed;

    expect(server.listening).toBe(true);
    expect(closeEvents).toBe(0);

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);

    const { promise, resolve } = Promise.withResolvers<Error | undefined>();
    server.close(resolve);
    expect(await promise).toBeUndefined();
    expect(server.listening).toBe(false);
    expect(closeEvents).toBe(1);
  } finally {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
});

test("closeAllConnections() destroys in-flight connections after close()", async () => {
  const { promise: requestReceived, resolve: onRequest } = Promise.withResolvers<void>();
  // Never respond: the connection stays in-flight, so close() alone cannot finish.
  const server = createServer(() => onRequest());
  try {
    const { client, serverSocket } = await listenAndConnect(server);
    await requestReceived;

    const { promise: serverClosed, resolve: onClosed } = Promise.withResolvers<Error | undefined>();
    const clientClosed = once(client, "close");
    server.close(onClosed);
    server.closeAllConnections();

    expect(serverSocket.destroyed).toBe(true);
    await clientClosed;
    expect(await serverClosed).toBeUndefined();
    expect(server.listening).toBe(false);
  } finally {
    if (server.listening) server.close();
  }
});

test("closeAllConnections() destroys every tracked connection", async () => {
  const server = createServer((req, res) => res.end("ok"));
  const serverSockets: Socket[] = [];
  server.on("connection", socket => serverSockets.push(socket));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const clients: Socket[] = [];
    for (let i = 0; i < 4; i++) {
      const client = connect(port, "127.0.0.1");
      client.on("error", () => {});
      await once(client, "connect");
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await once(client, "data");
      clients.push(client);
    }
    expect(serverSockets).toHaveLength(4);

    const allClosed = Promise.all(clients.map(client => once(client, "close")));
    server.closeAllConnections();
    expect(serverSockets.map(socket => socket.destroyed)).toEqual([true, true, true, true]);

    await allClosed;
    expect(server.listening).toBe(true);
  } finally {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
});

test("closeAllConnections() on a server that never listened does nothing", () => {
  const server = createServer(() => {});
  expect(() => server.closeAllConnections()).not.toThrow();
  expect(server.listening).toBe(false);
});
