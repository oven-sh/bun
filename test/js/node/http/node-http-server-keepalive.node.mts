/**
 * TCP keep-alive of a node:http server: what socket.setKeepAlive() gives back to JavaScript.
 *
 * All tests in this file must also pass in Node.js: node-http-server-keepalive.test.ts runs the file under Node.js
 * and under Bun. The tests that read the socket options of the kernel are in that file.
 */
import assert from "node:assert";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { describe, test } from "node:test";
import tls from "node:tls";

export type SocketEvent = "request" | "connection" | "connect" | "upgrade";
export const requests: Record<SocketEvent, string> = {
  request: "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n",
  connection: "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n",
  connect: "CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n",
  upgrade: "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: tunnel\r\n\r\n",
};

export async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

// A client that sent `request`. It is connected and, for TLS, the handshake is done.
export async function connect(port: number, secure: boolean, request: string) {
  const client = secure
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  await once(client, secure ? "secureConnect" : "connect");
  client.write(request);
  return client;
}

// Runs `fn` with the socket that `server` gives to the listener of `event`, and gives the result of `fn`.
export async function withSocket<T>(
  server: http.Server,
  secure: boolean,
  event: SocketEvent,
  fn: (socket: net.Socket) => T | Promise<T>,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const run = (socket: net.Socket) => void Promise.try(fn, socket).then(resolve, reject);
  if (event === "request") {
    server.on("request", (req, res) => {
      run(req.socket);
      res.end();
    });
  } else if (event === "connection") {
    server.on("connection", run);
    server.on("request", (_req, res) => res.end());
  } else {
    server.on(event, (_req, socket) => run(socket as net.Socket));
  }
  const client = await connect(await listen(server), secure, requests[event]);
  client.on("error", reject);
  try {
    return await promise;
  } finally {
    client.destroy();
    server.closeAllConnections();
    server.close();
  }
}

describe("socket.setKeepAlive() of a server socket", () => {
  test("returns a Proxy of the socket that it is called on", async () => {
    const returned = await withSocket(http.createServer(), false, "request", socket => {
      const proxy = new Proxy(socket, {});
      return proxy.setKeepAlive(true, 5000) === proxy;
    });
    assert.strictEqual(returned, true);
  });

  for (const event of ["request", "connection", "connect", "upgrade"] as const) {
    test(`returns the socket of '${event}' for any arguments, also after destroy()`, async () => {
      const returned = await withSocket(http.createServer(), false, event, socket => {
        const calls: unknown[][] = [[true, 5000], [true], [], [false], ["yes", "5000"], [true, NaN], [true, -5000]];
        const open = calls.map(args => socket.setKeepAlive(...(args as [boolean, number])) === socket);
        socket.destroy();
        return [...open, socket.setKeepAlive(true, 5000) === socket];
      });
      assert.deepStrictEqual(returned, [true, true, true, true, true, true, true, true]);
    });
  }
});
