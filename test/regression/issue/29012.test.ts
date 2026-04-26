import { test, expect } from "bun:test";
import { isWindows } from "harness";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/29012
//
// `http.request()` with `Connection: Upgrade` must dispatch the `'upgrade'`
// event when the server answers `HTTP/1.1 101 Switching Protocols`, even if
// the caller never calls `req.end()`. This is the pattern dockerode uses for
// hijacked `docker exec` sessions: write the JSON exec config via
// `req.write(...)`, leave the upload half of the HTTP/1.1 connection open,
// and hand the hijacked socket back to the user.
//
// Regression: Bun used to silently drop the 101, never emitting 'upgrade',
// 'response', or 'error', so the promise dockerode awaits never settled.

function spawnUpgradeServer(): Promise<{ socketPath: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const socketPath = path.join(os.tmpdir(), `bun-29012-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    const server = net.createServer(socket => {
      let buffer = Buffer.alloc(0);
      let phase: "headers" | "chunk-size" | "chunk-data" | "upgraded" = "headers";
      let chunkSize = -1;

      const sendUpgrade = () => {
        socket.write(
          "HTTP/1.1 101 UPGRADED\r\n" +
            "Content-Type: application/vnd.docker.raw-stream\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: tcp\r\n" +
            "\r\n",
        );
        // Docker-style framing: [type=1(stdout), 0,0,0, size32be] + "ready\n"
        const payload = Buffer.from("ready\n");
        const hdr = Buffer.alloc(8);
        hdr[0] = 1;
        hdr.writeUInt32BE(payload.length, 4);
        socket.write(Buffer.concat([hdr, payload]));
        // Give the client a moment to read the frame, then close the socket.
        queueMicrotask(() => socket.end());
      };

      socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          if (phase === "headers") {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            const headerBlock = buffer.subarray(0, headerEnd).toString("binary");
            buffer = buffer.subarray(headerEnd + 4);
            if (!/upgrade/i.test(headerBlock)) {
              socket.destroy();
              return;
            }
            phase = "chunk-size";
          } else if (phase === "chunk-size") {
            const lineEnd = buffer.indexOf("\r\n");
            if (lineEnd === -1) return;
            chunkSize = parseInt(buffer.subarray(0, lineEnd).toString("binary"), 16);
            buffer = buffer.subarray(lineEnd + 2);
            if (Number.isNaN(chunkSize)) {
              socket.destroy();
              return;
            }
            phase = chunkSize === 0 ? "upgraded" : "chunk-data";
            if (phase === "upgraded") sendUpgrade();
          } else if (phase === "chunk-data") {
            if (buffer.length < chunkSize + 2) return;
            buffer = buffer.subarray(chunkSize + 2);
            phase = "chunk-size";
            // The hijack protocol expects the server to upgrade as soon as the
            // exec config chunk is parsed. Do that here.
            sendUpgrade();
            phase = "upgraded";
          } else {
            // Post-upgrade: ignore any additional client writes.
            return;
          }
        }
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        close: () => {
          server.close();
          try {
            fs.unlinkSync(socketPath);
          } catch {}
        },
      });
    });
  });
}

test.if(!isWindows)("http.request emits 'upgrade' on 101 without req.end()", async () => {
  const { socketPath, close } = await spawnUpgradeServer();
  try {
    const req = http.request({
      socketPath,
      method: "POST",
      path: "/exec/fake/start",
      headers: {
        "Content-Type": "application/json",
        "Connection": "Upgrade",
        "Upgrade": "tcp",
        "Transfer-Encoding": "chunked",
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<{
      res: http.IncomingMessage;
      socket: import("node:stream").Duplex;
      head: Buffer;
    }>();

    req.on("upgrade", (res, socket, head) => resolve({ res, socket, head }));
    req.on("error", reject);
    req.flushHeaders();
    // NOTE: req.end() is NOT called — this mirrors dockerode's behavior when
    // `openStdin` is true. Bun must still dispatch 'upgrade'.
    req.write('{"Detach":false,"Tty":false}');

    const { res, socket, head } = await promise;

    expect(res.statusCode).toBe(101);
    expect(res.headers.upgrade).toBe("tcp");
    expect(Buffer.isBuffer(head)).toBe(true);

    // Read the Docker-framed "ready\n" payload from the hijacked socket.
    const chunks: Buffer[] = [];
    const ended = new Promise<void>(res2 => socket.once("end", res2));
    socket.on("data", (c: Buffer) => chunks.push(c));
    await ended;

    const body = Buffer.concat(chunks);
    // type=1 (stdout), 0 0 0, size32be=6, payload="ready\n"
    expect(body.slice(0, 8)).toEqual(Buffer.from([1, 0, 0, 0, 0, 0, 0, 6]));
    expect(body.slice(8).toString("utf8")).toBe("ready\n");

    socket.destroy();
    req.destroy();
  } finally {
    close();
  }
});

test.if(!isWindows)("http.request 'upgrade' delivers hijacked socket with writable Duplex", async () => {
  // A lighter-weight variant that just checks the upgrade event shape.
  const { socketPath, close } = await spawnUpgradeServer();
  try {
    const req = http.request({
      socketPath,
      method: "POST",
      path: "/exec/fake/start",
      headers: {
        Connection: "Upgrade",
        Upgrade: "tcp",
        "Transfer-Encoding": "chunked",
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<any>();
    req.on("upgrade", (res, socket, head) => resolve({ res, socket, head }));
    req.on("error", reject);
    req.flushHeaders();
    req.write('{"Detach":false,"Tty":false}');

    const { res, socket, head } = await promise;
    expect(res.statusCode).toBe(101);
    expect(typeof socket.write).toBe("function");
    expect(typeof socket.end).toBe("function");
    expect(typeof socket.on).toBe("function");
    expect(Buffer.isBuffer(head)).toBe(true);

    socket.destroy();
    req.destroy();
  } finally {
    close();
  }
});

// Spawns an echo-upgrade server that sends `HTTP/1.1 101` as soon as it
// sees the request headers (no body required) and echoes raw bytes back
// once upgraded. This mirrors the `ws` / Playwright CDP pattern: GET with
// `Upgrade:` headers, `req.end()` before the 101, and `socket.write(…)`
// inside the `'upgrade'` listener.
function spawnEchoUpgradeServer(): Promise<{ socketPath: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const socketPath = path.join(
      os.tmpdir(),
      `bun-29012-echo-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
    );
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    const server = net.createServer(socket => {
      let headersSeen = false;
      let buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        if (!headersSeen) {
          buffer = Buffer.concat([buffer, chunk]);
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          headersSeen = true;
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: echo\r\n" +
              "Connection: Upgrade\r\n" +
              "\r\n",
          );
          // Anything past the blank line is hijacked-protocol data — echo it.
          const leftover = buffer.subarray(headerEnd + 4);
          if (leftover.length > 0) socket.write(leftover);
        } else {
          // Hijacked phase: echo raw bytes.
          socket.write(chunk);
        }
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        close: () => {
          server.close();
          try {
            fs.unlinkSync(socketPath);
          } catch {}
        },
      });
    });
  });
}

