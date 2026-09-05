/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";
import nodeTls from "node:tls";

const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
  key: readFileSync(path.join(keysDir, "agent1-key.pem")),
};

// Large enough that part of a single res.write() is still queued in the
// native send buffer when the handler returns, on every platform's loopback.
const BODY = 8 * 1024 * 1024;
const payload = Buffer.alloc(BODY, "a");

// Streaming decoder for a `Transfer-Encoding: chunked` body. It counts the
// payload bytes, records the terminating zero-length chunk, and counts any
// bytes that arrive after it. The 2 GiB tests read through this over a raw
// socket because a fetch() body reader is several times slower than that on a
// debug build, and only the server side is under test here.
class ChunkedBodyCounter {
  bytes = 0;
  terminated = false;
  trailing = 0;
  private pending = 0;
  private line = "";
  private state: "size" | "data" | "crlf" | "end" = "size";

  feed(buf: Buffer) {
    let i = 0;
    while (i < buf.length) {
      if (this.terminated) {
        this.trailing += buf.length - i;
        return;
      }
      if (this.state === "data") {
        const n = Math.min(this.pending, buf.length - i);
        this.pending -= n;
        this.bytes += n;
        i += n;
        if (this.pending === 0) this.state = "crlf";
        continue;
      }
      this.line += String.fromCharCode(buf[i++]);
      if (!this.line.endsWith("\r\n")) continue;
      const line = this.line.slice(0, -2);
      this.line = "";
      if (this.state === "crlf") {
        if (line !== "") throw new Error(`expected CRLF after chunk data, got ${JSON.stringify(line)}`);
        this.state = "size";
      } else if (this.state === "end") {
        this.terminated = true;
      } else {
        const size = parseInt(line, 16);
        if (!Number.isInteger(size) || size < 0) throw new Error(`bad chunk size line ${JSON.stringify(line)}`);
        if (size === 0) this.state = "end";
        else {
          this.pending = size;
          this.state = "data";
        }
      }
    }
  }
}

// Sends `request` on an already-connected raw socket (half-closing right
// after it when `halfClose` is set) and collects the response until the server
// closes the connection: the status line, the body byte count (chunk framing
// decoded when the response is chunked), whether the body was complete (the
// chunked terminator arrived with nothing after it, or the body matched
// Content-Length), and whether a FIN ('end') arrived rather than a reset.
async function readRawResponse(
  socket: net.Socket,
  request: string,
  halfClose = false,
): Promise<{ status: string; body: number; complete: boolean; ended: boolean }> {
  let head = "";
  let gotHead = false;
  let ended = false;
  let chunked: ChunkedBodyCounter | null = null;
  let declared = -1;
  let body = 0;
  const feed = (buf: Buffer) => {
    if (chunked) chunked.feed(buf);
    else body += buf.length;
  };
  socket.on("data", chunk => {
    if (gotHead) return feed(chunk);
    head += chunk.toString("latin1");
    const i = head.indexOf("\r\n\r\n");
    if (i < 0) return;
    gotHead = true;
    const headers = head.slice(0, i).toLowerCase();
    if (/^transfer-encoding:\s*chunked/m.test(headers)) chunked = new ChunkedBodyCounter();
    else declared = Number(/^content-length:\s*(\d+)/m.exec(headers)?.[1] ?? -1);
    feed(Buffer.from(head.slice(i + 4), "latin1"));
  });
  socket.on("end", () => (ended = true));
  socket.on("error", () => {});
  if (halfClose) socket.end(request);
  else socket.write(request);
  await once(socket, "close");
  return {
    status: head.slice(0, head.indexOf("\r\n")),
    body: chunked ? chunked.bytes : body,
    complete: chunked ? chunked.terminated && chunked.trailing === 0 : body === declared,
    ended,
  };
}

async function connectRaw(port: number): Promise<net.Socket> {
  const sock = net.connect(port, "127.0.0.1");
  sock.on("error", () => {});
  await once(sock, "connect");
  return sock;
}

async function connectTls(port: number): Promise<nodeTls.TLSSocket> {
  const sock = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  sock.on("error", () => {});
  await once(sock, "secureConnect");
  return sock;
}

