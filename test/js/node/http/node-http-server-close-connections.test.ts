// server.closeIdleConnections() / server.closeAllConnections() must keep
// working after server.close() has run: that is the canonical graceful-drain
// pattern (close(); wait; closeIdleConnections()) and the force path used by
// http-terminator. These tests also pass on Node.js v26, except the subprocess
// test at the end and the one pipelining test that says otherwise.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
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

      // Node.js's ConnectionsList is parser-keyed; a body-less upgrade request
      // is complete when it is handed off, so freeParser() has removed the
      // entry by the time 'upgrade' is emitted and neither call reaches it.
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

  test("treats an upgrade request whose body is still arriving like Node.js", async () => {
    const server = createServer();
    const { promise: upgradeEmitted, resolve: onUpgrade } = Promise.withResolvers<void>();
    server.on("upgrade", () => onUpgrade());
    try {
      const port = await listen(server);
      const { client, gotConnection } = await openConnection(server, port);
      // 3 of the 10 body bytes: Node.js (v26, which delivers upgrade bodies)
      // only frees the parser once the request is complete, so until then the
      // connection is still listed. closeAllConnections() destroys it;
      // closeIdleConnections() skips it because a message is being received.
      client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 10\r\n\r\nabc");
      const [serverSocket] = await gotConnection;
      await upgradeEmitted;

      server[method]();
      expect(serverSocket.destroyed).toBe(method === "closeAllConnections");

      serverSocket.destroy();
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

  test("skips a connection whose request body is still arriving, reaps it once received", async () => {
    // Responds before the body has arrived; the connection stays keep-alive and
    // the rest of the body is read and discarded.
    const server = createServer((req, res) => res.end("ok"));
    server.keepAliveTimeout = 60_000;
    try {
      const port = await listen(server);
      const { client, gotConnection } = await openConnection(server, port);
      const response = once(client, "data");
      client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 6\r\n\r\nabc");
      const [serverSocket] = await gotConnection;
      await response;

      // The response is finished, but the request message is not: still busy.
      server.closeIdleConnections();
      expect(serverSocket.destroyed).toBe(false);

      // Nothing in JS observes the discarded bytes arriving, so the sweep itself
      // is the observable: it keeps skipping the connection until they have.
      client.write("def");
      while (!serverSocket.destroyed) {
        await new Promise(r => setImmediate(r));
        server.closeIdleConnections();
      }
      await waitClose(client);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("keeps a connection with pipelined responses still queued (unlike Node.js)", async () => {
    const responses: ServerResponse[] = [];
    const { promise: bothDispatched, resolve: onBothDispatched } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      responses.push(res);
      if (responses.length === 2) onBothDispatched();
    });
    server.keepAliveTimeout = 60_000;
    try {
      const port = await listen(server);
      const { client, gotConnection } = await openConnection(server, port);
      let received = "";
      const { promise: gotBothBodies, resolve: onBothBodies } = Promise.withResolvers<void>();
      client.on("data", chunk => {
        received += chunk;
        if (received.includes("body-a") && received.includes("body-b")) onBothBodies();
      });
      client.write("GET /a HTTP/1.1\r\nHost: x\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n\r\n");
      const [serverSocket] = await gotConnection;
      await bothDispatched;
      const [resA, resB] = responses;

      // Synchronously after the first response finishes, the second one is
      // still queued behind it. Node.js v26 destroys the connection at this
      // point and never delivers the second response; Bun treats the queue as
      // in flight, like its native idle sweep does.
      resA.end("body-a");
      server.closeIdleConnections();
      expect(serverSocket.destroyed).toBe(false);

      resB.end("body-b");
      await gotBothBodies;

      server.closeIdleConnections();
      expect(serverSocket.destroyed).toBe(true);
      await waitClose(client);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("skips in-flight connections and reaps idle ones", async () => {
    const inflightResponses: ServerResponse[] = [];
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

  test("is a no-op when no connections are established", async () => {
    const server = createServer((req, res) => res.end("ok"));
    try {
      const port = await listen(server);

      // No client has connected yet: must not throw and must not affect the listener.
      expect(() => server.closeAllConnections()).not.toThrow();
      expect(server.listening).toBe(true);

      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    } finally {
      server.closeAllConnections();
      if (server.listening) server.close();
    }
  });

  test("destroys every tracked connection", async () => {
    const server = createServer((req, res) => res.end("ok"));
    const serverSockets: Socket[] = [];
    server.on("connection", socket => serverSockets.push(socket));
    try {
      const port = await listen(server);

      const clients: Socket[] = [];
      for (let i = 0; i < 4; i++) {
        const { client } = await openConnection(server, port);
        const response = once(client, "data");
        client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
        await response;
        clients.push(client);
      }
      expect(serverSockets).toHaveLength(4);

      const allClosed = Promise.all(clients.map(waitClose));
      server.closeAllConnections();

      // Like Node, the socket objects themselves are destroyed synchronously, so
      // the usual 'connection' + socket.on('close') bookkeeping sees them leave.
      expect(serverSockets.map(socket => socket.destroyed)).toEqual([true, true, true, true]);
      await allClosed;
      expect(server.listening).toBe(true);

      const { promise, resolve } = Promise.withResolvers<Error | undefined>();
      server.close(resolve);
      expect(await promise).toBeUndefined();
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

// https://github.com/oven-sh/bun/issues/30501: @azure/msal-node tears its
// loopback redirect server down with exactly this sequence. The browser's
// connection is still in flight at that point, so only closeAllConnections()
// can reclaim it; when it was a no-op after close(), the process hung.
test("close(); closeAllConnections(); unref() with an in-flight request lets the process exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const net = require("node:net");
        const server = http.createServer(() => {
          // Never respond; tear down while the request is in flight.
          server.close();
          server.closeAllConnections();
          server.unref();
          console.log("teardown done");
          setTimeout(() => {
            console.log("still alive after teardown");
            process.exit(7);
          }, 3000).unref();
        });
        server.listen(0, "127.0.0.1", () => {
          const client = net.connect(server.address().port, "127.0.0.1", () => {
            client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: keep-alive\\r\\n\\r\\n");
          });
          client.on("error", () => {});
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("teardown done\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // Debug builds spend a few seconds just loading node:http in the child, and
  // the child's own 3s watchdog needs to get its message out when this breaks.
}, 15_000);