test.if(!isWindows)("http.request 'upgrade' (GET + req.end()): socket.write reaches the server", async () => {
  // Regression for the WebSocket / Playwright CDP / `websocket` npm package
  // pattern (see #18945, #9911, #20547): GET with `Upgrade:` headers and
  // `req.end()` called BEFORE the 101 response. The hijacked socket's
  // writable side must stay live past `req.finished = true`.
  const { socketPath, close } = await spawnEchoUpgradeServer();
  try {
    const req = http.request({
      socketPath,
      method: "GET",
      path: "/",
      headers: {
        Connection: "Upgrade",
        Upgrade: "echo",
      },
    });

    const { promise: upgradePromise, resolve, reject } = Promise.withResolvers<{
      res: http.IncomingMessage;
      socket: import("node:stream").Duplex;
      head: Buffer;
    }>();
    req.on("upgrade", (res, socket, head) => resolve({ res, socket, head }));
    req.on("error", reject);
    // Standard Node WebSocket pattern: end() synchronously BEFORE the 101.
    req.end();

    const { res, socket } = await upgradePromise;
    expect(res.statusCode).toBe(101);
    expect(res.headers.upgrade).toBe("echo");

    const chunks: Buffer[] = [];
    const gotEcho = new Promise<void>(res2 => {
      socket.on("data", c => {
        chunks.push(c);
        if (Buffer.concat(chunks).toString("utf8") === "ping") res2();
      });
    });

    socket.write("ping");
    await gotEcho;
    expect(Buffer.concat(chunks).toString("utf8")).toBe("ping");

    socket.destroy();
  } finally {
    close();
  }
});

