/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */

import { describe, test } from "node:test";
import assert from "node:assert";

function expect(value: any) {
  return {
    toBe: (expected: any) => {
      assert.strictEqual(value, expected);
    },
    toContain: (expected: any) => {
      assert.ok(value.includes(expected));
    },
    toBeInstanceOf: (expected: any) => {
      assert.ok(value instanceof expected);
    },
    toBeGreaterThan: (expected: any) => {
      assert.ok(value > expected);
    },
    toBeLessThan: (expected: any) => {
      assert.ok(value < expected);
    },
    toEqual: (expected: any) => {
      assert.deepStrictEqual(value, expected);
    },
    not: {
      toBe: (expected: any) => {
        assert.notStrictEqual(value, expected);
      },
      toContain: (expected: any) => {
        assert.ok(!value.includes(expected));
      },
      toBeInstanceOf: (expected: any) => {
        assert.ok(!(value instanceof expected));
      },
      toBeGreaterThan: (expected: any) => {
        assert.ok(!(value > expected));
      },
      toBeLessThan: (expected: any) => {
        assert.ok(!(value < expected));
      },
      toEqual: (expected: any) => {
        assert.notDeepStrictEqual(value, expected);
      },
    },
  };
}
import http from "http";
import { createProxy } from "proxy";

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { pipeline, Writable } from "node:stream";

function connectClient(proxyAddress: AddressInfo, targetAddress: AddressInfo, add_http_prefix: boolean) {
  const client = net.connect({ port: proxyAddress.port, host: proxyAddress.address }, () => {
    client.write(
      `CONNECT ${add_http_prefix ? "http://" : ""}${targetAddress.address}:${targetAddress.port} HTTP/1.1\r\nHost: ${targetAddress.address}:${targetAddress.port}\r\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==\r\n\r\n`,
    );
  });

  const received: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  client.on("data", data => {
    if (data.toString().includes("200 Connection established")) {
      client.write("GET / HTTP/1.1\r\nHost: www.example.com:80\r\nConnection: close\r\n\r\n");
    }
    received.push(data.toString());
  });
  client.on("error", reject);

  client.on("end", () => {
    resolve(received.join(""));
  });
  return promise;
}

const BIG_DATA = Buffer.alloc(1024 * 64, "bun").toString();

