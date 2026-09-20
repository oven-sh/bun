import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, nodeExe, tempDir, tls as tlsCert } from "harness";
import http from "http";

import { once } from "node:events";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";
import { Writable } from "node:stream";
import tls from "node:tls";
import { WebSocketServer } from "ws";
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

const BIG_DATA = Buffer.alloc(1024 * 1024 * 64, "bun").toString();
describe("HTTP server CONNECT", () => {
  test("should handle backpressure", async () => {
    const responseHeader = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });
    await using targetServer = net.createServer(socket => {
      // Accepted net sockets start in Node's flowing=null state; drain the
      // inbound GET so 'end' can fire and server.close() can resolve.
      socket.resume();
      socket.write(responseHeader, () => {
        socket.write(BIG_DATA, () => {
          //TODO: is this a net bug? on windows the connection is closed before everything is sended
          Bun.sleep(100).then(() => {
            socket.end();
          });
        });
      });
    });
    let proxyHeaders = {};
    proxyServer.on("connect", (req, socket, head) => {
      proxyHeaders = req.headers;
      const [host, port] = req.url?.split(":") ?? [];

      const serverSocket = net.connect(parseInt(port), host, async () => {
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
      expect(response.length).toBeGreaterThan(responseHeader.length + BIG_DATA.length);
      expect(response).toContain(BIG_DATA);
    }
  });

  test("should handle data, drain, end and close events", async () => {
    await using proxyServer = http.createServer((req, res) => {
      res.end("Hello World from proxy server");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;
    let data_received: string[] = [];
    let client_data_received: string[] = [];
    let proxy_drain_received = false;
    let proxy_end_received = false;

    const { promise, resolve, reject } = Promise.withResolvers<string>();

    const { promise: clientPromise, resolve: clientResolve, reject: clientReject } = Promise.withResolvers<string>();
    const clientSocket = net.connect(proxyAddress.port, proxyAddress.address, () => {
      clientSocket.on("error", clientReject);
      clientSocket.on("data", chunk => {
        client_data_received.push(chunk?.toString());
      });
      clientSocket.on("end", () => {
        clientSocket.end();
        clientResolve(client_data_received.join(""));
      });

      clientSocket.write("CONNECT localhost:80 HTTP/1.1\r\nHost: localhost:80\r\nConnection: close\r\n\r\n");
    });

    proxyServer.on("connect", (req, socket, head) => {
      expect(head).toBeInstanceOf(Buffer);
      socket.on("data", chunk => {
        data_received.push(chunk?.toString());
      });
      socket.on("end", () => {
        proxy_end_received = true;
      });
      socket.on("close", () => {
        resolve(data_received.join(""));
      });
      socket.on("drain", () => {
        proxy_drain_received = true;
        socket.end();
      });
      socket.on("error", reject);
      proxy_drain_received = false;
      // write until backpressure
      while (socket.write(BIG_DATA)) {}
      clientSocket.write("Hello World");
    });

    expect(await promise).toContain("Hello World");
    expect(await clientPromise).toContain(BIG_DATA);
    expect(proxy_drain_received).toBe(true);
    expect(proxy_end_received).toBe(true);
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

  // TODO: timeout is not supported in bun socket yet
  test.todo("should handle socket timeout", async () => {
    await using proxyServer = http.createServer();
    let timeoutFired = false;

    proxyServer.on("connect", (req, socket, head) => {
      socket.setTimeout(100);
      socket.on("timeout", () => {
        timeoutFired = true;
        socket.write("HTTP/1.1 408 Request Timeout\r\n\r\n");
        socket.end();
      });

      // Don't send any response immediately
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com\r\n\r\n");
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
    expect(timeoutFired).toBe(true);
    expect(response).toContain("408 Request Timeout");
  });

  // 8 MiB that line up with no chunk and no read: 251 is prime.
  const tunnelPayload = Buffer.alloc(8 * 1024 * 1024, Buffer.from(Array.from({ length: 251 }, (_, i) => i)));
  // A read is at most 512 KiB (LIBUS_RECV_BUFFER_LENGTH). The read that fills the buffer stops the reads,
  // and one more can be on its way to JS by then.
  const maxReadAhead = 2 * 512 * 1024;

  describe.each([
    ["http", "CONNECT"],
    ["http", "Upgrade"],
    ["https", "CONNECT"],
    ["https", "Upgrade"],
  ] as const)("read backpressure of an %s %s tunnel", (protocol, kind) => {
    const secure = protocol === "https";
    const handshake =
      kind === "CONNECT"
        ? "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"
        : "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: tunnel\r\n\r\n";
    const accept =
      kind === "CONNECT"
        ? "HTTP/1.1 200 Connection established\r\n\r\n"
        : "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tunnel\r\n\r\n";
    const payload = tunnelPayload;
    const total = payload.length;

    // The helpers of one test, around the sockets of that test.
    function setup() {
      const sockets: net.Socket[] = [];

      async function listen(onTunnel: (socket: net.Socket) => void, onRequest?: http.RequestListener) {
        const server = secure ? https.createServer({ key: tlsCert.key, cert: tlsCert.cert }) : http.createServer();
        server.on(kind === "CONNECT" ? "connect" : "upgrade", (req, socket) => {
          sockets.push(socket);
          onTunnel(socket);
        });
        server.on("request", onRequest ?? ((req, res) => res.end("ok")));
        await once(server.listen(0, "127.0.0.1"), "listening");
        return server;
      }

      function connect(server: http.Server) {
        const { port } = server.address() as AddressInfo;
        const socket = secure
          ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : net.connect(port, "127.0.0.1");
        sockets.push(socket);
        return socket;
      }

      // One exchange on a connection of its own: the event loop reads every socket that has bytes on the way.
      async function barrier(server: http.Server) {
        const socket = connect(server);
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        let response = "";
        socket.on("data", chunk => (response += chunk));
        socket.on("error", reject);
        socket.on("end", () => socket.end());
        socket.on("close", () => (response.endsWith("ok") ? resolve() : reject(new Error("barrier: " + response))));
        socket.write("GET /barrier HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
        await promise;
      }

      // The server has read all that it is going to read when the buffered length is the same after three
      // barriers in a row. Reads only stop at or above the high water mark.
      async function untilReadsStop(server: http.Server, tunnel: net.Socket) {
        let last = -1;
        for (let same = 0, barriers = 0; same < 3; barriers++) {
          if (barriers === 100) throw new Error(`the reads did not stop, ${last} bytes are buffered`);
          await barrier(server);
          const buffered = tunnel.readableLength;
          same = buffered === last && buffered >= tunnel.readableHighWaterMark ? same + 1 : 0;
          last = buffered;
        }
        return last;
      }

      async function openTunnel(server: http.Server) {
        const client = connect(server);
        client.write(handshake);
        const { promise: accepted, resolve: onAccepted } = Promise.withResolvers<void>();
        client.once("data", () => onAccepted());
        await unlessClosed(client, accepted);
        return client;
      }

      return {
        listen,
        connect,
        barrier,
        untilReadsStop,
        openTunnel,
        // Declared after the server: the sockets go first, so that the server can close, also when an assertion fails.
        destroySockets: () => ({ [Symbol.dispose]: () => sockets.splice(0).forEach(socket => socket.destroy()) }),
      };
    }

    // Sends the payload as fast as the socket takes it.
    function sendPayload(client: net.Socket) {
      let offset = 0;
      const pump = () => {
        while (offset < total) {
          const end = Math.min(offset + 64 * 1024, total);
          const more = client.write(payload.subarray(offset, end));
          offset = end;
          if (!more) return;
        }
      };
      client.on("drain", pump);
      pump();
    }

    // Rejects when the socket fails or closes before the promise settles.
    function unlessClosed<T>(socket: net.Socket, promise: Promise<T>) {
      const { promise: closed, reject } = Promise.withResolvers<never>();
      const onClose = () => reject(new Error("the socket closed first"));
      if (socket.destroyed) onClose();
      socket.once("error", reject).once("close", onClose);
      return Promise.race([promise, closed]).finally(() => socket.off("error", reject).off("close", onClose));
    }

    // The server writes only the accept line, which the socket takes at once: Node.js emits no 'drain' in these tests.
    test("a full buffer stops the reads, and resume() delivers every byte", async () => {
      const t = setup();
      let drains = 0;
      const { promise: tunnelPromise, resolve: onTunnel } = Promise.withResolvers<net.Socket>();
      await using server = await t.listen(socket => {
        socket.pause();
        socket.on("drain", () => drains++);
        socket.write(accept);
        onTunnel(socket);
      });
      using _ = t.destroySockets();
      const client = await t.openTunnel(server);
      sendPayload(client);
      const tunnel = await tunnelPromise;

      // Without read backpressure the socket holds the whole payload.
      const buffered = await t.untilReadsStop(server, tunnel);
      expect(buffered).toBeLessThanOrEqual(tunnel.readableHighWaterMark + maxReadAhead);

      // resume() with a full buffer starts no reads: the reader has made no room yet.
      tunnel.resume();
      tunnel.pause();
      await t.barrier(server);
      expect(tunnel.readableLength).toBe(buffered);

      const chunks: Buffer[] = [];
      let received = 0;
      const { promise: receivedAll, resolve: onReceivedAll } = Promise.withResolvers<void>();
      tunnel.on("data", chunk => {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= total) onReceivedAll();
      });
      tunnel.resume();
      await unlessClosed(tunnel, receivedAll);
      expect({ intact: Buffer.concat(chunks).equals(payload), drains }).toEqual({ intact: true, drains: 0 });
    });

    // An open Upgrade tunnel runs the same code as a CONNECT tunnel. The tests below move 8 to 24 MiB
    // each, on one thread, so they run for CONNECT only.
    if (kind === "Upgrade") return;

    // The reader takes the first half as fast as it arrives, so the kernel holds megabytes for the
    // socket when it pauses, and one turn of the read loop can take them all.
    test("a pause in the middle of a fast transfer stops the reads after two of them", async () => {
      const t = setup();
      const chunks: Buffer[] = [];
      let received = 0;
      let drains = 0;
      const { promise: pausedTunnel, resolve: onPaused } = Promise.withResolvers<net.Socket>();
      const { promise: receivedAll, resolve: onReceivedAll } = Promise.withResolvers<void>();
      await using server = await t.listen(socket => {
        socket.write(accept);
        socket.on("drain", () => drains++);
        socket.on("data", chunk => {
          chunks.push(chunk);
          const before = received;
          received += chunk.length;
          if (before < total / 2 && received >= total / 2) {
            socket.pause();
            onPaused(socket);
          }
          if (received >= total) onReceivedAll();
        });
      });
      using _ = t.destroySockets();
      const client = await t.openTunnel(server);
      sendPayload(client);
      const tunnel = await unlessClosed(client, pausedTunnel);

      expect(await t.untilReadsStop(server, tunnel)).toBeLessThanOrEqual(tunnel.readableHighWaterMark + maxReadAhead);

      tunnel.resume();
      await unlessClosed(tunnel, receivedAll);
      expect({ intact: Buffer.concat(chunks).equals(payload), drains }).toEqual({ intact: true, drains: 0 });
    });

    // pipe() pauses the socket when the destination is full and resumes it on 'drain'. The buffer is
    // full at that resume(), so the reads stay stopped until the destination has taken a chunk.
    test("pipe() to a slow destination holds a bounded buffer", async () => {
      const t = setup();
      const chunks: Buffer[] = [];
      let received = 0;
      let drains = 0;
      let maxBuffered = 0;
      const { promise: receivedAll, resolve: onReceivedAll } = Promise.withResolvers<net.Socket>();
      await using server = await t.listen(socket => {
        socket.write(accept);
        socket.on("drain", () => drains++);
        socket.pipe(
          new Writable({
            highWaterMark: 16 * 1024,
            write(chunk, encoding, callback) {
              chunks.push(chunk);
              received += chunk.length;
              maxBuffered = Math.max(maxBuffered, socket.readableLength);
              if (received >= total) onReceivedAll(socket);
              setImmediate(callback);
            },
          }),
        );
      });
      using _ = t.destroySockets();
      const client = await t.openTunnel(server);
      sendPayload(client);
      const tunnel = await unlessClosed(client, receivedAll);

      expect(maxBuffered).toBeLessThanOrEqual(tunnel.readableHighWaterMark + maxReadAhead);
      expect({ intact: Buffer.concat(chunks).equals(payload), drains }).toEqual({ intact: true, drains: 0 });
    });

    // The server pauses the reads of a connection whose response the client does not take (flood
    // prevention), and resumes them when that response has left.
    test("the end of flood prevention does not resume the reads that a full buffer stopped", async () => {
      const t = setup();
      const responseWritten = Promise.withResolvers<void>();
      const { promise: tunnelPromise, resolve: onTunnel } = Promise.withResolvers<net.Socket>();
      await using server = await t.listen(
        socket => {
          // An earlier request left the socket flowing. Paused, it buffers what it reads.
          socket.pause();
          onTunnel(socket);
        },
        (req, res) => {
          if (req.url !== "/unread") return void res.end("ok");
          // More than the kernel takes for a client that does not read.
          const chunk = Buffer.alloc(8 * 1024, "r");
          for (let written = 0; written < 16 * 1024 * 1024; written += chunk.length) res.write(chunk);
          res.end();
          responseWritten.resolve();
        },
      );
      using _ = t.destroySockets();
      const client = t.connect(server);
      client.pause();
      client.write("GET /unread HTTP/1.1\r\nHost: example.com\r\n\r\n");
      await unlessClosed(client, responseWritten.promise);
      client.write(handshake);
      const tunnel = await unlessClosed(client, tunnelPromise);
      sendPayload(client);

      // Flood prevention holds the reads: part of the response is still unsent.
      await t.barrier(server);
      expect(tunnel.readableLength).toBe(0);
      // A reader starts them, as a 'data' listener does, then lets the buffer fill.
      tunnel.resume();
      tunnel.pause();
      const buffered = await t.untilReadsStop(server, tunnel);

      // The client takes the response. It ends with the last chunk of the chunked encoding.
      const { promise: responseRead, resolve: onResponseRead } = Promise.withResolvers<void>();
      const lastChunk = Buffer.from("\r\n0\r\n\r\n");
      let tail = Buffer.alloc(0);
      client.on("data", chunk => {
        tail = (chunk.length < lastChunk.length ? Buffer.concat([tail, chunk]) : chunk).subarray(-lastChunk.length);
        if (tail.equals(lastChunk)) onResponseRead();
      });
      client.resume();
      await unlessClosed(client, responseRead);
      await t.barrier(server);
      expect(tunnel.readableLength).toBe(buffered);
    });

    // The reader takes each chunk at once here. A reader that falls behind still loses what it has
    // not taken when the connection closes.
    test("end() behind a full buffer leaves the reads stopped, and the rest, 'end' and 'close' still arrive", async () => {
      const t = setup();
      const { promise: tunnelPromise, resolve: onTunnel } = Promise.withResolvers<net.Socket>();
      await using server = await t.listen(socket => {
        socket.pause();
        socket.write(accept);
        onTunnel(socket);
      });
      using _ = t.destroySockets();
      const client = await t.openTunnel(server);
      const sent = payload.subarray(0, 1024 * 1024);
      client.end(sent);
      const tunnel = await tunnelPromise;
      const buffered = await t.untilReadsStop(server, tunnel);
      expect(buffered).toBeLessThan(sent.length);

      // The socket stays paused with these listeners: pause() was explicit.
      const events: string[] = [];
      const chunks: Buffer[] = [];
      tunnel.on("data", chunk => chunks.push(chunk));
      tunnel.on("end", () => events.push("end"));
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      tunnel.on("close", () => onClosed());

      // end() sends the FIN and leaves the reads stopped.
      tunnel.end();
      await t.barrier(server);
      expect({ buffered: tunnel.readableLength, events }).toEqual({ buffered, events: [] });

      tunnel.resume();
      await closed;
      expect({ intact: Buffer.concat(chunks).equals(sent), events }).toEqual({ intact: true, events: ["end"] });
    });
  });

  // Bytes that reach the socket of an 'upgrade' listener before handleUpgrade() fill its buffer and stop
  // the reads. The WebSocket takes the connection over from that socket, so it has to start them again.
  test("handleUpgrade() after the upgrade socket stopped its reads still receives frames", async () => {
    await using server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    const upgradeSocket = Promise.withResolvers<net.Socket>();
    const proceed = Promise.withResolvers<void>();
    server.on("upgrade", async (req, socket, head) => {
      upgradeSocket.resolve(socket);
      await proceed.promise;
      wss.handleUpgrade(req, socket, head, ws => ws.on("message", data => ws.send(String(data))));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const client = net.connect(port, "127.0.0.1");
    using _ = {
      [Symbol.dispose]: () => {
        client.destroy();
        wss.close();
      },
    };
    const received: Buffer[] = [];
    const echoed = Promise.withResolvers<void>();
    // The unmasked echo of the text frame below: FIN + text, length 5, "hello".
    const echo = Buffer.from([0x81, 0x05, ...Buffer.from("hello")]);
    const fail = (error: Error) => {
      upgradeSocket.reject(error);
      echoed.reject(error);
    };
    // The test awaits one of the two at a time.
    upgradeSocket.promise.catch(() => {});
    echoed.promise.catch(() => {});
    client.on("error", fail);
    client.on("close", () => fail(new Error("the connection closed before the echo")));
    client.on("data", chunk => {
      received.push(chunk);
      if (Buffer.concat(received).includes(echo)) echoed.resolve();
    });
    client.write(
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );

    // A masked frame from the client: 2 bytes of header, the mask, the payload.
    const mask = [1, 2, 3, 4];
    const frame = (opcode: number, payload: Buffer) =>
      Buffer.from([0x80 | opcode, 0x80 | payload.length, ...mask, ...payload.map((byte, i) => byte ^ mask[i % 4])]);

    // Exactly one high water mark of early bytes, sent once the listener has the socket: the socket
    // buffers all of them, so the text frame after them is the first byte that the WebSocket reads.
    // They are pongs, which a server ignores, so they are also valid for a WebSocket that would get them.
    const socket = await upgradeSocket.promise;
    const highWaterMark = socket.readableHighWaterMark;
    const pongs: Buffer[] = [];
    for (let left = highWaterMark; left > 0; ) {
      // A frame is 6 to 131 bytes. Never leave less than a frame.
      const length = left <= 131 ? left : Math.min(131, left - 6);
      pongs.push(frame(0xa, Buffer.alloc(length - 6)));
      left -= length;
    }
    client.write(Buffer.concat(pongs));
    while (socket.readableLength < highWaterMark && !socket.destroyed && !client.destroyed) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(socket.readableLength).toBe(highWaterMark);
    proceed.resolve();

    client.write(frame(0x1, Buffer.from("hello")));
    await echoed.promise;
    expect(Buffer.concat(received).toString("latin1")).toStartWith("HTTP/1.1 101 ");
  });

  test("should deliver bytes following a CONNECT request with Content-Length: 0 to the connect socket, not as a new request", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "GET /pipelined HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(`CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nContent-Length: 0\r\n\r\n${pipelined}`);
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0 tunnels "5\r\nhello\r\n0\r\n\r\nGET ..." verbatim — the chunked framing
  // bytes reach the connect socket un-decoded and no 'request' event fires.
  test("should deliver bytes following a CONNECT request with Transfer-Encoding: chunked raw, not chunk-decoded", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "5\r\nhello\r\n0\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        `CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: chunked\r\n\r\n${pipelined}`,
      );
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0 tunnels "helloGET /smuggled ..." verbatim — the declared body and
  // everything after it reach the connect socket and no 'request' event fires.
  test("should deliver the body and trailing bytes of a CONNECT request with a nonzero Content-Length to the connect socket, not as a new request", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });

    const pipelined = "helloGET /smuggled HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const afterEstablished = "GET /after-established HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const expectedTunneled = pipelined + afterEstablished;

    const { promise: tunneled, resolve: resolveTunneled, reject: rejectTunneled } = Promise.withResolvers<string>();
    proxyServer.on("connect", (req, socket, head) => {
      const chunks: Buffer[] = [head];
      let receivedLength = head.length;
      socket.on("data", chunk => {
        chunks.push(chunk);
        receivedLength += chunk.length;
        if (receivedLength >= Buffer.byteLength(expectedTunneled)) {
          socket.end();
        }
      });
      socket.on("end", () => {
        resolveTunneled(Buffer.concat(chunks).toString());
      });
      socket.on("error", rejectTunneled);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise: clientReceived, resolve: resolveClient, reject: rejectClient } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(`CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nContent-Length: 5\r\n\r\n${pipelined}`);
    });
    client.on("data", data => {
      received.push(data.toString());
      if (received.join("") === "HTTP/1.1 200 Connection established\r\n\r\n") {
        client.write(afterEstablished);
      }
    });
    client.on("error", rejectClient);
    client.on("end", () => {
      client.end();
      resolveClient(received.join(""));
    });

    expect(await tunneled).toBe(expectedTunneled);
    expect(await clientReceived).toBe("HTTP/1.1 200 Connection established\r\n\r\n");
    expect(requestUrls).toEqual([]);
  });

  // Node v26.3.0: the request of a 'connect' event has no body, whatever framing the
  // CONNECT declares. It ends with no data and the socket gets each tunnel byte once.
  // The parser enters tunnel mode at the request line only for an authority-form target.
  describe.each([
    ["example.com:80", "Content-Length: 5"],
    ["example.com:80", "Transfer-Encoding: chunked"],
    ["/x", "Content-Length: 5"],
    ["/x", "Transfer-Encoding: chunked"],
  ])("CONNECT %s with %s", (target, framing) => {
    test.each([
      ["a flowing", false],
      ["a paused", true],
    ])("should deliver the tunnel bytes to %s connect socket and none to the request", async (_, paused) => {
      await using proxyServer = http.createServer();
      const payload = "hello tunnel";

      const { promise, resolve, reject } = Promise.withResolvers<{ request: string; tunneled: string }>();
      let tunnelClosed = false;
      proxyServer.on("connect", async (req, socket, head) => {
        try {
          socket.on("error", reject);
          socket.once("close", () => (tunnelClosed = true));
          if (paused) socket.pause();
          socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
          // Paused: every tunnel byte arrives before anything reads the request or the socket.
          // The deadline is below the default test timeout, so a stalled tunnel reports its byte count.
          const deadline = Date.now() + 4000;
          while (paused && socket.readableLength < payload.length) {
            if (tunnelClosed) {
              throw new Error(`tunnel closed with ${socket.readableLength} of ${payload.length} bytes buffered`);
            }
            if (Date.now() > deadline) {
              throw new Error(`only ${socket.readableLength} of ${payload.length} bytes buffered in the paused socket`);
            }
            await new Promise(tick => setImmediate(tick));
          }

          const requestChunks: Buffer[] = [];
          const tunnelChunks: Buffer[] = [head];
          req.on("data", chunk => requestChunks.push(chunk));
          socket.on("data", chunk => tunnelChunks.push(chunk));
          socket.on("end", () => socket.end());
          if (paused) socket.resume();
          await Promise.all([once(req, "end"), once(socket, "end")]);
          resolve({
            request: Buffer.concat(requestChunks).toString(),
            tunneled: Buffer.concat(tunnelChunks).toString(),
          });
        } catch (err) {
          // The server's dispose waits for this socket, and a timeout would hide the error.
          socket.destroy();
          reject(err);
        }
      });

      await once(proxyServer.listen(0, "127.0.0.1"), "listening");
      const proxyAddress = proxyServer.address() as AddressInfo;

      const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
        client.write(`CONNECT ${target} HTTP/1.1\r\nHost: example.com:80\r\n${framing}\r\n\r\n`);
      });
      client.on("error", reject);
      client.once("close", () => (tunnelClosed = true));
      client.once("data", () => client.end(payload));

      expect(await promise).toEqual({ request: "", tunneled: payload });
    });
  });

  // Node v26.3.0: HPE_INVALID_CONTENT_LENGTH — Transfer-Encoding + Content-Length is
  // rejected with a 400 before the 'connect' event is dispatched.
  test("should reject a CONNECT request carrying both Transfer-Encoding and Content-Length with a 400", async () => {
    const requestUrls: string[] = [];
    await using proxyServer = http.createServer((req, res) => {
      requestUrls.push(req.url ?? "");
      res.end();
    });
    let connectEvents = 0;
    proxyServer.on("connect", (req, socket) => {
      connectEvents++;
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const received: string[] = [];
    const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
      client.write(
        "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n",
      );
    });
    client.on("data", data => received.push(data.toString()));
    client.on("error", reject);
    client.on("close", () => resolve(received.join("")));

    const response = await promise;
    expect(response).toContain("400 Bad Request");
    expect(connectEvents).toBe(0);
    expect(requestUrls).toEqual([]);
  });

  test("should handle malformed CONNECT requests", async () => {
    await using proxyServer = http.createServer();

    proxyServer.on("connect", (req, socket, head) => {
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.end();
    });

    await once(proxyServer.listen(0, "127.0.0.1"), "listening");
    const proxyAddress = proxyServer.address() as AddressInfo;

    // Requests Node.js rejects before dispatching the 'connect' event.
    const malformedRequests = [
      "CONNECT\r\n\r\n", // Missing target
      "CONNEC example.com:80 HTTP/1.1\r\n\r\n", // Typo in method
      "CONNECT example.com:80\r\n\r\n", // Missing HTTP version (Node.js treats this as ancient HTTP; we reject it)
    ];

    // Node.js dispatches these to the 'connect' event: CONNECT requests are
    // exempt from the Host requirement and the authority form is not
    // validated beyond tokenization (verified against Node.js).
    const acceptedRequests = [
      "CONNECT example.com HTTP/1.1\r\n\r\n", // Missing port
      "CONNECT :80 HTTP/1.1\r\n\r\n", // Missing host
    ];

    for (const request of acceptedRequests) {
      const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
        client.write(request);
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      const received: string[] = [];
      client.on("data", data => {
        received.push(data.toString());
      });
      client.on("end", () => {
        resolve(received.join(""));
      });
      client.on("error", () => {
        resolve("CONNECTION_ERROR");
      });

      const response = await promise;
      expect(response).toContain("200 Connection established");
    }

    for (const request of malformedRequests) {
      const client = net.connect(proxyAddress.port, proxyAddress.address, () => {
        client.write(request);
      });

      const { promise, resolve } = Promise.withResolvers<string>();
      const received: string[] = [];

      client.on("data", data => {
        received.push(data.toString());
      });

      client.on("end", () => {
        resolve(received.join(""));
      });

      client.on("error", () => {
        resolve("CONNECTION_ERROR");
      });

      setTimeout(() => {
        client.end();
        resolve(received.join("") || "TIMEOUT");
      }, 100);

      const response = await promise;
      // Should either get an error response or timeout/connection error
      expect(response).not.toContain("200 Connection established");
    }
  });

  // https CONNECT: server socket.end() after peer FIN must also FIN the TCP
  // write side. Linux-only: the close is observed via EPOLLHUP once both halves
  // have FIN'd; kqueue/libuv need the readable_ended re-arm to re-derive it.
  test.skipIf(!isLinux)(
    "https CONNECT socket.end() after peer FIN half-closes TCP so the socket can close",
    async () => {
      // tls.connect wraps a raw net.Socket so end() sends a raw FIN (not
      // close_notify first): that ordering has the server's eof already
      // consumed by allow_half_open before the deferred socket.end() runs.
      const fixture = /* js */ `
      const https = require("node:https");
      const net = require("node:net");
      const tls = require("node:tls");

      const server = https.createServer({ cert: process.env.CERT, key: process.env.KEY }, () => {});
      server.on("connect", (req, socket) => {
        // autoDestroy off: only the transport (EPOLLHUP once our FIN answers
        // the peer's) can close this socket.
        socket._readableState.autoDestroy = false;
        socket._writableState.autoDestroy = false;
        socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
        socket.on("end", () => {
          console.log("server:end");
          socket.end();
        });
        socket.on("finish", () => console.log("server:finish"));
        socket.on("close", () => {
          console.log("server:close");
          server.close();
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const raw = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
        const client = tls.connect({ socket: raw, rejectUnauthorized: false });
        client.on("secureConnect", () => {
          client.write("CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n");
        });
        client.on("data", () => client.end());
        client.on("close", () => console.log("client:close"));
      });
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, CERT: tlsCert.cert, KEY: tlsCert.key },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Before the fix the server socket never closes: stdout stops at
      // server:finish and the process hangs until the test timeout. client:close
      // and server:close may interleave, so assert presence + server ordering.
      const lines = stdout.split("\n").filter(Boolean);
      expect({
        server: lines.filter(l => l.startsWith("server:")),
        hasClientClose: lines.includes("client:close"),
        stderr,
        exitCode,
      }).toEqual({
        server: ["server:end", "server:finish", "server:close"],
        hasClientClose: true,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.skipIf(isWindows)(
    "AF_UNIX CONNECT sockets whose peer closes first do not spin the loop on EPOLLHUP",
    async () => {
      // An AF_UNIX peer close() on a half-open (CONNECT hand-off) socket is EPOLLHUP, which is level-triggered:
      // the loop must stay idle while the server still holds its side, and each socket ends and closes once.
      using dir = tempDir("connect-unix-hangup", {});
      const result = await bunRun(join(import.meta.dir, "node-http-connect-unix-hangup-fixture.js"), {
        SOCK: join(String(dir), "proxy.sock"),
      });
      const perTarget = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`peer-${i}:443`, { ends: 1, closes: 1 }]),
      );
      expect(result).toEqual({
        stdout: JSON.stringify(perTarget) + "\nidle",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});

/**
 * Test variations using normal HTTP requests and res.socket
 * These tests should run in both Node.js and Bun
 */

describe("HTTP server socket access via normal requests", () => {
  test("should handle socket errors during normal requests", async () => {
    let errorHandled = false;

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      socket.on("error", err => {
        errorHandled = true;
      });

      // Simulate an error condition
      setTimeout(() => {
        socket.destroy(new Error("Simulated error"));
      }, 50);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<boolean>();

    client.on("error", () => {
      resolve(true);
    });

    client.on("close", () => {
      resolve(false);
    });

    await promise;
    expect(errorHandled).toBe(true);
  });

  test.todo("should handle socket pause/resume during request", async () => {
    const largeData = Buffer.alloc(1024 * 1024, "x").toString();
    let pauseCount = 0;
    let resumeCount = 0;

    await using server = http.createServer((req, res) => {
      const socket = res.socket!;

      // Monitor socket state
      const originalPause = socket.pause.bind(socket);
      const originalResume = socket.resume.bind(socket);

      socket.pause = function () {
        pauseCount++;
        return originalPause();
      };

      socket.resume = function () {
        resumeCount++;
        return originalResume();
      };

      // Send large response to trigger backpressure
      res.writeHead(200, { "Content-Type": "text/plain" });

      const sendData = () => {
        let ok = true;
        while (ok) {
          ok = res.write(largeData);
          if (!ok) {
            // Wait for drain event
            res.once("drain", sendData);
            break;
          }
        }
      };

      sendData();

      setTimeout(() => res.end(), 100);
    });

    await once(server.listen(0, "127.0.0.1"), "listening");
    const serverAddress = server.address() as AddressInfo;

    const client = net.connect(serverAddress.port, serverAddress.address, () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });

    const { promise, resolve } = Promise.withResolvers<number>();
    let bytesReceived = 0;

    // Slow reader to trigger backpressure
    client.on("data", chunk => {
      bytesReceived += chunk.length;
      client.pause();
      setTimeout(() => client.resume(), 10);
    });

    client.on("end", () => {
      resolve(bytesReceived);
    });

    const total = await promise;
    expect(total).toBeGreaterThan(0);
  });
});

describe("Should be compatible with node.js", () => {
  // https://github.com/oven-sh/bun/issues/34158
  test("server.close(cb) completes after a CONNECT handoff once both sockets are destroyed", async () => {
    const server = http.createServer();
    let serverSocket: net.Socket;
    server.on("connect", (req, socket) => {
      serverSocket = socket;
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = (server.address() as AddressInfo)!;

    const request = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "example.com:80" });
    request.on("error", () => {});
    request.end();
    const [, clientSocket] = (await once(request, "connect")) as [unknown, net.Socket];

    clientSocket.destroy();
    serverSocket!.destroy();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  });

  test("tests should run on node.js", async () => {
    const process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
  test("tests should run on bun", async () => {
    const process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-connect.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
});

// Windows: after FIN on a CONNECT-tunnel socket, AFD's level-triggered
// UV_DISCONNECT used to re-derive EOF and bounce the poll between 0 and
// WRITABLE forever (pins the poll_cb allow_half_open arm).
test("CONNECT: process exits after the tunnel socket is re-emitted as a connection and the server closes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const http = require("node:http");
       let endCount = 0;
       const server = http.createServer(() => { throw new Error("request listener should not run"); });
       server.on("connect", (req, socket) => {
         socket.on("end", () => endCount++);
         socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
         server.emit("connection", socket);
         server.close();
       });
       server.listen(0, () => {
         http.request({ port: server.address().port, method: "CONNECT" }).end();
       });
       process.on("exit", () => {
         if (endCount !== 1) throw new Error("end fired " + endCount + " times (expected 1)");
         console.log("ok");
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
