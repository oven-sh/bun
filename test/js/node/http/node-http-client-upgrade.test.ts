import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";

async function listen(server: net.Server | http.Server, arg?: any): Promise<AddressInfo | string> {
  const { promise, resolve, reject } = Promise.withResolvers<AddressInfo | string>();
  server.once("error", reject);
  if (arg !== undefined) {
    server.listen(arg, () => resolve(server.address() as AddressInfo | string));
  } else {
    server.listen(0, "127.0.0.1", () => resolve(server.address() as AddressInfo));
  }
  return promise;
}

describe("http.ClientRequest 'upgrade' event", () => {
  test("emits 'upgrade' with a usable Duplex socket", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
        conn.on("data", chunk => conn.write(chunk));
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();

      const [res, socket, head] = await once(req, "upgrade");
      expect(res.statusCode).toBe(101);
      expect(res.headers.upgrade).toBe("websocket");
      expect(res.headers.connection).toBe("Upgrade");
      expect(Buffer.isBuffer(head)).toBe(true);
      expect(head.length).toBe(0);

      const echoed = once(socket, "data");
      socket.write("hello upgrade");
      const [chunk] = await echoed;
      expect(chunk.toString()).toBe("hello upgrade");

      const ended = once(socket, "end");
      socket.end();
      server.close();
      await ended;
    } finally {
      server.close();
    }
  });

  test.skipIf(isWindows)("upgrade over unix socket", async () => {
    using dir = tempDir("http-upgrade-unix", {});
    const sockPath = path.join(String(dir), "upgrade.sock");

    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: tcp\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        conn.on("data", chunk => conn.write(chunk));
      });
    });
    await listen(server, sockPath);

    try {
      const req = http.request({
        socketPath: sockPath,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      req.end();

      const [res, socket] = await once(req, "upgrade");
      expect(res.statusCode).toBe(101);

      const echoed = once(socket, "data");
      socket.write("unix-hello");
      const [chunk] = await echoed;
      expect(chunk.toString()).toBe("unix-hello");

      socket.end();
    } finally {
      server.close();
    }
  });

  test("non-101 response to Upgrade request emits 'response'", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.end(
          "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nnot upgrading",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      req.on("upgrade", () => {
        throw new Error("should not emit upgrade");
      });
      req.end();

      const [res] = await once(req, "response");
      expect(res.statusCode).toBe(200);
      let body = "";
      for await (const chunk of res) body += chunk.toString();
      expect(body).toBe("not upgrading");
    } finally {
      server.close();
    }
  });

  test("non-101 response via flushHeaders emits 'response'", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.end(
          "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 3\r\n\r\nnah",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      // Use flushHeaders() instead of end() — this is the path that
      // previously left onEnd as a no-op so handleResponse never fired.
      req.flushHeaders();

      const [res] = await once(req, "response");
      expect(res.statusCode).toBe(400);
      let body = "";
      for await (const chunk of res) body += chunk.toString();
      expect(body).toBe("nah");
    } finally {
      server.close();
    }
  });

  test("non-upgrade requests can reuse keep-alive connections", async () => {
    let connections = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.on("connection", () => {
      connections++;
    });
    const addr = (await listen(server)) as AddressInfo;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      for (let i = 0; i < 2; i++) {
        const req = http.request({ host: "127.0.0.1", port: addr.port, agent });
        req.end();
        const [res] = await once(req, "response");
        let body = "";
        for await (const chunk of res) body += chunk.toString();
        expect(body).toBe("ok");
      }
      expect(connections).toBe(1);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("socket exposes address()/remoteAddress/remotePort and replaces req.socket/res.socket", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();

      const [res, socket] = await once(req, "upgrade");
      // socket.address() must exist (returns local endpoint — empty here).
      const info = socket.address();
      expect(info).toBeDefined();
      // remote* reflect the server we connected to.
      expect(socket.remoteAddress).toBe("127.0.0.1");
      expect(socket.remotePort).toBe(addr.port);
      expect(socket.remoteFamily).toBe("IPv4");
      // req.socket / res.socket now point at the upgraded socket
      expect(req.socket).toBe(socket);
      expect(res.socket).toBe(socket);

      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("emits 'close' on the ClientRequest after upgrade", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();

      const closed = once(req, "close");
      const [, socket] = await once(req, "upgrade");
      await closed;
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("multiple req.write() calls before 101 are all delivered", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const server = net.createServer(conn => {
      let buf = "";
      let upgraded = false;
      conn.on("data", chunk => {
        buf += chunk.toString();
        if (!upgraded && buf.includes("\r\n\r\n")) {
          upgraded = true;
          const headerEnd = buf.indexOf("\r\n\r\n") + 4;
          const afterHeaders = buf.slice(headerEnd);
          conn.write(
            "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n",
          );
          // Read 9 bytes of body ("one"+"two"+"3!!")
          let body = afterHeaders;
          const check = () => {
            if (body.length >= 9) resolve(body.slice(0, 9));
          };
          check();
          conn.on("data", more => {
            body += more.toString();
            check();
          });
        }
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom", "Content-Length": "9" },
      });
      req.write("one");
      req.write("two");
      // Third write after startFetch fires — previous bug dropped this silently.
      req.write("3!!");
      req.end();

      const [, socket] = await once(req, "upgrade");
      expect(await promise).toBe("onetwo3!!");
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("socket.setTimeout fires a real timer", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();
      const [, socket] = await once(req, "upgrade");

      const timedOut = once(socket, "timeout");
      socket.setTimeout(50);
      expect(socket.timeout).toBe(50);
      await timedOut;
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("unhandled 101 upgrade destroys the socket", async () => {
    const { promise: serverConnClosed, resolve: resolveServerClosed } = Promise.withResolvers<void>();
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
      conn.once("close", () => resolveServerClosed());
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();
      // No 'upgrade' listener — client socket must be destroyed, which tears
      // down the TCP connection on the server side.
      await serverConnClosed;
    } finally {
      server.close();
    }
  });

  test("req.write() after upgrade does not open a second connection", async () => {
    let connectionCount = 0;
    const { promise: gotBytes, resolve: resolveGotBytes } = Promise.withResolvers<void>();
    const server = net.createServer(conn => {
      connectionCount++;
      let buf = "";
      let upgraded = false;
      conn.on("data", chunk => {
        buf += chunk.toString();
        if (!upgraded && buf.includes("\r\n\r\n")) {
          upgraded = true;
          const after = buf.slice(buf.indexOf("\r\n\r\n") + 4);
          conn.write(
            "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n",
          );
          let body = after;
          const check = () => {
            if (body.length >= 3) resolveGotBytes();
          };
          check();
          conn.on("data", more => {
            body += more.toString();
            check();
          });
        }
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      // After 101, req.write() must not re-enter startFetch() and open a
      // second TCP connection with a duplicate upgrade handshake.
      req.write("x");
      req.write("y");
      req.write("z");
      // Await the server actually receiving the bytes instead of sleeping.
      await gotBytes;
      expect(connectionCount).toBe(1);
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("req.write() after upgrade doesn't saturate fake-backpressure", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        conn.on("data", () => {}); // drain
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      // Write >1 MiB post-upgrade. Without clearing kBodyChunks on 101,
      // the fake-backpressure counter saturates at 1 MiB and every
      // subsequent req.write() permanently returns false with no drain.
      const chunk = Buffer.alloc(4096, 0x61);
      let lastResult = true;
      for (let i = 0; i < 300; i++) {
        lastResult = req.write(chunk);
      }
      expect(lastResult).toBe(true);
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("server-initiated half-close auto-ends the writable side", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
        // Immediately half-close the write side from the server.
        conn.end();
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();
      const [, socket] = await once(req, "upgrade");
      // Drain the readable side so the 'end' event fires on EOF.
      socket.resume();
      // Server EOF must propagate to close the writable side too
      // (allowHalfOpen: false on the Duplex).
      await once(socket, "close");
    } finally {
      server.close();
    }
  });

  test("pending socket.write callback receives destroy error", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        // Don't drain — keep the channel backpressured.
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      socket.on("error", () => {});

      const big = Buffer.alloc(96 * 1024, 0x61);
      const { promise, resolve } = Promise.withResolvers<Error | undefined>();
      socket.write(big); // pushes past 64KiB highWaterMark
      socket.write(big, err => resolve(err as Error | undefined));

      socket.destroy(new Error("boom"));
      const cbErr = await promise;
      expect(cbErr?.message).toBe("boom");
    } finally {
      server.close();
    }
  });

  test("req.write() after socket.end() reports write-after-end error", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        conn.on("data", () => {});
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      socket.on("error", () => {});
      // End the upgraded socket's writable side, then write more data via
      // req.write(). It must fail with ERR_STREAM_WRITE_AFTER_END instead
      // of silently dropping the data.
      socket.end();
      const { promise, resolve } = Promise.withResolvers<Error | undefined>();
      const ok = req.write("late", err => resolve(err as Error | undefined));
      expect(ok).toBe(false);
      const err = await promise;
      expect(err).toBeDefined();
      expect((err as any)?.code).toBe("ERR_STREAM_WRITE_AFTER_END");
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("res._dump() after upgrade does not throw ReadableStream locked", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: websocket\r\n" + "Connection: Upgrade\r\n" + "\r\n",
        );
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      req.end();

      const [res, socket] = await once(req, "upgrade");
      // IncomingMessage body and UpgradedSocket share response.body; the
      // _read code path must not attempt to re-acquire the locked stream.
      // Calling _dump() forces resume() -> _read() on the IncomingMessage.
      expect(res.complete).toBe(true);
      res._dump();
      socket.destroy();
    } finally {
      server.close();
    }
  });
});