describe("HTTP server CONNECT", () => {
  test("should work with proxy package", async () => {
    await using targetServer = http.createServer((req, res) => {
      res.end("Hello World from target server");
    });
    await using proxyServer = createProxy(http.createServer());
    let proxyHeaders = {};
    proxyServer.authenticate = req => {
      proxyHeaders = req.headers;
      return true;
    };
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    {
      // server should support http prefix but the proxy package it self does not
      // this behavior is consistent with node.js
      const response = await connectClient(proxyAddress, targetAddress, true);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 404 Not Found");
    }

    {
      proxyHeaders = {};
      const response = await connectClient(proxyAddress, targetAddress, false);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain("Hello World from target server");
    }
  });

  test("should work with raw sockets", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = http.createServer((req, res) => {
      res.end("Hello World from target server");
    });
    let proxyHeaders = {};
    proxyServer.on("connect", (req, socket, head) => {
      proxyHeaders = req.headers;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });
      serverSocket.on("error", err => {
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
      socket.on("error", err => {
        serverSocket.destroy();
      });

      socket.on("end", () => serverSocket.end());
      serverSocket.on("end", () => socket.end());
    });
    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    await once(targetServer.listen(0, "127.0.0.1"), "listening");
    const targetAddress = targetServer.address() as AddressInfo;

    {
      const response = await connectClient(proxyAddress, targetAddress, false);
      expect(proxyHeaders["proxy-authorization"]).toBe("Basic dXNlcjpwYXNzd29yZA==");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain("Hello World from target server");
    }
  });

  test("should handle multiple concurrent CONNECT requests", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    await using targetServer = http.createServer((req, res) => {
      res.end(`Response for ${req.url}`);
    });

    let connectionCount = 0;
    proxyServer.on("connect", (req, socket, head) => {
      connectionCount++;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");

    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    // Create 5 concurrent connections
    const promises = Array.from({ length: 5 }, (_, i) => connectClient(proxyAddress, targetAddress, false));

    const results = await Promise.all(promises);
    expect(connectionCount).toBe(5);
    results.forEach(result => {
      expect(result).toContain("HTTP/1.1 200 OK");
    });
  });

  test("should handle CONNECT with invalid target", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port) || 80, host, () => {
        socket.write(`HTTP/1.1 200 Connection established\r\n\r\n`);
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", err => {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.end();
      });

      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write("CONNECT invalid.host.that.does.not.exist:9999 HTTP/1.1\r\nHost: invalid.host:9999\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<string>();
    const received: string[] = [];

    client.on("data", data => {
      received.push(data.toString());
    });

    client.on("end", () => {
      resolve(received.join(""));
    });

    const response = await promise;
    expect(response).toContain("502 Bad Gateway");
  });

  test("should handle CONNECT with authentication failure", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const auth = req.headers["proxy-authorization"];
      if (!auth || auth !== "Basic dXNlcjpwYXNzd29yZA==") {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n");
        socket.write('Proxy-Authenticate: Basic realm="Proxy"\r\n\r\n');
        socket.end();
        return;
      }

      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    // Test without authentication
    const client1 = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client1.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
    });

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers<string>();
    const received1: string[] = [];

    client1.on("data", data => {
      received1.push(data.toString());
    });

    client1.on("end", () => {
      resolve1(received1.join(""));
    });

    const response1 = await promise1;
    expect(response1).toContain("407 Proxy Authentication Required");

    // Test with correct authentication
    const client2 = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client2.write(
        "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==\r\n\r\n",
      );
    });

    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<string>();
    const received2: string[] = [];

    client2.on("data", data => {
      received2.push(data.toString());
    });

    client2.on("end", () => {
      resolve2(received2.join(""));
    });

    const response2 = await promise2;
    expect(response2).toContain("200 Connection established");
  });

  test("should handle partial writes and buffering", async () => {
    // Write each chunk, wait for its write callback, then yield one I/O poll so
    // the peer sees a fragmented stream without any fixed-delay timers.
    async function writeChunked(sock: net.Socket, chunks: string[]) {
      for (const chunk of chunks) {
        await new Promise<void>((res, rej) => sock.write(chunk, e => (e ? rej(e) : res())));
        await new Promise<void>(res => setImmediate(res));
      }
    }

    await using proxyServer = http.createServer();
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let bufferReceived = "";

    proxyServer.on("connect", (req, socket, head) => {
      let sentTestData = false;
      socket.on("error", reject);
      socket.on("data", chunk => {
        bufferReceived += chunk.toString();
        // End only once the client's tunneled bytes have arrived so the
        // assertion on bufferReceived is not racing the server's FIN.
        if (!sentTestData && bufferReceived.includes("Client data")) {
          sentTestData = true;
          socket.write("Test data", () => socket.end());
        }
      });

      writeChunked(socket as net.Socket, ["HTTP/1.1 ", "200 ", "Connection ", "established\r\n\r\n"]).catch(reject);
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      writeChunked(client, ["CONNECT example.com:80 ", "HTTP/1.1\r\n", "Host: example.com\r\n\r\n"]).catch(reject);
    });

    const received: string[] = [];
    let sentClientData = false;

    client.on("error", reject);
    client.on("data", data => {
      received.push(data.toString());
      // Send the client bytes once the tunnel is up.
      if (!sentClientData && received.join("").includes("Connection established\r\n\r\n")) {
        sentClientData = true;
        client.write("Client data");
      }
    });

    client.on("end", () => {
      resolve(received.join(""));
    });

    const response = await promise;
    expect(response).toContain("200 Connection established");
    expect(response).toContain("Test data");
    expect(bufferReceived).toContain("Client data");
  });

  test("should handle keep-alive connections", async () => {
    await using proxyServer = http.createServer();
    await using targetServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": "5" });
      res.end("Hello");
    });

    proxyServer.on("connect", (req, socket, head) => {
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, () => {
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        serverSocket.pipe(socket);
        socket.pipe(serverSocket);
      });

      serverSocket.on("error", () => socket.end());
      socket.on("error", () => serverSocket.destroy());
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    await once(targetServer.listen(0, "127.0.0.1"), "listening");

    const proxyAddress = proxyServer.address() as AddressInfo;
    const targetAddress = targetServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        `CONNECT ${targetAddress.address}:${targetAddress.port} HTTP/1.1\r\nHost: ${targetAddress.address}:${targetAddress.port}\r\n\r\n`,
      );
    });

    const { promise, resolve } = Promise.withResolvers<string[]>();
    const responses: string[] = [];
    let requestCount = 0;

    client.on("data", data => {
      const str = data.toString();
      responses.push(str);

      if (str.includes("200 Connection established") && requestCount === 0) {
        // Send first request
        client.write("GET /first HTTP/1.1\r\nHost: example.com\r\nConnection: keep-alive\r\n\r\n");
        requestCount++;
      } else if (str.includes("Hello") && requestCount === 1) {
        // Send second request on same connection
        client.write("GET /second HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
        requestCount++;
      } else if (str.includes("Hello") && requestCount === 2) {
        client.end();
        resolve(responses);
      }
    });

    const allResponses = await promise;
    const combined = allResponses.join("");
    expect(combined).toContain("200 Connection established");
    expect(combined.match(/Hello/g)?.length).toBe(2);
  });
});