describe("backpressure", () => {
  // Writes `total` bytes to `res` in `chunk`-sized pieces, waiting for "drain"
  // whenever a write reports backpressure, then ends the response. Reusing one
  // chunk buffer keeps the test's peak memory small (the previous version held
  // a single 2 GB payload plus the server's queued copy, which pushed peak RSS
  // past 4.5 GB and intermittently got OOM-killed on 8 GB CI runners).
  // Resolves with how many writes returned false (each one waited for 'drain').
  async function writeBytes(res: http.ServerResponse, total: number, chunk: Buffer): Promise<number> {
    let remaining = total;
    let pushedBack = 0;
    while (remaining > 0) {
      const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
      remaining -= slice.byteLength;
      if (!res.write(slice)) {
        pushedBack++;
        await once(res, "drain");
      }
    }
    res.end();
    return pushedBack;
  }

  it("should handle backpressure", async () => {
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });
      // send 3 chunks of 1MB each which is more than the socket buffer and will trigger a backpressure event
      const payload = Buffer.alloc(1024 * 1024, "a");
      res.write(payload, () => {
        res.write(payload, () => {
          res.write(payload, () => {
            res.end();
          });
        });
      });
    });
    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const response = await fetch(`http://localhost:${PORT}/`);
    const bytes = await response.arrayBuffer();
    expect({
      status: response.status,
      contentType: response.headers.get("content-type"),
      length: bytes.byteLength,
    }).toEqual({ status: 200, contentType: "application/octet-stream", length: 1024 * 1024 * 3 });
  });

  // The closing FIN must be sequenced after the response bytes still sitting in
  // the native send buffer when end() returns, or the body is truncated. The
  // three variants cover client-requested close, server-set Connection: close,
  // and the one-shot res.end(body) framing path.
  describe.concurrent("Connection: close does not truncate a response that is still flushing", () => {
    async function rawRequest(server: http.Server, requestHeaders: string) {
      const sock = await connectRaw((server.address() as AddressInfo).port);
      return readRawResponse(sock, requestHeaders);
    }

    it("when the client requested the close", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.write(payload);
        res.end();
      });
      await once(server.listen(0), "listening");
      const result = await rawRequest(server, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      expect(result).toEqual({ status: "HTTP/1.1 200 OK", body: BODY, complete: true, ended: true });
    });

    it("when the server sets Connection: close on a keep-alive request", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Connection": "close" });
        res.write(payload);
        res.end();
      });
      await once(server.listen(0), "listening");
      const result = await rawRequest(server, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
      expect(result).toEqual({ status: "HTTP/1.1 200 OK", body: BODY, complete: true, ended: true });
    });

    it("when the whole body is passed to res.end()", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Connection": "close" });
        res.end(payload);
      });
      await once(server.listen(0), "listening");
      const result = await rawRequest(server, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
      expect(result).toEqual({ status: "HTTP/1.1 200 OK", body: BODY, complete: true, ended: true });
    });
  });

  // Node's socketOnEnd: with httpAllowHalfOpen=false (the default) it issues
  // socket.end(), with it true it marks the last response `_last` so resOnFinish
  // destroySoon()s. Either way, bytes already handed to the socket via
  // res.write() drain before the connection shuts down; the client half-closing
  // right after its request must not truncate them.
  describe.concurrent(
    "a client FIN right after the request does not truncate a response that is still flushing",
    () => {
      async function halfCloseRequest(server: http.Server) {
        const sock = await connectRaw((server.address() as AddressInfo).port);
        return readRawResponse(sock, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", true);
      }

      it.each([
        ["res.write() then res.end()", false, "sync"],
        ["res.write() without res.end()", false, "never"],
        // httpAllowHalfOpen: the close gate must wait for the handler's own
        // res.end() after drain, not force-close on the !httpAllowHalfOpen term.
        ["res.write() then res.end() after drain, httpAllowHalfOpen", true, "drain"],
      ] as const)("%s", async (_name, halfOpen, endMode) => {
        await using server = http.createServer((req, res) => {
          res.writeHead(200, { "Content-Length": String(BODY) });
          res.write(payload);
          if (endMode === "sync") res.end();
          else if (endMode === "drain") res.once("drain", () => res.end());
        });
        if (halfOpen) server.httpAllowHalfOpen = true;
        await once(server.listen(0, "127.0.0.1"), "listening");
        expect(await halfCloseRequest(server)).toEqual({
          status: "HTTP/1.1 200 OK",
          body: BODY,
          complete: true,
          ended: true,
        });
      });

      // A 'drain' listener that writes again after the first chunk has flushed
      // re-arms onWritable; the !httpAllowHalfOpen close gate must not fire over
      // the freshly-pinned bytes (bufferedAmount does not count them). Node
      // rejects the second write (socketOnEnd already called socket.end()); Bun
      // currently accepts and drains it. Both are consistent: the client sees
      // either the first write only, or both, never a torn second write.
      it("res.write() from 'drain' after client FIN is not torn mid-write", async () => {
        await using server = http.createServer((req, res) => {
          res.writeHead(200, { "Content-Length": String(BODY * 2) });
          res.write(payload);
          res.once("drain", () => {
            res.write(payload);
            res.end();
          });
          res.on("error", () => {});
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        const { status, body, ended } = await halfCloseRequest(server);
        expect({ status, ended }).toEqual({ status: "HTTP/1.1 200 OK", ended: true });
        expect([BODY, BODY * 2]).toContain(body);
      });

      // TLS variants of the it.each above: the server's TLS write-batch spill
      // (up to one 128 KiB ciphertext batch the kernel did not fully accept) is
      // reported as written by us_socket_write() while it sits in userspace, so
      // the post-FIN close gate (hasFullyDrained()) must wait for it. Looped a
      // few times so the on_writable drain cycle is exercised past the first
      // kernel-accepted write. This is also the client-side regression test for
      // the Windows eof-drain (a half-closed client must read out the kernel
      // receive buffer when AFD DISCONNECT is mapped to eof).
      describe.concurrent("https", () => {
        async function halfCloseTlsRequest(port: number) {
          const sock = await connectTls(port);
          return readRawResponse(sock, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", true);
        }

        it.each([
          ["client half-close, res.write() then res.end()", "write-end"],
          ["client half-close, res.end(payload)", "end"],
          ["client half-close, httpAllowHalfOpen, res.end() after drain", "drain"],
        ] as const)("%s", async (_name, endMode) => {
          await using server = https.createServer(tlsOptions, (req, res) => {
            res.writeHead(200, { "Content-Length": String(BODY) });
            if (endMode === "end") {
              res.end(payload);
            } else {
              res.write(payload);
              if (endMode === "write-end") res.end();
              else res.once("drain", () => res.end());
            }
          });
          if (endMode === "drain") server.httpAllowHalfOpen = true;
          await once(server.listen(0, "127.0.0.1"), "listening");
          const port = (server.address() as AddressInfo).port;
          for (let i = 0; i < 5; i++) {
            expect(await halfCloseTlsRequest(port)).toEqual({
              status: "HTTP/1.1 200 OK",
              body: BODY,
              complete: true,
              ended: true,
            });
          }
        });

        // allow_half_open defers the close to the writable drain; a peer that
        // FINs then resets must not wedge that drain on a spill send() that
        // keeps failing (us_internal_ssl_on_writable releases a zero-progress
        // spill after EOF so the dispatch reaches the close gate). A wedge
        // would leave the server-side socket open past the test timeout.
        it("closes promptly when the client half-closes then resets mid-drain", async () => {
          const closed = Promise.withResolvers<void>();
          await using server = https.createServer(tlsOptions, (req, res) => {
            req.socket.on("close", () => closed.resolve());
            res.writeHead(200, { "Content-Length": String(BODY) });
            res.end(payload);
            res.on("error", () => {});
          });
          server.requestTimeout = 0;
          server.headersTimeout = 0;
          await once(server.listen(0, "127.0.0.1"), "listening");
          const sock = await connectTls((server.address() as AddressInfo).port);
          sock.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
          await once(sock, "data");
          sock.destroy();
          await closed.promise;
        });
      });
    },
  );

  // Request-body direction: once the handler stops reading the body (req.pause(),
  // or nobody consuming the IncomingMessage), the connection's kernel reads must
  // stop too, so the upload stalls on TCP backpressure instead of the unread
  // body piling up in server memory (https://github.com/oven-sh/bun/issues/26332).
  // Node does this with readStop(socket); Bun pauses the underlying uWS socket.
  describe.concurrent("request body", () => {
    const TOTAL = 32 * 1024 * 1024;
    const BLOCK = Buffer.alloc(256 * 1024, "b");

    type RequestListener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
    const transports = {
      http: {
        createServer: (listener: RequestListener) => http.createServer(listener),
        connect: connectRaw,
      },
      https: {
        createServer: (listener: RequestListener) => https.createServer(tlsOptions, listener),
        connect: connectTls,
      },
    };
    type Transport = (typeof transports)[keyof typeof transports];

    // Raw client: sends the request head, then pumps TOTAL body bytes, parking
    // on 'drain' whenever the kernel send buffer is full, and FINs after the
    // last byte. Resolves once `sent` has stopped moving for 12 consecutive
    // 25 ms polls (the upload is stalled) or the whole body has been handed to
    // the kernel (nothing ever pushed back). The response is collected so the
    // caller can check the server still answered after draining the body.
    async function uploadUntilStalled(transport: Transport, port: number) {
      const sock = await transport.connect(port);
      let response = "";
      sock.on("data", chunk => (response += chunk.toString("latin1")));
      const closed = once(sock, "close");
      sock.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${TOTAL}\r\nConnection: close\r\n\r\n`);

      let sent = 0;
      const pump = () => {
        while (sent < TOTAL) {
          const n = Math.min(BLOCK.byteLength, TOTAL - sent);
          sent += n;
          if (!sock.write(n === BLOCK.byteLength ? BLOCK : BLOCK.subarray(0, n))) {
            sock.once("drain", pump);
            return;
          }
        }
        sock.end();
      };
      pump();

      let last = -1;
      let stable = 0;
      while (sent < TOTAL && stable < 12) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (sent === last) stable++;
        else {
          stable = 0;
          last = sent;
        }
      }
      return {
        sock,
        sentWhileStalled: sent,
        async finish() {
          await closed;
          return response;
        },
      };
    }

    function countBody(req: http.IncomingMessage, res: http.ServerResponse) {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      let received = 0;
      req.on("data", (chunk: Buffer) => (received += chunk.byteLength));
      req.on("end", () => {
        res.end("ok");
        resolve(received);
      });
      req.on("aborted", () => reject(new Error(`request aborted after ${received} body bytes`)));
      // The callers await this only after their backpressure assertions; an
      // abort before that must surface there, not as an unhandled rejection.
      promise.catch(() => {});
      return promise;
    }

    describe.concurrent.each(Object.keys(transports) as (keyof typeof transports)[])("%s", name => {
      const transport = transports[name];

      it("stalls the client while the handler has req.pause()d, and delivers the rest after req.resume()", async () => {
        const arrived = Promise.withResolvers<{ req: http.IncomingMessage; received: Promise<number> }>();
        await using server = transport.createServer((req, res) => {
          const received = countBody(req, res);
          req.pause();
          arrived.resolve({ req, received });
        });
        await once(server.listen(0, "127.0.0.1"), "listening");

        const upload = await uploadUntilStalled(transport, (server.address() as AddressInfo).port);
        try {
          const { req, received } = await arrived.promise;
          // Without TCP backpressure the client hands the kernel the whole body
          // while the request is paused (and the server buffers all of it).
          expect(upload.sentWhileStalled).toBeLessThan(TOTAL);

          req.resume();
          expect(await received).toBe(TOTAL);
          expect(await upload.finish()).toStartWith("HTTP/1.1 200 ");
        } finally {
          upload.sock.destroy();
        }
      });

      it("stalls the client once an unread body fills the IncomingMessage buffer, and delivers the rest once it is read", async () => {
        // Nobody reads req here: the body push() returns false at the
        // highWaterMark and the socket must be read-stopped from there (Node's
        // readStop in parserOnBody), not only when user code pauses explicitly.
        const arrived = Promise.withResolvers<{ req: http.IncomingMessage; res: http.ServerResponse }>();
        await using server = transport.createServer((req, res) => arrived.resolve({ req, res }));
        await once(server.listen(0, "127.0.0.1"), "listening");

        const upload = await uploadUntilStalled(transport, (server.address() as AddressInfo).port);
        try {
          const { req, res } = await arrived.promise;
          expect(upload.sentWhileStalled).toBeLessThan(TOTAL);
          expect(req.readableLength).toBeGreaterThan(0);
          expect(req.readableLength).toBeLessThan(TOTAL);

          expect(await countBody(req, res)).toBe(TOTAL);
          expect(await upload.finish()).toStartWith("HTTP/1.1 200 ");
        } finally {
          upload.sock.destroy();
        }
      });
    });

    it("delivers a body and FIN that arrived while the request was paused once it resumes", async () => {
      // The whole body and the client's FIN land on the paused connection; the
      // EOF has to stay parked until the handler resumes and then still be
      // delivered as 'end' (paused sockets defer EOF rather than dropping it).
      const BODY = 64 * 1024;
      const arrived = Promise.withResolvers<{ req: http.IncomingMessage; received: Promise<number> }>();
      await using server = http.createServer((req, res) => {
        req.pause();
        arrived.resolve({ req, received: countBody(req, res) });
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const sock = await connectRaw((server.address() as AddressInfo).port);
      let response = "";
      sock.on("data", chunk => (response += chunk.toString("latin1")));
      const closed = once(sock, "close");
      try {
        sock.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${BODY}\r\nConnection: close\r\n\r\n`);
        const { req, received } = await arrived.promise;
        sock.end(Buffer.alloc(BODY, "c"));
        await once(sock, "finish");

        req.resume();
        expect(await received).toBe(BODY);
        await closed;
        expect(response).toStartWith("HTTP/1.1 200 ");
      } finally {
        sock.destroy();
      }
    });
  });

  // 2^31 bytes, one past INT_MAX, written as 64 MiB chunks. Every chunk is
  // larger than the loopback send buffer, so each write() must report
  // backpressure (and writeBytes then waits for 'drain').
  describe("past INT_MAX", () => {
    const totalSize = 1024 * 1024 * 1024 * 2;
    const CHUNK = 64 * 1024 * 1024;

    it("should handle backpressure with INT_MAX bytes", async () => {
      const chunk = Buffer.alloc(CHUNK, "a");
      const pushedBack = Promise.withResolvers<number>();
      await using server = http.createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Transfer-Encoding": "chunked",
        });
        writeBytes(res, totalSize, chunk).then(pushedBack.resolve, pushedBack.reject);
      });

      await once(server.listen(0), "listening");

      const PORT = (server.address() as AddressInfo).port;
      const sock = await connectRaw(PORT);
      expect(await readRawResponse(sock, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")).toEqual({
        status: "HTTP/1.1 200 OK",
        body: totalSize,
        complete: true,
        ended: true,
      });
      expect(await pushedBack.promise).toBe(totalSize / CHUNK);
    }, 30_000);

    it("should handle backpressure with more than INT_MAX bytes", async () => {
      // enough to fill the socket buffer
      const smallPayloadSize = 1024 * 1024;
      const chunk = Buffer.alloc(CHUNK, "a");
      const pushedBack = Promise.withResolvers<number>();
      await using server = http.createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Transfer-Encoding": "chunked",
        });
        res.write(Buffer.alloc(smallPayloadSize, "a"));
        writeBytes(res, totalSize, chunk).then(pushedBack.resolve, pushedBack.reject);
      });

      await once(server.listen(0), "listening");

      const PORT = (server.address() as AddressInfo).port;
      const sock = await connectRaw(PORT);
      expect(await readRawResponse(sock, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")).toEqual({
        status: "HTTP/1.1 200 OK",
        body: totalSize + smallPayloadSize,
        complete: true,
        ended: true,
      });
      expect(await pushedBack.promise).toBe(totalSize / CHUNK);
    }, 30_000);
  });
});
