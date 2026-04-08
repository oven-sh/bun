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