// The socket of a 'connect' listener, or of an 'upgrade' listener whose request has no body, is the connection
// itself as a net.Socket. It closes after its own 'end' and 'finish', so it outlives a connection that closes
// before its reader has taken every byte.
describe("a tunnel socket whose connection closes before it is read", () => {
  const exchanges = {
    connect: {
      request: "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
      reply: "HTTP/1.1 200 Connection Established\r\n\r\n",
    },
    upgrade: {
      request: "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n",
      reply: "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n",
    },
  };
  const handoffs = ["connect", "upgrade"] as const;
  const finOrders = [
    ["the listener ends the socket, then the peer sends and ends", true],
    ["the peer sends and ends, then the listener ends the socket", false],
  ] as const;

  // 251 is prime, so the pattern lines up with no chunk and no read.
  const pattern = Buffer.from(Array.from({ length: 251 }, (_, i) => i));
  const patterned = (length: number) => Buffer.alloc(length, pattern);
  // Half of the high water mark: the socket reads all of it with nobody reading the socket.
  const belowHighWaterMark = (socket: net.Socket) => patterned(socket.readableHighWaterMark / 2);

  // One exchange on a connection of its own. When it is over, the server has read what was sent before it.
  async function barrier(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.resume();
    socket.end("GET /barrier HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
    await once(socket, "close");
  }

  const connectionsOf = (server: net.Server) =>
    new Promise<number>((resolve, reject) =>
      server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
    );

  // The listener runs `early`, answers, and ends the socket if `ends`. The client is half-open, so it still sends
  // after the server's FIN. `events` has the name of each event in `watch` that the socket emits.
  async function openTunnel(
    event: "connect" | "upgrade",
    options: { ends: boolean; watch?: string[]; early?: (socket: net.Socket) => void },
  ) {
    const events: string[] = [];
    const { promise: handedOff, resolve: onHandoff } = Promise.withResolvers<net.Socket>();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => void res.end("ok"));
    server.on(event, (req, socket) => {
      for (const name of options.watch ?? ["end", "error", "close"]) socket.on(name, () => events.push(name));
      socket.on("close", () => onClosed());
      options.early?.(socket as net.Socket);
      socket.write(exchanges[event].reply);
      if (options.ends) socket.end();
      onHandoff(socket as net.Socket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    client.on("error", () => {});
    client.on("data", () => {});
    const ready = once(client, options.ends ? "end" : "data");
    client.write(exchanges[event].request);
    const tunnel = await handedOff;
    await ready;
    return {
      server,
      port,
      client,
      tunnel,
      events,
      closed,
      async [Symbol.asyncDispose]() {
        client.destroy();
        tunnel.destroy();
        server.close();
      },
    };
  }

  type Reader = {
    // Runs in the listener.
    early?: (socket: net.Socket) => void;
    // Runs when the connection has closed.
    late: (socket: net.Socket) => unknown;
  };
  const readers: Record<string, (chunks: Buffer[]) => Reader> = {
    "a 'data' listener that comes late": chunks => ({
      late: socket => void socket.on("data", (chunk: Buffer) => chunks.push(chunk)),
    }),
    "pause() with a 'data' listener and a late resume()": chunks => ({
      early: socket => void socket.on("data", (chunk: Buffer) => chunks.push(chunk)).pause(),
      late: socket => void socket.resume(),
    }),
    "a 'readable' listener that comes late": chunks => ({
      late: socket =>
        void socket.on("readable", () => {
          for (let chunk: Buffer | null; (chunk = socket.read()) !== null;) chunks.push(chunk);
        }),
    }),
    "a for await loop that starts late": chunks => ({
      late: async socket => {
        for await (const chunk of socket) chunks.push(chunk);
      },
    }),
    "pipe() to a Writable that is busy with its first chunk": chunks => {
      const { promise: busy, resolve: onConnectionClosed } = Promise.withResolvers<void>();
      const destination = new Writable({
        highWaterMark: 1,
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          busy.then(() => callback());
        },
      });
      return {
        early: socket => void socket.pipe(destination),
        late: socket => {
          onConnectionClosed();
          // A socket that was destroyed does not end its destination.
          if (!socket.destroyed) return once(destination, "finish");
        },
      };
    },
  };

  for (const [order, listenerEndsFirst] of finOrders) {
    describe(order, () => {
      for (const event of handoffs) {
        // The socket does the same for every reader, so 'upgrade' runs one of them.
        for (const name of event === "connect" ? Object.keys(readers) : ["a 'data' listener that comes late"]) {
          test(`'${event}': every byte, then 'end', then 'close', for ${name}`, async () => {
            const chunks: Buffer[] = [];
            const reader = readers[name](chunks);
            await using t = await openTunnel(event, { ends: listenerEndsFirst, early: reader.early });
            const sent = belowHighWaterMark(t.tunnel);
            // In two reads, for the reader that is busy with the first one.
            t.client.write(sent.subarray(0, sent.length / 2));
            await barrier(t.port);
            t.client.end(sent.subarray(sent.length / 2));
            await barrier(t.port);
            if (!listenerEndsFirst) {
              t.tunnel.end();
              await barrier(t.port);
            }

            // Both sides have sent their FIN, so the connection has closed. The socket stays for its reader.
            const atClose = { destroyed: t.tunnel.destroyed, events: [...t.events] };
            await reader.late(t.tunnel);
            await t.closed;
            expect({ atClose, intact: Buffer.concat(chunks).equals(sent), events: t.events }).toEqual({
              atClose: { destroyed: false, events: [] },
              intact: true,
              events: ["end", "close"],
            });
          });
        }
      }
    });
  }

  for (const event of handoffs) {
    describe(`'${event}'`, () => {
      // The end of the stream is push(null), then read(0). That emits 'end' when there is nothing to read, and it
      // does not resume the socket: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L231-L232
      for (const [when, ends] of [
        ["the listener ended the socket", true],
        ["the listener left the socket open", false],
      ] as const) {
        test(`the peer's FIN leaves a paused socket paused when ${when}`, async () => {
          await using t = await openTunnel(event, {
            ends,
            watch: ["pause", "resume", "end", "error", "close"],
            early: socket => void socket.pause(),
          });
          const ended = once(t.tunnel, "end");
          t.client.end();
          await ended;
          if (ends) await t.closed;
          else await barrier(t.port);
          expect({ events: t.events, paused: t.tunnel.isPaused(), flowing: t.tunnel.readableFlowing }).toEqual({
            // A socket that has ended both ways closes.
            events: ends ? ["pause", "end", "close"] : ["pause", "end"],
            paused: true,
            flowing: false,
          });
        });
      }

      for (const method of ["destroy", "destroySoon", "resetAndDestroy"] as const) {
        test(`${method}() closes a socket that waits for its reader`, async () => {
          await using t = await openTunnel(event, { ends: true });
          const sent = belowHighWaterMark(t.tunnel);
          t.client.end(sent);
          await barrier(t.port);

          const before = { destroyed: t.tunnel.destroyed, buffered: t.tunnel.readableLength };
          t.tunnel[method]();
          await t.closed;
          const connections = await connectionsOf(t.server);
          await new Promise<void>(resolve => t.server.close(() => resolve()));
          expect({ before, events: t.events, connections }).toEqual({
            before: { destroyed: false, buffered: sent.length },
            events: ["close"],
            connections: 0,
          });
        });
      }

      test("socket.setTimeout() fires on a socket that nobody reads", async () => {
        await using t = await openTunnel(event, {
          ends: true,
          watch: ["finish", "timeout", "end", "error", "close"],
        });
        t.client.end(belowHighWaterMark(t.tunnel));
        await barrier(t.port);
        const waiting = { destroyed: t.tunnel.destroyed, events: [...t.events] };

        t.tunnel.setTimeout(50, () => t.tunnel.destroy());
        await t.closed;
        expect({ waiting, events: t.events, connections: await connectionsOf(t.server) }).toEqual({
          waiting: { destroyed: false, events: ["finish"] },
          events: ["finish", "timeout", "close"],
          connections: 0,
        });
      });

      // The peer has not ended its stream, so there is no 'end'.
      test("destroySoon() while the peer is silent emits 'finish', then 'close'", async () => {
        let received = 0;
        await using t = await openTunnel(event, {
          ends: false,
          watch: ["finish", "end", "error", "close"],
          early: socket => void socket.on("data", (chunk: Buffer) => (received += chunk.length)),
        });
        const sent = belowHighWaterMark(t.tunnel);
        t.client.write(sent);
        await barrier(t.port);

        t.tunnel.destroySoon();
        await t.closed;
        expect({ received, events: t.events }).toEqual({ received: sent.length, events: ["finish", "close"] });
      });
    });
  }

  // More than the high water mark, so the socket reads the end of the stream while its reader is still behind.
  describe("'connect': a reader that lags behind 1 MiB", () => {
    const sent = patterned(1024 * 1024);

    for (const [order, listenerEndsFirst] of finOrders) {
      for (const [reader, loops] of [
        ["stream.pipeline() to a slow Writable", false],
        ["for await with a slow loop body", true],
      ] as const) {
        test(`${order}: ${reader} gets every byte`, async () => {
          const chunks: Buffer[] = [];
          const { promise: socketIsAhead, resolve: onSocketIsAhead } = Promise.withResolvers<void>();
          // The reader holds its first chunk until the socket has read ahead of it. Then it takes one chunk in each
          // turn of the event loop, so it stays behind the socket up to the end of the stream.
          const lag = () => (chunks.length === 1 ? socketIsAhead : new Promise<void>(resolve => setImmediate(resolve)));
          const { promise: read, resolve: onRead } = Promise.withResolvers<unknown>();
          await using t = await openTunnel("connect", {
            ends: listenerEndsFirst,
            early: socket => {
              if (loops) {
                (async () => {
                  for await (const chunk of socket) {
                    chunks.push(chunk);
                    await lag();
                  }
                })().then(onRead, onRead);
                return;
              }
              const slow = new Writable({
                highWaterMark: 1,
                write(chunk, encoding, callback) {
                  chunks.push(chunk);
                  lag().then(() => callback());
                },
              });
              pipeline(socket, slow, error => onRead(error));
            },
          });
          t.client.end(sent, () => {
            if (!listenerEndsFirst) t.tunnel.end();
          });
          await barrier(t.port);
          onSocketIsAhead();

          await t.closed;
          // The events of the socket come first, so that a socket that closes with no 'end' fails here and not by
          // a timeout.
          expect(t.events).toEqual(["end", "close"]);
          expect({ error: await read, intact: Buffer.concat(chunks).equals(sent) }).toEqual({
            error: undefined,
            intact: true,
          });
        });
      }
    }
  });

  // Node.js gives the listener an UpgradeStream when the body of the request is still on its way. The close of the
  // connection destroys that stream, with the bytes that nobody has read.
  describe("an Upgrade request with a body that arrives after the 'upgrade' listener ran", () => {
    const head =
      "POST / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: raw\r\nContent-Length: 10\r\n\r\n";

    for (const reads of [true, false]) {
      const name = reads
        ? "a reader that comes late gets nothing, and the socket emits 'close' with no 'end'"
        : "a socket that nobody reads closes with the connection, and server.close() calls back";
      test(name, async () => {
        const events: string[] = [];
        let body = 0;
        const { promise: handedOff, resolve: onHandoff } = Promise.withResolvers<net.Socket>();
        const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
        const server = http.createServer((req, res) => void res.end("ok"));
        server.on("upgrade", (req, socket) => {
          for (const name of ["end", "error", "close"]) socket.on(name, () => events.push(name));
          socket.on("close", () => onClosed());
          req.on("data", (chunk: Buffer) => (body += chunk.length));
          // The listener ends the socket when it has the body of the request.
          req.on("end", () => socket.end());
          socket.write(exchanges.upgrade.reply);
          onHandoff(socket as net.Socket);
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const { port } = server.address() as AddressInfo;
        const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
        let tunnel: net.Socket | undefined;
        try {
          client.on("error", () => {});
          client.on("data", () => {});
          const replied = once(client, "data");
          const serverEnded = once(client, "end");
          client.write(head);
          tunnel = await handedOff;
          await replied;
          // The listener has run. The body ends the request, and the listener ends the socket.
          client.write("0123456789");
          await serverEnded;
          client.end(belowHighWaterMark(tunnel));
          // The socket does not wait for a reader.
          await closed;

          const atClose = { destroyed: tunnel.destroyed, events: [...events] };
          let received = 0;
          if (reads) {
            tunnel.on("data", (chunk: Buffer) => (received += chunk.length));
            await barrier(port);
          } else {
            await new Promise<void>(resolve => server.close(() => resolve()));
          }
          expect({ body, atClose, received, events }).toEqual({
            body: 10,
            atClose: { destroyed: true, events: ["close"] },
            received: 0,
            events: ["close"],
          });
        } finally {
          client.destroy();
          tunnel?.destroy();
          server.close();
        }
      });
    }
  });

  test("a CONNECT pipelined behind a response that never ends keeps its unread bytes", async () => {
    const events: string[] = [];
    let responseClosed = false;
    let responseClosedAtEnd: boolean | undefined;
    const { promise: handedOff, resolve: onHandoff, reject: onFailure } = Promise.withResolvers<net.Socket>();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const { promise: responseDone, resolve: onResponseClosed } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      if (req.method === "CONNECT") onFailure(new Error("the CONNECT was dispatched as a request"));
      if (req.url !== "/first") return void res.end("ok");
      res.on("close", () => {
        responseClosed = true;
        onResponseClosed();
      });
    });
    server.on("connect", (req, socket) => {
      socket.on("end", () => {
        events.push("end");
        responseClosedAtEnd = responseClosed;
      });
      socket.on("error", () => events.push("error"));
      socket.on("close", () => {
        events.push("close");
        onClosed();
      });
      socket.write(exchanges.connect.reply);
      socket.end();
      onHandoff(socket as net.Socket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let tunnel: net.Socket | undefined;
    try {
      client.on("error", () => {});
      client.resume();
      const serverEnded = once(client, "end");
      client.write("GET /first HTTP/1.1\r\nHost: example.com\r\n\r\n" + exchanges.connect.request);
      tunnel = await handedOff;
      await serverEnded;
      client.end("tunneled");
      await barrier(port);

      // The connection has closed. The response ahead closes with the socket, which stays for its reader.
      const atClose = { destroyed: tunnel.destroyed, events: [...events], responseClosed };
      let tunneled = "";
      tunnel.on("data", chunk => (tunneled += chunk));
      await closed;
      await responseDone;
      expect({ atClose, tunneled, events, responseClosedAtEnd }).toEqual({
        atClose: { destroyed: false, events: [], responseClosed: false },
        tunneled: "tunneled",
        events: ["end", "close"],
        responseClosedAtEnd: false,
      });
    } finally {
      client.destroy();
      tunnel?.destroy();
      server.close();
    }
  });

  // serverB parses the socket in JavaScript, and its 'upgrade' listener gets the same socket.
  test("a 'connect' socket that was emitted as a connection of a second server keeps its unread bytes", async () => {
    const events: string[] = [];
    const { promise: handedOff, resolve: onHandoff } = Promise.withResolvers<net.Socket>();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    const serverA = http.createServer((req, res) => void res.end("ok"));
    const serverB = http.createServer();
    serverA.on("connect", (req, socket) => {
      socket.write(exchanges.connect.reply);
      serverB.emit("connection", socket);
    });
    serverB.on("upgrade", (req, socket) => {
      for (const name of ["end", "error", "close"]) socket.on(name, () => events.push(name));
      socket.on("close", () => onClosed());
      socket.write(exchanges.upgrade.reply);
      socket.end();
      onHandoff(socket as net.Socket);
    });
    await once(serverA.listen(0, "127.0.0.1"), "listening");
    const { port } = serverA.address() as AddressInfo;
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let tunnel: net.Socket | undefined;
    try {
      client.on("error", () => {});
      // The 200 of serverA. The Upgrade request is for serverB.
      client.once("data", () => client.write(exchanges.upgrade.request));
      client.on("data", () => {});
      const serverEnded = once(client, "end");
      client.write(exchanges.connect.request);
      tunnel = await handedOff;
      await serverEnded;
      const sent = belowHighWaterMark(tunnel);
      client.end(sent);
      await barrier(port);
      const waiting = { destroyed: tunnel.destroyed, events: [...events] };

      const chunks: Buffer[] = [];
      tunnel.on("data", (chunk: Buffer) => chunks.push(chunk));
      await closed;
      // serverA accepted the connection, so it is the server that stops counting it.
      const connectionsOfA = await connectionsOf(serverA);
      await new Promise<void>(resolve => serverA.close(() => resolve()));
      expect({ waiting, intact: Buffer.concat(chunks).equals(sent), events, connectionsOfA }).toEqual({
        waiting: { destroyed: false, events: [] },
        intact: true,
        events: ["end", "close"],
        connectionsOfA: 0,
      });
    } finally {
      client.destroy();
      tunnel?.destroy();
      serverA.close();
    }
  });

  // https://nodejs.org/api/http.html#event-connect
  test("the tunneling proxy of the Node.js documentation keeps a socket whose last bytes nobody reads", async () => {
    const origin = net.createServer(socket => {
      socket.on("error", () => {});
      socket.end("from the origin");
    });
    const proxy = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("okay");
    });
    const { promise: handedOff, resolve: onHandoff } = Promise.withResolvers<[net.Socket, net.Socket]>();
    proxy.on("connect", (req, clientSocket, head) => {
      const { port, hostname } = new URL(`http://${req.url}`);
      const serverSocket = net.connect(Number(port) || 80, hostname, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n" + "Proxy-agent: Node.js-Proxy\r\n" + "\r\n");
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      onHandoff([clientSocket as net.Socket, serverSocket]);
    });
    await once(origin.listen(0, "127.0.0.1"), "listening");
    await once(proxy.listen(0, "127.0.0.1"), "listening");
    const { port } = proxy.address() as AddressInfo;
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let sockets: net.Socket[] = [];
    try {
      client.on("error", () => {});
      client.resume();
      const proxyEnded = once(client, "end");
      const target = `127.0.0.1:${(origin.address() as AddressInfo).port}`;
      client.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      const [tunnel, originSide] = (sockets = await handedOff);
      // The origin ends its stream, so the proxy ends the tunnel.
      await proxyEnded;
      client.end(Buffer.alloc(24, "x"));
      await barrier(port);
      // The proxy's socket to the origin closes as well.
      if (!originSide.closed) await once(originSide, "close");

      // The end of the origin's stream removes the pipe to the origin, and unpipe() leaves the socket paused. So
      // nobody takes the 24 bytes, and the socket stays until its owner reads or destroys it.
      expect({ closed: tunnel.closed, paused: tunnel.isPaused(), buffered: tunnel.readableLength }).toEqual({
        closed: false,
        paused: true,
        buffered: 24,
      });
    } finally {
      client.destroy();
      for (const socket of sockets) socket.destroy();
      proxy.close();
      origin.close();
    }
  });
});
