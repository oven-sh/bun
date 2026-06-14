import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import tls from "node:tls";

// Several tests spawn a cold bun process (the upgrade-teardown / drain
// fixtures) which is slow under CI ASAN. Raise the default timeout for the
// whole file rather than per-test overrides (test/CLAUDE.md: no per-test
// timeouts).
setDefaultTimeout(30_000);

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

  test.skipIf(isWindows)("https upgrade over unix socket reports encrypted", async () => {
    using dir = tempDir("http-upgrade-unix-tls", {});
    const sockPath = path.join(String(dir), "upgrade-tls.sock");

    const server = tls.createServer({ cert: tlsCert.cert, key: tlsCert.key }, conn => {
      conn.on("error", () => {});
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: tcp\r\n" + "Connection: Upgrade\r\n" + "\r\n");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(sockPath, resolve);
    });

    try {
      const req = https.request({
        socketPath: sockPath,
        rejectUnauthorized: false,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      req.on("error", () => {});
      req.end();

      const [, socket] = await once(req, "upgrade");
      // TLS was used even though the address is a unix socket (socketURL is
      // undefined) — encrypted must still be true, derived from response.url.
      expect(socket.encrypted).toBe(true);
      socket.destroy();
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

  test("pre-101 write that does not return false emits no spurious 'drain'", async () => {
    const serverRead = Promise.withResolvers<void>();
    const server = net.createServer(conn => {
      let buf = Buffer.alloc(0);
      let sent101 = false;
      let bodyBytes = 0;
      conn.on("error", () => {});
      conn.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        if (!sent101) {
          const i = buf.indexOf("\r\n\r\n");
          if (i === -1) return;
          sent101 = true;
          // headers may arrive in their own 'data' event, so body bytes here
          // can legitimately be 0 — use a boolean sentinel, not the count.
          bodyBytes = buf.length - (i + 4);
          conn.write(
            "HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n",
          );
          if (bodyBytes >= 70 * 1024) serverRead.resolve();
          return;
        }
        // Drain the pre-101 body so the generator empties the channel.
        bodyBytes += chunk.length;
        if (bodyBytes >= 70 * 1024) serverRead.resolve();
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
      // Write 70 KiB before the 101: it crosses the channel's 64 KiB
      // high-water-mark (so the body generator's drain hook fires) but stays
      // under the 1 MiB fake-backpressure threshold, so write() returns true.
      // Node emits 'drain' only after write() returned false, so none is owed —
      // the generator-driven drain must be suppressed until after the upgrade.
      let drained = false;
      req.on("drain", () => {
        drained = true;
      });
      expect(req.write(Buffer.alloc(70 * 1024, 0x61))).toBe(true);
      req.end();

      const [, socket] = await once(req, "upgrade");
      // Wait until the server has received the full body (generator drained,
      // so any spurious ondrain would have fired) plus a tick.
      await serverRead.promise;
      await new Promise<void>(resolve => process.nextTick(resolve));
      expect(drained).toBe(false);
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

  test("req.write() after upgrade doesn't permanently saturate backpressure", async () => {
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
      // Write >1 MiB post-upgrade. The previous bug left the fake-backpressure
      // counter stuck at 1 MiB so every subsequent req.write() permanently
      // returned false with no drain. With the server draining, backpressure
      // must instead be relievable: after the burst, a write eventually
      // succeeds again (proving the channel drains and isn't saturated).
      const chunk = Buffer.alloc(4096, 0x61);
      for (let i = 0; i < 300; i++) {
        req.write(chunk);
      }
      // Wait until a write returns true again — if backpressure were stuck,
      // this would loop forever and the test would time out.
      while (!req.write(chunk)) {
        await once(req, "drain");
      }
      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("req.write() after upgrade applies backpressure and emits 'drain'", async () => {
    const serverConn = Promise.withResolvers<net.Socket>();
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        // Do NOT read the upgraded body yet — let the client's write queue
        // fill so req.write() reports backpressure. pause() so the kernel
        // socket buffer backs up into the fetch body generator.
        conn.pause();
        serverConn.resolve(conn);
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
      const conn = await serverConn.promise;

      // Write until req.write() signals backpressure (returns false). With the
      // server not reading, the channel's queued bytes cross the 64 KiB
      // high-water-mark and write() must return false instead of always-true.
      const chunk = Buffer.alloc(16 * 1024, 0x61);
      let sawBackpressure = false;
      for (let i = 0; i < 256 && !sawBackpressure; i++) {
        if (!req.write(chunk)) sawBackpressure = true;
      }
      expect(sawBackpressure).toBe(true);

      // Now let the server drain the body; the channel empties below the
      // high-water-mark and the ClientRequest must emit 'drain'.
      const drained = once(req, "drain");
      conn.on("data", () => {});
      conn.resume();
      await drained;

      socket.destroy();
    } finally {
      server.close();
    }
  });

  test("first post-upgrade req.write() over the high-water-mark returns false", async () => {
    const serverConn = Promise.withResolvers<net.Socket>();
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        conn.pause(); // don't read the body — keep the channel full
        serverConn.resolve(conn);
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      // flushHeaders() (no pre-101 body) leaves kBodyChunks uninitialized, so
      // the very first post-upgrade write hits the first-write branch. A single
      // write larger than the 64 KiB high-water-mark must still return false —
      // backpressure has to engage on write #1, not only on write #2.
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      const conn = await serverConn.promise;

      const first = req.write(Buffer.alloc(200 * 1024, 0x61));
      expect(first).toBe(false);

      conn.on("data", () => {});
      conn.resume();
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

  test("aborting options.signal after upgrade delivers AbortError with reason", async () => {
    const server = net.createServer(conn => {
      conn.once("data", () => {
        conn.write("HTTP/1.1 101 Switching Protocols\r\n" + "Upgrade: custom\r\n" + "Connection: Upgrade\r\n" + "\r\n");
        // Don't drain — keep the channel backpressured so the write callback
        // is still pending when we abort.
      });
    });
    const addr = (await listen(server)) as AddressInfo;

    try {
      const ac = new AbortController();
      const req = http.request({
        host: "127.0.0.1",
        port: addr.port,
        method: "POST",
        signal: ac.signal,
        headers: { Connection: "Upgrade", Upgrade: "custom" },
      });
      req.on("error", () => {});
      req.flushHeaders();
      const [, socket] = await once(req, "upgrade");
      socket.on("error", () => {});

      const big = Buffer.alloc(96 * 1024, 0x61);
      const { promise, resolve } = Promise.withResolvers<Error | undefined>();
      socket.write(big); // past the 64 KiB high-water-mark — callback pends
      socket.write(big, err => resolve(err as Error | undefined));

      // Aborting the user's signal must destroy with an AbortError carrying
      // the reason (Node's addAbortSignal), not a generic ERR_STREAM_DESTROYED.
      const reason = new Error("user reason");
      ac.abort(reason);
      const cbErr = await promise;
      expect((cbErr as any)?.code).toBe("ABORT_ERR");
      expect((cbErr as any)?.cause).toBe(reason);
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

  test("clean socket.destroy() after upgrade leaves req.aborted false", async () => {
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
      // Destroying the upgraded socket tears down the underlying fetch, but a
      // clean destroy (no error) must not flip req.aborted — Node leaves it
      // false after a successful upgrade. Wait for 'close' so _destroy (and
      // the abort it performs) has fully run before reading req.aborted.
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
      expect(req.aborted).toBe(false);
    } finally {
      server.close();
    }
  });

  // socket.destroy() must tear down the underlying fetch/TCP connection, not
  // just cancel the response-body reader — otherwise the native request keeps
  // an event-loop ref and the process never exits. This is what ws/playwright
  // hit at teardown. Spawn a child that upgrades, destroys the socket, closes
  // the server, and does nothing else: it must exit on its own.
  test("socket.destroy() after upgrade lets the process exit", async () => {
    using dir = tempDir("http-upgrade-exit", {
      "fixture.mjs": `
        import http from "node:http";
        import net from "node:net";

        const server = net.createServer(conn => {
          let buf = Buffer.alloc(0);
          let upgraded = false;
          // socket.destroy() RSTs the peer; swallow the expected post-teardown error.
          conn.on("error", () => {});
          conn.on("data", chunk => {
            if (upgraded) return;
            buf = Buffer.concat([buf, chunk]);
            if (buf.indexOf("\\r\\n\\r\\n") === -1) return;
            upgraded = true;
            conn.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n");
          });
        }).listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));

        const req = http.request({
          host: "127.0.0.1",
          port: server.address().port,
          headers: { Connection: "Upgrade", Upgrade: "websocket" },
        });
        req.on("upgrade", (res, socket) => {
          console.log("upgraded");
          socket.destroy();
          server.close();
          // Intentionally nothing else. If the upgrade's fetch isn't aborted,
          // the event loop stays ref'd here and the process hangs forever.
        });
        req.end();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("upgraded\n");
    expect(exitCode).toBe(0);
  });

  // Aborting the options.signal after a 101 must tear down the upgraded
  // connection (req.destroy() → socket.destroy()), even though the
  // AbortController is detached from the request post-upgrade. Otherwise the
  // fetch keeps an event-loop ref and the process hangs. Spawn a child that
  // upgrades, aborts the signal, and does nothing else: it must exit on its own.
  test("aborting options.signal after upgrade lets the process exit", async () => {
    using dir = tempDir("http-upgrade-signal-abort", {
      "fixture.mjs": `
        import http from "node:http";
        import net from "node:net";

        const server = net.createServer(conn => {
          let buf = Buffer.alloc(0);
          let upgraded = false;
          conn.on("error", () => {});
          conn.on("data", chunk => {
            if (upgraded) return;
            buf = Buffer.concat([buf, chunk]);
            if (buf.indexOf("\\r\\n\\r\\n") === -1) return;
            upgraded = true;
            conn.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n");
          });
        }).listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));

        const ac = new AbortController();
        const req = http.request({
          host: "127.0.0.1",
          port: server.address().port,
          signal: ac.signal,
          headers: { Connection: "Upgrade", Upgrade: "websocket" },
        });
        req.on("error", () => {});
        req.on("upgrade", (res, socket) => {
          console.log("upgraded");
          socket.on("error", () => {});
          // Tear down ONLY via the user's signal — not socket.destroy(). If the
          // signal bridge is broken post-upgrade, the fetch ref keeps the loop
          // alive and this hangs.
          ac.abort();
          server.close();
        });
        req.end();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0 || stdout !== "upgraded\n") console.error(stderr);
    expect(stdout).toBe("upgraded\n");
    expect(exitCode).toBe(0);
  });

  // A throwing 'drain' listener must not sever the upgraded connection. The
  // emit is deferred via nextTick so the throw surfaces as an uncaught
  // exception rather than propagating out of the fetch body generator and
  // erroring the write side. Spawn a child so the uncaught exception doesn't
  // fail the test runner; assert the socket still round-trips afterward.
  test("throwing 'drain' listener does not break the upgraded write side", async () => {
    using dir = tempDir("http-upgrade-drain-throw", {
      "fixture.mjs": `
        import http from "node:http";
        import net from "node:net";

        const server = net.createServer(conn => {
          let upgraded = false;
          let head = Buffer.alloc(0);
          let body = Buffer.alloc(0);
          // socket.destroy() RSTs the peer; swallow the expected post-teardown error.
          conn.on("error", () => {});
          conn.on("data", chunk => {
            if (!upgraded) {
              head = Buffer.concat([head, chunk]);
              if (head.indexOf("\\r\\n\\r\\n") === -1) return;
              upgraded = true;
              conn.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: custom\\r\\nConnection: Upgrade\\r\\n\\r\\n");
              // Pause so the client's writes back up and trigger backpressure.
              conn.pause();
              return;
            }
            // Accumulate post-upgrade bytes and echo the PING sentinel only
            // once it arrives — the filler bytes before it are discarded, so
            // the test doesn't depend on TCP chunk boundaries.
            body = Buffer.concat([body, chunk]);
            if (body.includes("PING")) conn.write("PONG");
          });
          server.emit("conn", conn);
        }).listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));
        const connPromise = new Promise(r => server.once("conn", r));

        let resolveUncaught;
        const uncaughtPromise = new Promise(r => { resolveUncaught = r; });
        process.on("uncaughtException", err => {
          if (err && err.message === "drain-oops") { resolveUncaught(); return; }
          console.error("unexpected: " + (err && err.message));
          process.exit(3);
        });

        const req = http.request({
          method: "POST",
          host: "127.0.0.1",
          port: server.address().port,
          headers: { Connection: "Upgrade", Upgrade: "custom" },
        });
        req.on("upgrade", async (res, socket) => {
          const conn = await connPromise;
          // Throwing drain listener — must not corrupt the write stream.
          req.on("drain", () => { throw new Error("drain-oops"); });

          const chunk = Buffer.alloc(16 * 1024, 0x61);
          while (req.write(chunk)) {}      // write until backpressure engages
          conn.resume();                    // now let the server drain
          // Wait for the throwing listener to fire as an uncaught exception.
          await uncaughtPromise;

          // The connection must still be alive: a PING written to the socket
          // reaches the server (after the filler drains) and PONG comes back.
          const echoed = new Promise(r => {
            let reply = Buffer.alloc(0);
            socket.on("data", d => {
              reply = Buffer.concat([reply, d]);
              if (reply.includes("PONG")) r();
            });
          });
          socket.write("PING");
          await echoed;
          console.log("survived");
          socket.destroy();
          server.close();
        });
        req.end();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0 || !stdout.includes("survived")) console.error(stderr);
    expect(stdout.trim()).toBe("survived");
    expect(exitCode).toBe(0);
  });

  // When pre-101 req.write() tripped fake-backpressure, the 101 branch emits
  // 'drain' right before 'upgrade' in the same tick. A throwing 'drain'
  // listener must NOT prevent 'upgrade' from firing — otherwise the socket is
  // orphaned and never delivered. Spawn a child (uncaught exception expected)
  // and assert 'upgrade' still fired.
  test("throwing pre-101 'drain' listener still delivers 'upgrade'", async () => {
    using dir = tempDir("http-upgrade-drain-upgrade", {
      "fixture.mjs": `
        import http from "node:http";
        import net from "node:net";

        const server = net.createServer(conn => {
          let buf = Buffer.alloc(0);
          let upgraded = false;
          // socket.destroy() aborts the fetch mid-stream, so the peer may RST
          // while the 1.2 MiB body is still in flight — swallow the expected
          // EPIPE/ECONNRESET instead of letting it become an uncaughtException.
          conn.on("error", () => {});
          conn.on("data", chunk => {
            if (upgraded) return;
            buf = Buffer.concat([buf, chunk]);
            if (buf.indexOf("\\r\\n\\r\\n") === -1) return;
            upgraded = true;
            conn.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: custom\\r\\nConnection: Upgrade\\r\\n\\r\\n");
          });
        }).listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));

        process.on("uncaughtException", err => {
          if (err && err.message === "drain-oops") return; // expected
          console.error("unexpected: " + (err && err.message));
          process.exit(3);
        });

        const req = http.request({
          method: "POST",
          host: "127.0.0.1",
          port: server.address().port,
          headers: { Connection: "Upgrade", Upgrade: "custom" },
        });
        // Write >1 MiB before the 101 so the fake-backpressure counter trips
        // and the 101 branch will emit 'drain' before 'upgrade'.
        req.write(Buffer.alloc(600 * 1024, 0x61));
        req.write(Buffer.alloc(600 * 1024, 0x62));
        req.on("drain", () => { throw new Error("drain-oops"); });
        req.on("upgrade", (res, socket) => {
          // Reaching here proves the throwing 'drain' listener did not
          // short-circuit the 'upgrade' emit.
          console.log("upgraded");
          socket.destroy();
          server.close();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0 || !stdout.includes("upgraded")) console.error(stderr);
    expect(stdout.trim()).toBe("upgraded");
    expect(exitCode).toBe(0);
  });
});
