// server.closeIdleConnections() / server.closeAllConnections() must keep
// working after server.close() has run: that is the canonical graceful-drain
// pattern (close(); wait; closeIdleConnections()) and the force path used by
// http-terminator. These tests also pass on Node.js.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function openConnection(server: Server, port: number) {
  const gotConnection = once(server, "connection");
  const client = connect(port, "127.0.0.1");
  client.on("error", () => {});
  client.on("data", () => {});
  await once(client, "connect");
  return { client, gotConnection };
}

function waitClose(client: Socket) {
  // once() rejects on 'error'; the client may see ECONNRESET on a forced
  // close, which for this test still means "the connection was reaped".
  return new Promise<void>(resolve => client.once("close", () => resolve()));
}

describe.each(["closeIdleConnections", "closeAllConnections"] as const)("%s", method => {
  test("does not touch a socket handed to the 'upgrade' listener", async () => {
    const server = createServer();
    let upgraded!: Socket;
    server.on("upgrade", (req, sock) => {
      upgraded = sock;
      sock.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
    });
    try {
      const port = await listen(server);
      const { client } = await openConnection(server, port);
      const gotResponse = once(client, "data");
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
      await gotResponse;

      // Node.js's ConnectionsList is parser-keyed; freeParser() removes the
      // entry before emitting 'upgrade', so neither call reaches this socket.
      server[method]();
      expect(upgraded.destroyed).toBe(false);

      upgraded.destroy();
      client.destroy();
      await new Promise<void>(r => server.close(() => r()));
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("reaps a connection that went idle after close()", async () => {
    let finishResponse!: () => void;
    const responseGate = new Promise<void>(r => (finishResponse = r));
    const { promise: requestReceived, resolve: onRequest } = Promise.withResolvers<void>();
    const { promise: responded, resolve: onResponded } = Promise.withResolvers<void>();
    const server = createServer(async (req, res) => {
      onRequest();
      await responseGate;
      res.on("finish", () => onResponded());
      res.end("ok");
    });
    server.keepAliveTimeout = 60_000;
    try {
      const port = await listen(server);
      const { client, gotConnection } = await openConnection(server, port);
      const clientClosed = waitClose(client);

      // Request is in flight (handler running) when close() runs, so close()
      // on its own leaves this connection open.
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
      const [serverSocket] = await gotConnection;
      await requestReceived;
      await new Promise(r => setImmediate(r));
      server.close();

      // Let the response finish: the connection is now idle but still open
      // (kept alive).
      finishResponse();
      await responded;
      expect(serverSocket.destroyed).toBe(false);

      // The post-close call must reap it.
      server[method]();
      expect(serverSocket.destroyed).toBe(true);
      await clientClosed;
      client.destroy();
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});

describe("closeIdleConnections", () => {
  test("skips connections with an incomplete request head", async () => {
    const server = createServer((req, res) => res.end("ok"));
    server.keepAliveTimeout = 60_000;
    server.headersTimeout = 0;
    try {
      const port = await listen(server);

      // Fresh accept, zero bytes: Node.js initializes last_message_start_ on
      // parser creation as DoS protection, so this is not idle.
      const { client: fresh, gotConnection: freshConn } = await openConnection(server, port);
      const [freshServerSocket] = await freshConn;

      // Partial request head: last_message_start_ is non-zero, so not idle.
      const { client: partial, gotConnection: partialConn } = await openConnection(server, port);
      const [partialServerSocket] = await partialConn;
      partial.write("GET / HTTP/1.1");

      // Completed cycle, now keep-alive idle: this one is reaped.
      const { client: idle, gotConnection: idleConn } = await openConnection(server, port);
      const idleResponse = once(idle, "data");
      idle.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
      const [idleServerSocket] = await idleConn;
      await idleResponse;

      server.closeIdleConnections();

      expect({
        fresh: freshServerSocket.destroyed,
        partial: partialServerSocket.destroyed,
        idle: idleServerSocket.destroyed,
      }).toEqual({ fresh: false, partial: false, idle: true });

      fresh.destroy();
      partial.destroy();
      idle.destroy();
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("skips in-flight connections and reaps idle ones", async () => {
    const inflightResponses: import("node:http").ServerResponse[] = [];
    const server = createServer((req, res) => {
      if (req.url === "/inflight") {
        inflightResponses.push(res);
        return; // never respond
      }
      res.end("ok");
    });
    server.keepAliveTimeout = 60_000;
    try {
      const port = await listen(server);

      const { client: idle, gotConnection: idleConn } = await openConnection(server, port);
      const idleResponse = once(idle, "data");
      const idleClosed = waitClose(idle);
      idle.write("GET /idle HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
      const [idleServerSocket] = await idleConn;
      await idleResponse;

      const { client: busy, gotConnection: busyConn } = await openConnection(server, port);
      const busyClosed = waitClose(busy);
      busy.write("GET /inflight HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
      const [busyServerSocket] = await busyConn;
      while (inflightResponses.length === 0) await new Promise(r => setImmediate(r));

      server.closeIdleConnections();

      expect(idleServerSocket.destroyed).toBe(true);
      expect(busyServerSocket.destroyed).toBe(false);
      await idleClosed;

      server.closeAllConnections();
      await busyClosed;
      idle.destroy();
      busy.destroy();
      await new Promise<void>(r => server.close(() => r()));
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });
});

describe("closeAllConnections", () => {
  test("after close(), destroys in-flight connections so the close callback runs", async () => {
    const { promise: requestReceived, resolve: onRequest } = Promise.withResolvers<void>();
    // Never respond: the connection stays in-flight, so close() alone cannot
    // finish.
    const server = createServer(() => onRequest());
    try {
      const port = await listen(server);
      const { client, gotConnection } = await openConnection(server, port);
      const clientClosed = waitClose(client);
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      const [serverSocket] = await gotConnection;
      await requestReceived;

      const { promise: closed, resolve: onClosed } = Promise.withResolvers<Error | undefined>();
      server.close(onClosed);
      server.closeAllConnections();

      expect(serverSocket.destroyed).toBe(true);
      await clientClosed;
      expect(await closed).toBeUndefined();
      client.destroy();
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("does not stop the listen socket", async () => {
    const server = createServer((req, res) => res.end("ok"));
    let closeEvents = 0;
    server.on("close", () => closeEvents++);
    try {
      const port = await listen(server);
      const { client } = await openConnection(server, port);
      const firstResponse = once(client, "data");
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
      await firstResponse;

      const clientClosed = waitClose(client);
      server.closeAllConnections();
      await clientClosed;

      // The listener is untouched: still listening, no 'close' event, and a
      // fresh request is served.
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

  test("is a no-op on a server that never listened", () => {
    const server = createServer();
    expect(() => server.closeAllConnections()).not.toThrow();
    expect(() => server.closeIdleConnections()).not.toThrow();
  });
});
