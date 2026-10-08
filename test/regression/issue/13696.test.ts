// https://github.com/oven-sh/bun/issues/13696
// node:http ClientRequest: a single req.write() without req.end() never sent
// the request, and in duplex mode 'response' was held back until req.end().
// docker-modem relies on write-once-keep-open for container.exec stdin, which
// is why testcontainers' default HostPortWaitStrategy hung until timeout.

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";

// Resolves with everything the socket has received once `marker` appears in it.
function readUntil(sock: net.Socket, marker: string): Promise<string> {
  return new Promise(resolve => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("latin1");
      if (!buf.includes(marker)) return;
      sock.off("data", onData);
      resolve(buf);
    };
    sock.on("data", onData);
  });
}

// Simulates docker-modem's chunked POST with an open request body, against a
// raw TCP server that responds before the request is finished. The server
// writes the next body chunk only after the client has observed the previous
// one, so every chunk is proven to stream while the request body is open.
for (const socketMode of ["tcp", "unix"] as const) {
  test.concurrent(
    `http.request delivers response while request body stream is still open (${socketMode})`,
    async () => {
      using dir = tempDir("issue-13696", {});
      const socketPath = socketMode === "unix" ? join(String(dir), "docker.sock") : undefined;
      const payload = JSON.stringify({ Detach: false, Tty: true });
      const chunkedFrame = `${payload.length.toString(16)}\r\n${payload}\r\n`;

      const events: string[] = [];
      let request = "";
      let chunkReceived = Promise.withResolvers<void>();

      await using server = net.createServer(async sock => {
        // req.destroy() at the end of the test may reset the connection.
        sock.on("error", () => {});
        // The single write() must dispatch the headers and the body chunk
        // without req.end().
        request = await readUntil(sock, chunkedFrame);
        events.push("request-seen");

        // Docker's exec response has no Content-Length and no chunked encoding;
        // it just writes raw frames until the connection closes.
        sock.write("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n");
        for (let i = 0; i < 3; i++) {
          chunkReceived = Promise.withResolvers<void>();
          sock.write(`chunk-${i}\n`);
          await chunkReceived.promise;
        }
        sock.end();
      });
      if (socketPath) {
        server.listen(socketPath);
      } else {
        server.listen(0, "127.0.0.1");
      }
      await once(server, "listening");

      const requestOpts = socketPath
        ? { socketPath, path: "/exec/abc/start" }
        : { host: "127.0.0.1", port: (server.address() as net.AddressInfo).port, path: "/exec/abc/start" };

      // docker-modem passes an empty callback here and attaches 'response'
      // separately via req.on('response', ...).
      const req = http.request(
        {
          ...requestOpts,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        },
        function () {},
      );
      try {
        const responseEnd = new Promise<void>((resolve, reject) => {
          req.on("error", reject);
          req.on("response", res => {
            events.push(`response-status:${res.statusCode}`);
            res.setEncoding("utf8");
            // Only a complete line counts as a received chunk: a data event
            // can carry part of a line.
            let pending = "";
            res.on("data", (chunk: string) => {
              pending += chunk;
              const lines = pending.split("\n");
              pending = lines.pop()!;
              for (const line of lines) {
                events.push(`recv:${line}`);
                chunkReceived.resolve();
              }
            });
            res.on("end", () => {
              events.push("response-end");
              resolve();
            });
          });
        });

        // Single write, no req.end(). docker-modem does exactly this for
        // openStdin: true.
        req.write(payload);
        await responseEnd;

        // The whole response arrived while the request body stream is still open.
        expect({ events, writableEnded: req.writableEnded }).toEqual({
          events: [
            "request-seen",
            "response-status:200",
            "recv:chunk-0",
            "recv:chunk-1",
            "recv:chunk-2",
            "response-end",
          ],
          writableEnded: false,
        });
        expect(request).toStartWith("POST /exec/abc/start HTTP/1.1\r\n");
        expect(request.toLowerCase()).toContain("transfer-encoding: chunked\r\n");
        expect(request).toEndWith(chunkedFrame);
      } finally {
        req.destroy();
      }
    },
  );
}

// Also cover the case where flushHeaders() is called explicitly (which already
// started the fetch in duplex mode) but the response was still being held back
// until req.end().
test.concurrent("http.request emits 'response' in duplex mode after flushHeaders() without end()", async () => {
  let request = "";
  await using server = net.createServer(async sock => {
    sock.on("error", () => {});
    request = await readUntil(sock, "\r\n\r\n");
    sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nhello");
    sock.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  const req = http.request({
    host: "127.0.0.1",
    port,
    path: "/",
    method: "POST",
    headers: { "Transfer-Encoding": "chunked" },
  });
  try {
    const body = new Promise<string>((resolve, reject) => {
      req.on("error", reject);
      req.on("response", res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve(body));
      });
    });
    req.flushHeaders();
    req.write("payload");

    expect({ body: await body, writableEnded: req.writableEnded }).toEqual({ body: "hello", writableEnded: false });
    expect(request).toStartWith("POST / HTTP/1.1\r\n");
  } finally {
    req.destroy();
  }
});
