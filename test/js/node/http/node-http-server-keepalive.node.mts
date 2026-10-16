/**
 * TCP keep-alive of a node:http server: what the `keepAlive` and `keepAliveInitialDelay` options of createServer()
 * and socket.setKeepAlive() give back to JavaScript.
 *
 * All tests in this file must also pass in Node.js: node-http-server-keepalive.test.ts runs the file under Node.js
 * and under Bun. The tests that read the socket options of the kernel are in that file.
 */
import assert from "node:assert";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
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

export type KeepAliveProperties = { keepAlive: unknown; keepAliveInitialDelay: unknown };
const keepAliveOf = (server: http.Server) => {
  const { keepAlive, keepAliveInitialDelay } = server as unknown as KeepAliveProperties;
  return [keepAlive, keepAliveInitialDelay];
};

describe("server.keepAlive and server.keepAliveInitialDelay", () => {
  // [options, [keepAlive, keepAliveInitialDelay]]. The delay is an option in milliseconds and a property in seconds.
  const rows: [string, http.ServerOptions | undefined, unknown[]][] = [
    ["no options", undefined, [false, 0]],
    ["{}", {}, [false, 0]],
    ["{ keepAlive: true }", { keepAlive: true }, [true, 0]],
    [
      "{ keepAlive: 1, keepAliveInitialDelay: 30000 }",
      { keepAlive: 1 as any, keepAliveInitialDelay: 30000 },
      [true, 30],
    ],
    ["{ keepAlive: true, keepAliveInitialDelay: 1500 }", { keepAlive: true, keepAliveInitialDelay: 1500 }, [true, 1]],
    ["{ keepAlive: true, keepAliveInitialDelay: -5000 }", { keepAlive: true, keepAliveInitialDelay: -5000 }, [true, 0]],
    ["{ keepAlive: true, keepAliveInitialDelay: NaN }", { keepAlive: true, keepAliveInitialDelay: NaN }, [true, 0]],
    [
      "{ keepAlive: true, keepAliveInitialDelay: Infinity }",
      { keepAlive: true, keepAliveInitialDelay: Infinity },
      [true, 0],
    ],
    [
      "{ keepAlive: true, keepAliveInitialDelay: 2 ** 40 }",
      { keepAlive: true, keepAliveInitialDelay: 2 ** 40 },
      [true, 1099511627],
    ],
    ["{ keepAliveInitialDelay: 5000 }", { keepAliveInitialDelay: 5000 }, [false, 5]],
  ];
  for (const [label, options, expected] of rows) {
    test(`every way to make a server: ${label}`, () => {
      assert.deepStrictEqual(
        {
          "http.createServer()": keepAliveOf(http.createServer(options as http.ServerOptions)),
          "new http.Server()": keepAliveOf(new http.Server(options as http.ServerOptions)),
          // @ts-expect-error http.Server() without `new`
          "http.Server()": keepAliveOf(http.Server(options)),
          "https.createServer()": keepAliveOf(https.createServer(options as https.ServerOptions)),
        },
        {
          "http.createServer()": expected,
          "new http.Server()": expected,
          "http.Server()": expected,
          "https.createServer()": expected,
        },
      );
    });
  }

  test("a keepAliveInitialDelay that is not a number throws ERR_INVALID_ARG_TYPE", () => {
    assert.throws(() => http.createServer({ keepAlive: true, keepAliveInitialDelay: "5" as any }), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "options.keepAliveInitialDelay" property must be of type number. Received type string ('5')`,
    });
    assert.throws(() => https.createServer({ keepAliveInitialDelay: null as any }), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "options.keepAliveInitialDelay" property must be of type number. Received null`,
    });
  });

  test("the option does not go through a setKeepAlive() that a program put on net.Socket.prototype", async () => {
    const original = net.Socket.prototype.setKeepAlive;
    let calls = 0;
    net.Socket.prototype.setKeepAlive = function (this: net.Socket, ...args: [boolean?, number?]) {
      calls++;
      return original.apply(this, args);
    };
    try {
      const options = { keepAlive: true, keepAliveInitialDelay: 1000 };
      await withSocket(http.createServer(options), false, "request", () => {});
    } finally {
      net.Socket.prototype.setKeepAlive = original;
    }
    assert.strictEqual(calls, 0);
  });

  test("the two are own enumerable data properties", () => {
    const server = http.createServer({ keepAlive: true, keepAliveInitialDelay: 5000 });
    assert.deepStrictEqual(
      [
        Object.getOwnPropertyDescriptor(server, "keepAlive"),
        Object.getOwnPropertyDescriptor(server, "keepAliveInitialDelay"),
      ],
      [
        { value: true, writable: true, enumerable: true, configurable: true },
        { value: 5, writable: true, enumerable: true, configurable: true },
      ],
    );
  });
});

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