// Server that rejects every upgrade attempt with a 400 response so we can
// exercise the "upgrade-headed request gets a non-101 reply" path.
function spawnRejectUpgradeServer(): Promise<{ socketPath: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const socketPath = path.join(
      os.tmpdir(),
      `bun-29012-reject-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
    );
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    const server = net.createServer(socket => {
      let buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.indexOf("\r\n\r\n") === -1) return;
        const body = "nope";
        socket.write(
          "HTTP/1.1 400 Bad Request\r\n" +
            "Content-Length: " +
            body.length +
            "\r\n" +
            "Connection: close\r\n" +
            "\r\n" +
            body,
        );
        queueMicrotask(() => socket.end());
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        close: () => {
          server.close();
          try {
            fs.unlinkSync(socketPath);
          } catch {}
        },
      });
    });
  });
}

test.if(!isWindows)("http.request upgrade-headed + non-101 response: 'response' fires, no leak", async () => {
  // Regression: an upgrade-headed request that the server REJECTS (400,
  // 404, auth failure, etc.) must emit 'response' and release the
  // upgrade-aware body generator. Otherwise the generator parks at
  // `yield await new Promise(...)` forever because `upgradeBodyEnded`
  // is only set from `createUpgradeSocket`, which is only constructed
  // on a 101 response. If that happens the ResumableSink / FetchTasklet
  // never finalize and memory leaks per rejected handshake.
  const { socketPath, close } = await spawnRejectUpgradeServer();
  try {
    const req = http.request({
      socketPath,
      method: "GET",
      path: "/",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    });

    const { promise: responsePromise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    req.on("response", r => resolve(r));
    req.on("upgrade", () => reject(new Error("unexpected 'upgrade' event")));
    req.on("error", reject);
    req.end();

    const res = await responsePromise;
    expect(res.statusCode).toBe(400);

    const body = await new Promise<string>((resolveBody, rejectBody) => {
      const bufs: Buffer[] = [];
      res.on("data", c => bufs.push(c));
      res.on("end", () => resolveBody(Buffer.concat(bufs).toString("utf8")));
      res.on("error", rejectBody);
    });
    expect(body).toBe("nope");

    // If the body generator leaks, `req.destroy()` still returns quickly
    // but the FetchTasklet stays alive. Assert the request is now
    // considered finished from the caller's perspective.
    await new Promise<void>(res2 => setImmediate(res2));
    req.destroy();
  } finally {
    close();
  }
});

test.if(!isWindows)(
  "http.request upgrade + req.end(body) without flushHeaders: one nodeHttpClient call",
  async () => {
    // Regression: `customBody = undefined` used to run AFTER the isDuplex
    // computation, so `req.end(body)` on an upgrade request left
    // `keepOpen = false`, the `.finally()` reset `fetching = false`, and
    // the first post-upgrade `socket.write()` fired a SECOND nodeHttpClient
    // request to the same URL.
    //
    // We catch this with a server that keeps a connection count: a second
    // connection would bump it above 1.
    const { promise: serverReady, resolve: gotPath } = Promise.withResolvers<string>();
    const socketPath = path.join(
      os.tmpdir(),
      `bun-29012-once-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
    );
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    let connectionCount = 0;
    // If the bug recurred, a second `nodeHttpClient` request would fire
    // synchronously from `socket.write('post')` and the kernel would
    // deliver a second `connection` event. We race that against the echo
    // round-trip so the assertion fails immediately (instead of waiting
    // for an arbitrary timeout that would be flaky on loaded CI).
    const { promise: secondConn, reject: secondConnFired } = Promise.withResolvers<never>();
    secondConn.catch(() => {}); // don't leave this unhandled if it never fires
    const server = net.createServer(socket => {
      connectionCount++;
      if (connectionCount > 1) {
        secondConnFired(new Error("regression: a second nodeHttpClient request was fired"));
        socket.destroy();
        return;
      }
      let headersSeen = false;
      let buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        if (!headersSeen) {
          buffer = Buffer.concat([buffer, chunk]);
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          headersSeen = true;
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: echo\r\n" +
              "Connection: Upgrade\r\n" +
              "\r\n",
          );
        } else {
          socket.write(chunk); // echo
        }
      });
    });
    server.listen(socketPath, () => gotPath(socketPath));
    await serverReady;

    try {
      const req = http.request({
        socketPath,
        method: "POST",
        path: "/",
        headers: {
          Connection: "Upgrade",
          Upgrade: "echo",
          "Content-Length": "4",
        },
      });

      const { promise, resolve, reject } = Promise.withResolvers<any>();
      req.on("upgrade", (_res, socket) => resolve(socket));
      req.on("error", reject);
      // Single req.end(body) path — no flushHeaders, no separate write.
      req.end("init");

      const socket = await promise;
      const chunks: Buffer[] = [];
      const got = new Promise<void>(res2 => {
        socket.on("data", (c: Buffer) => {
          chunks.push(c);
          if (Buffer.concat(chunks).toString("utf8") === "post") res2();
        });
      });
      socket.write("post");
      // `await got` implicitly serializes past the synchronous re-entry
      // into `startFetch()`, and `secondConn` fails fast if the 2nd
      // request was actually issued to the kernel. No timer needed.
      await Promise.race([got, secondConn]);
      expect(connectionCount).toBe(1);

      socket.destroy();
    } finally {
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {}
    }
  },
);
