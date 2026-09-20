/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";
import { Duplex, duplexPair, Readable } from "node:stream";
import nodeTls from "node:tls";
import { Worker } from "node:worker_threads";

describe("backpressure", () => {
  // Writes `total` bytes to `res` in `chunk`-sized pieces, waiting for "drain"
  // whenever a write reports backpressure, then ends the response. Reusing one
  // chunk buffer keeps the test's peak memory small (the previous version held
  // a single 2 GB payload plus the server's queued copy, which pushed peak RSS
  // past 4.5 GB and intermittently got OOM-killed on 8 GB CI runners).
  async function writeBytes(res: http.ServerResponse, total: number, chunk: Buffer) {
    let remaining = total;
    while (remaining > 0) {
      const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
      remaining -= slice.byteLength;
      if (!res.write(slice)) {
        await once(res, "drain");
      }
    }
    res.end();
  }

  async function countResponseBytes(port: number): Promise<number> {
    const response = await fetch(`http://localhost:${port}/`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        totalBytes += value.byteLength;
      }
      if (done) break;
    }
    return totalBytes;
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
    const bytes = await fetch(`http://localhost:${PORT}/`).then(res => res.arrayBuffer());
    expect(bytes.byteLength).toBe(1024 * 1024 * 3);
  });

  // Once write() has returned false, 'drain' is due when the backlog is gone, also when a later
  // write() is the call that flushes it. The client reads from a worker thread while the server
  // thread is blocked, so the kernel has room again before the event loop can dispatch the
  // socket's writable event, and the next write() flushes the backlog inline.
  describe("'drain' after a later write() flushes the backlog", () => {
    // The request is HTTP/1.0 so that the body is not chunked: the client counts the exact bytes
    // the server wrote. The message { port, bodyBytesRead } opens a paused connection and sends
    // the request. A later { port } makes that connection read.
    const clientSource = `
      const { parentPort } = require("node:worker_threads");
      const net = require("node:net");
      const sockets = new Map();
      parentPort.on("message", ({ port, bodyBytesRead }) => {
        if (!bodyBytesRead) return sockets.get(port).resume();
        let head = "";
        let body = -1;
        const socket = net.connect(port, "127.0.0.1");
        sockets.set(port, socket);
        socket.on("connect", () => {
          socket.pause();
          socket.write("GET / HTTP/1.0\\r\\n\\r\\n");
        });
        socket.on("data", chunk => {
          if (body === -1) {
            head += chunk.toString("latin1");
            const end = head.indexOf("\\r\\n\\r\\n");
            if (end === -1) return;
            body = head.length - (end + 4);
          } else {
            body += chunk.length;
          }
          Atomics.store(bodyBytesRead, 0, body);
          Atomics.notify(bodyBytesRead, 0);
        });
        socket.on("error", () => {});
        socket.on("close", () => parentPort.postMessage({ port, body }));
      });
      parentPort.postMessage("ready");
    `;
    let client: Worker;
    beforeAll(async () => {
      client = new Worker(clientSource, { eval: true });
      await once(client, "message");
    });
    afterAll(() => client.terminate());

    // Blocks this thread, and so its event loop, until the client has read `target` body bytes.
    function blockUntilClientHasRead(bodyBytesRead: Int32Array, target: number) {
      const deadline = Date.now() + 10_000;
      for (let read = Atomics.load(bodyBytesRead, 0); read < target; read = Atomics.load(bodyBytesRead, 0)) {
        if (Date.now() > deadline) throw new Error(`the client read ${read} of ${target} body bytes`);
        Atomics.wait(bodyBytesRead, 0, read, 1000);
      }
    }

    // Bun copies the unsent part of a write() of at most 16 KB and holds a larger one by
    // reference. The cases cover both kinds as the backlog and as the write that flushes it.
    it.each([
      ["a small write() behind buffered writes", 16 * 1024, 1],
      ["a small write() behind a large write", 64 * 1024, 1],
      ["a large write() behind buffered writes", 16 * 1024, 32 * 1024],
    ] as const)("%s", async (_name, firstSize, secondSize) => {
      const first = Buffer.alloc(firstSize, "a");
      const second = Buffer.alloc(secondSize, "b");
      const bodyBytesRead = new Int32Array(new SharedArrayBuffer(4));
      const outcome = Promise.withResolvers<{ needDrain: boolean; drained: boolean; written: number }>();
      // The high-water mark is above every write here (the default is 16 KB on Windows), so
      // write() returns false only when the socket pushes back.
      await using server = http.createServer({ highWaterMark: 1024 * 1024 }, async (req, res) => {
        try {
          // Write until a backlog is still there a turn later: the socket pushed back.
          let written = 0;
          do {
            while (res.write(first)) written += first.length;
            written += first.length;
            await new Promise(resolve => setImmediate(resolve));
          } while (res.writableLength === 0);

          let drained = false;
          res.once("drain", () => (drained = true));
          // Every byte that is not in the backlog is in the kernel. Once the client has read them
          // all, the kernel has room for the backlog.
          client.postMessage({ port });
          blockUntilClientHasRead(bodyBytesRead, written - res.writableLength);
          res.write(second);
          written += second.length;
          const needDrain = res.writableNeedDrain;

          // The 'drain' is due in the first turn. If it does not fire, the byte count ends the
          // wait: once the client has every byte, nothing is left that can emit it.
          do {
            await new Promise(resolve => setImmediate(resolve));
          } while (!drained && Atomics.load(bodyBytesRead, 0) < written);
          res.end();
          outcome.resolve({ needDrain, drained, written });
        } catch (e) {
          res.destroy();
          outcome.reject(e);
        }
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const port = (server.address() as AddressInfo).port;

      // The client reports its body byte count when its connection to `port` closes.
      const clientClosed = (async () => {
        for (;;) {
          const [message] = await once(client, "message");
          if (message.port === port) return message.body as number;
        }
      })();
      client.postMessage({ port, bodyBytesRead });
      const [{ needDrain, drained, written }, body] = await Promise.all([outcome.promise, clientClosed]);
      expect({ needDrain, drained, body }).toEqual({ needDrain: true, drained: true, body: written });
    });
  });

  // The closing FIN must be sequenced after the response bytes still sitting in
  // the native send buffer when end() returns, or the body is truncated. The
  // three variants cover client-requested close, server-set Connection: close,
  // and the one-shot res.end(body) framing path.
  describe("Connection: close does not truncate a response that is still flushing", () => {
    const BODY = 8 * 1024 * 1024;

    async function rawRequestBytes(
      server: http.Server,
      requestHeaders: string,
    ): Promise<{ received: number; ended: boolean }> {
      const port = (server.address() as AddressInfo).port;
      const socket = net.connect(port, "127.0.0.1");
      let received = 0;
      let ended = false;
      socket.on("data", chunk => (received += chunk.length));
      socket.on("end", () => (ended = true));
      const closed = once(socket, "close");
      const failed = new Promise((_, reject) => socket.on("error", reject));
      await once(socket, "connect");
      socket.write(requestHeaders);
      await Promise.race([closed, failed]);
      return { received, ended };
    }

    it("when the client requested the close", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.write(Buffer.alloc(BODY, "a"));
        res.end();
      });
      await once(server.listen(0), "listening");
      const { received, ended } = await rawRequestBytes(
        server,
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      );
      expect(ended).toBe(true);
      expect(received).toBeGreaterThan(BODY);
    });

    it("when the server sets Connection: close on a keep-alive request", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Connection": "close" });
        res.write(Buffer.alloc(BODY, "a"));
        res.end();
      });
      await once(server.listen(0), "listening");
      const { received, ended } = await rawRequestBytes(
        server,
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
      );
      expect(ended).toBe(true);
      expect(received).toBeGreaterThan(BODY);
    });

    it("when the whole body is passed to res.end()", async () => {
      await using server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Connection": "close" });
        res.end(Buffer.alloc(BODY, "a"));
      });
      await once(server.listen(0), "listening");
      const { received, ended } = await rawRequestBytes(
        server,
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
      );
      expect(ended).toBe(true);
      expect(received).toBeGreaterThan(BODY);
    });
  });

  // Node's socketOnEnd: with httpAllowHalfOpen=false (the default) it issues
  // socket.end(), with it true it marks the last response `_last` so resOnFinish
  // destroySoon()s. Either way, bytes already handed to the socket via
  // res.write() drain before the connection shuts down; the client half-closing
  // right after its request must not truncate them.
  describe("a client FIN right after the request does not truncate a response that is still flushing", () => {
    const BODY = 8 * 1024 * 1024;
    const payload = Buffer.alloc(BODY, "a");

    async function halfCloseRequestBodyBytes(server: http.Server): Promise<{ body: number; ended: boolean }> {
      const port = (server.address() as AddressInfo).port;
      const socket = net.connect(port, "127.0.0.1");
      let body = 0;
      let head = "";
      let gotHead = false;
      let ended = false;
      socket.on("data", chunk => {
        if (!gotHead) {
          head += chunk.toString("latin1");
          const i = head.indexOf("\r\n\r\n");
          if (i >= 0) {
            gotHead = true;
            body = Buffer.byteLength(head.slice(i + 4), "latin1");
          }
        } else {
          body += chunk.length;
        }
      });
      socket.on("end", () => (ended = true));
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      await once(socket, "close");
      return { body, ended };
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
      const { body, ended } = await halfCloseRequestBodyBytes(server);
      expect({ body, ended }).toEqual({ body: BODY, ended: true });
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
      const { body, ended } = await halfCloseRequestBodyBytes(server);
      expect(ended).toBe(true);
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
    describe("https", () => {
      const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
      const tlsOptions = {
        cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
        key: readFileSync(path.join(keysDir, "agent1-key.pem")),
      };

      async function halfCloseTlsRequestBodyBytes(port: number): Promise<{ body: number; ended: boolean }> {
        const socket = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        let body = 0;
        let head = "";
        let gotHead = false;
        let ended = false;
        socket.on("data", chunk => {
          if (!gotHead) {
            head += chunk.toString("latin1");
            const i = head.indexOf("\r\n\r\n");
            if (i >= 0) {
              gotHead = true;
              body = Buffer.byteLength(head.slice(i + 4), "latin1");
            }
          } else {
            body += chunk.length;
          }
        });
        socket.on("end", () => (ended = true));
        socket.on("error", () => {});
        await once(socket, "secureConnect");
        socket.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await once(socket, "close");
        return { body, ended };
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
          expect(await halfCloseTlsRequestBodyBytes(port)).toEqual({ body: BODY, ended: true });
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
        const port = (server.address() as AddressInfo).port;
        const sock = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        sock.on("error", () => {});
        await once(sock, "secureConnect");
        sock.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await once(sock, "data");
        sock.destroy();
        await closed.promise;
      });
    });
  });

  // Request-body direction: once the handler stops reading the body (req.pause(),
  // or nobody consuming the IncomingMessage), the connection's kernel reads must
  // stop too, so the upload stalls on TCP backpressure instead of the unread
  // body piling up in server memory (https://github.com/oven-sh/bun/issues/26332).
  // Node does this with readStop(socket); Bun pauses the underlying uWS socket.
  describe("request body", () => {
    const TOTAL = 32 * 1024 * 1024;
    const BLOCK = Buffer.alloc(256 * 1024, "b");

    const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
    const tlsOptions = {
      cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
      key: readFileSync(path.join(keysDir, "agent1-key.pem")),
    };
    type RequestListener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
    const transports = {
      http: {
        createServer: (listener: RequestListener) => http.createServer(listener),
        async connect(port: number) {
          const sock = net.connect(port, "127.0.0.1");
          sock.on("error", () => {});
          await once(sock, "connect");
          return sock;
        },
      },
      https: {
        createServer: (listener: RequestListener) => https.createServer(tlsOptions, listener),
        async connect(port: number) {
          const sock = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
          sock.on("error", () => {});
          await once(sock, "secureConnect");
          return sock;
        },
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

    describe.each(Object.keys(transports) as (keyof typeof transports)[])("%s", name => {
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

    it("delivers the rest of a body and the FIN that arrived while the connection was paused once the request resumes", async () => {
      // req.pause() alone leaves the connection reading (like Node), so the
      // first part of the body has to fill the paused request's buffer to stop
      // it. The rest of the body and the client's FIN then land on the paused
      // connection; the EOF has to stay parked until the handler resumes and
      // then still be delivered as 'end' (paused sockets defer EOF rather than
      // dropping it).
      const FILL = 64 * 1024;
      const REST = 16 * 1024;
      const arrived = Promise.withResolvers<{ req: http.IncomingMessage; received: Promise<number> }>();
      const connectionPaused = Promise.withResolvers<void>();
      await using server = http.createServer({ highWaterMark: FILL }, (req, res) => {
        if (req.url === "/ping") return void res.end("pong");
        req.pause();
        req.socket.once("pause", () => connectionPaused.resolve());
        arrived.resolve({ req, received: countBody(req, res) });
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const port = (server.address() as AddressInfo).port;

      const sock = await transports.http.connect(port);
      let response = "";
      sock.on("data", chunk => (response += chunk.toString("latin1")));
      const closed = once(sock, "close");
      try {
        sock.write(`POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${FILL + REST}\r\nConnection: close\r\n\r\n`);
        const { req, received } = await arrived.promise;
        sock.write(Buffer.alloc(FILL, "c"));
        await connectionPaused.promise;
        sock.end(Buffer.alloc(REST, "c"));
        await once(sock, "finish");

        // A full exchange on a second connection takes several turns of the
        // server's event loop, so the loop polls while the FIN waits on the
        // paused connection. The connection must not react to it yet.
        const ping = await transports.http.connect(port);
        ping.write("GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        ping.resume();
        await once(ping, "close");
        expect({ complete: req.complete, destroyed: req.destroyed, response }).toEqual({
          complete: false,
          destroyed: false,
          response: "",
        });

        req.resume();
        expect(await received).toBe(FILL + REST);
        await closed;
        expect(response).toStartWith("HTTP/1.1 200 ");
      } finally {
        sock.destroy();
      }
    });

    it("keeps the buffer of a chunked upload bounded while the handler pauses on every 'data'", async () => {
      // Each resume() lets one buffered chunk out, because the handler pauses
      // again in 'data'. The connection has to stay stopped until the buffer is
      // below the highWaterMark again (Node restarts it from _read() only). If
      // every resume() restarted it, each cycle would admit a whole socket read
      // and take one chunk out, and the buffer would grow with the upload.
      const UPLOAD = 8 * 1024 * 1024;
      const frame = Buffer.concat([Buffer.from("10000\r\n"), Buffer.alloc(0x10000, "d"), Buffer.from("\r\n")]);
      const result = Promise.withResolvers<{ received: number; maxBuffered: number }>();
      // Awaited only after the upload loop; an abort must surface there.
      result.promise.catch(() => {});
      await using server = http.createServer((req, res) => {
        let received = 0;
        let maxBuffered = 0;
        req.on("data", (chunk: Buffer) => {
          received += chunk.byteLength;
          maxBuffered = Math.max(maxBuffered, req.readableLength);
          req.pause();
          setImmediate(() => req.resume());
        });
        req.on("end", () => {
          res.end("ok");
          result.resolve({ received, maxBuffered });
        });
        req.on("aborted", () => result.reject(new Error(`request aborted after ${received} body bytes`)));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const sock = await transports.http.connect((server.address() as AddressInfo).port);
      sock.resume();
      try {
        sock.write("POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n");
        for (let sent = 0; sent < UPLOAD; sent += 0x10000) {
          if (!sock.write(frame)) await once(sock, "drain");
        }
        sock.write("0\r\n\r\n");

        const { received, maxBuffered } = await result.promise;
        expect(received).toBe(UPLOAD);
        // One highWaterMark plus one socket read stays far below this.
        expect(maxBuffered).toBeLessThan(UPLOAD / 4);
      } finally {
        sock.destroy();
      }
    });
  });

  // An empty chunk adds no bytes, but it is still a write. While a 'drain' is
  // owed it returns false and its callback waits behind the earlier ones, and
  // that 'drain' still fires. Node: conn.write("") queues the callback and
  // returns state.length < highWaterMark.
  describe("an empty res.write() reports backpressure like any other write", () => {
    it("while earlier bytes are pending, and leaves their 'drain' and callbacks alone", async () => {
      // More than the Linux and macOS loopback buffers hold, so there the
      // response stays backed up until the client reads.
      const BODY = 64 * 1024 * 1024;
      const payload = Buffer.alloc(BODY, "a");
      const called: string[] = [];
      let drained = false;
      const wrote = Promise.withResolvers<boolean[]>();
      const finished = Promise.withResolvers<{ drained: boolean; afterDrain: boolean }>();
      finished.promise.catch(() => {});

      await using server = http.createServer(async (req, res) => {
        try {
          res.writeHead(200, { "Content-Length": String(BODY + 1) });
          res.once("drain", () => (drained = true));
          const callbacks: Promise<void>[] = [];
          const callback = (name: string) => {
            const { promise, resolve } = Promise.withResolvers<void>();
            callbacks.push(promise);
            return () => {
              called.push(name);
              resolve();
            };
          };
          wrote.resolve([
            res.write(payload, callback("payload")),
            // The unsent tail of `payload` is held by reference here.
            res.write("", callback("empty string")),
            // A second write with bytes copies that tail into the socket's
            // backpressure buffer, which is the other place bytes can wait.
            res.write("x", callback("x")),
            res.write(Buffer.alloc(0), callback("empty Buffer")),
          ]);
          // A callback that waits for the drain runs after 'drain' is
          // emitted, so `drained` is final once all of them have run.
          await Promise.all(callbacks);
          const afterDrain = res.write("");
          res.end();
          finished.resolve({ drained, afterDrain });
        } catch (e) {
          wrote.reject(e);
          finished.reject(e);
          res.destroy();
        }
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      await once(socket, "connect");
      socket.pause();
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      try {
        const returned = await wrote.promise;
        // A callback handed to process.nextTick() by one of the writes above
        // has run by the time a setImmediate() callback does.
        await new Promise(resolve => setImmediate(resolve));
        const beforeClientRead = { called: [...called], drained };

        let head = "";
        let body = -1;
        socket.on("data", chunk => {
          if (body < 0) {
            head += chunk.toString("latin1");
            const end = head.indexOf("\r\n\r\n");
            if (end < 0) return;
            body = Buffer.byteLength(head.slice(end + 4), "latin1");
          } else {
            body += chunk.length;
          }
        });
        const closed = once(socket, "close");
        socket.resume();
        const [result] = await Promise.all([finished.promise, closed]);

        const order = ["payload", "empty string", "x", "empty Buffer"];
        expect({ returned, beforeClientRead, ...result, called, body }).toEqual({
          returned: [false, false, false, false],
          // Winsock can take the whole payload in one send(). The callbacks
          // of the writes it took, in order, and 'drain' can then come at once.
          beforeClientRead:
            process.platform === "win32"
              ? { called: order.slice(0, beforeClientRead.called.length), drained: expect.any(Boolean) }
              : { called: [], drained: false },
          drained: true,
          afterDrain: true,
          called: order,
          body: BODY + 1,
        });
      } finally {
        socket.destroy();
      }
    });

    it("in the turn of a write that reached the high water mark", async () => {
      const finished = Promise.withResolvers<{ size: number; returned: boolean[] }>();
      finished.promise.catch(() => {});
      await using server = http.createServer(async (req, res) => {
        try {
          const size = res.writableHighWaterMark;
          const returned = [res.write(Buffer.alloc(size, "a")), res.write(""), res.write(Buffer.alloc(0))];
          await once(res, "drain");
          returned.push(res.write(""));
          res.end();
          finished.resolve({ size, returned });
        } catch (e) {
          finished.reject(e);
          res.destroy();
        }
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const [{ size, returned }, received] = await Promise.all([
        finished.promise,
        fetch(url).then(async response => (await response.arrayBuffer()).byteLength),
      ]);
      expect({ returned, received }).toEqual({ returned: [false, false, false, true], received: size });
    });

    // The exception: Node ignores every write to a response that cannot have
    // a body. It returns true and runs the callback on the next tick, also
    // while the socket still holds the bytes of the response before it.
    it.each([
      ["a HEAD response", "HEAD /ignored HTTP/1.1"],
      ["a 204 response", "GET /ignored HTTP/1.1"],
    ])("but not on %s", async (_name, requestLine) => {
      const BODY = 8 * 1024 * 1024;
      const payload = Buffer.alloc(BODY, "a");
      const called: string[] = [];
      const wrote = Promise.withResolvers<{
        res: http.ServerResponse;
        earlierResponsePending: boolean;
        returned: boolean[];
      }>();
      await using server = http.createServer((req, res) => {
        if (req.url !== "/ignored") {
          res.end(payload);
          return;
        }
        try {
          res.statusCode = req.method === "HEAD" ? 200 : 204;
          res.on("drain", () => called.push("drain"));
          // Bun counts the unsent bytes of the earlier response on this
          // response, Node counts them on the socket.
          const earlierResponsePending = res.writableLength + req.socket.writableLength > 0;
          const returned = [
            res.write("x", () => called.push("x")),
            res.write("", () => called.push("empty string")),
            res.write(Buffer.alloc(0), () => called.push("empty Buffer")),
          ];
          wrote.resolve({ res, earlierResponsePending, returned });
        } catch (e) {
          wrote.reject(e);
          res.destroy();
        }
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      await once(socket, "connect");
      socket.pause();
      socket.write(
        `GET / HTTP/1.1\r\nHost: localhost\r\n\r\n${requestLine}\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
      try {
        const { res, earlierResponsePending, returned } = await wrote.promise;
        await new Promise(resolve => setImmediate(resolve));
        expect({ earlierResponsePending, returned, called }).toEqual({
          // Winsock can take the whole first response in one send().
          earlierResponsePending: process.platform === "win32" ? expect.any(Boolean) : true,
          returned: [true, true, true],
          called: ["x", "empty string", "empty Buffer"],
        });
        res.end();

        let received = 0;
        socket.on("data", chunk => (received += chunk.length));
        const closed = once(socket, "close");
        socket.resume();
        await closed;
        expect(received).toBeGreaterThan(BODY);
      } finally {
        socket.destroy();
      }
    });
  });

  // A socket handed over with server.emit("connection") and an HTTP/1.1 client
  // of an http2 server with allowHTTP1 are served over the socket's stream
  // interface. Node applies the socket's backpressure to their responses like
  // to any other: write() returns false while the socket is over its high
  // water mark, 'drain' follows the socket's 'drain', and a write() callback
  // runs once the socket has flushed its chunk.
  describe("a response on a connection from server.emit('connection') or http2's allowHTTP1 waits for the socket", () => {
    const TOTAL = 16 * 1024 * 1024;
    // Larger than a socket's high water mark, so every write() reports backpressure.
    const CHUNK = Buffer.alloc(256 * 1024, "a");

    const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
    const tlsOptions = {
      cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
      key: readFileSync(path.join(keysDir, "agent1-key.pem")),
    };

    type Connection = {
      // A client connection that reads nothing until readBody().
      connect(): Promise<Duplex>;
      // At least one whole turn of the event loop: an exchange on a second
      // connection where there is a port to connect to.
      turn(): Promise<void>;
      close(): void;
    };

    function ping(module: typeof http | typeof https, port: number) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      module
        .get({ port, host: "127.0.0.1", path: "/ping", agent: false, rejectUnauthorized: false }, res => {
          res.resume();
          res.on("end", () => resolve());
        })
        .on("error", reject);
      return promise;
    }

    function answerPing(listener: http.RequestListener): http.RequestListener {
      return (req, res) => (req.url === "/ping" ? res.end("pong") : listener(req, res));
    }

    const entryPoints: Record<string, (listener: http.RequestListener) => Promise<Connection>> = {
      "server.emit('connection', socket) with a net.Socket": async listener => {
        const server = http.createServer(answerPing(listener));
        const acceptor = net.createServer(socket => server.emit("connection", socket));
        await once(acceptor.listen(0, "127.0.0.1"), "listening");
        const port = (acceptor.address() as AddressInfo).port;
        return {
          async connect() {
            const socket = net.connect(port, "127.0.0.1");
            socket.pause();
            await once(socket, "connect");
            return socket;
          },
          turn: () => ping(http, port),
          close: () => void acceptor.close(),
        };
      },
      "server.emit('connection', duplex) with a stream.duplexPair() side": async listener => {
        const server = http.createServer(listener);
        return {
          async connect() {
            const [clientSide, serverSide] = duplexPair();
            clientSide.pause();
            server.emit("connection", serverSide);
            return clientSide;
          },
          turn: () => new Promise<void>(resolve => setImmediate(resolve)),
          close() {},
        };
      },
      "http2.createSecureServer({ allowHTTP1: true }) with an HTTP/1.1 client": async listener => {
        const server = http2.createSecureServer({ ...tlsOptions, allowHTTP1: true }, answerPing(listener) as never);
        await once(server.listen(0, "127.0.0.1"), "listening");
        const port = (server.address() as AddressInfo).port;
        return {
          async connect() {
            const socket = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
            socket.pause();
            await once(socket, "secureConnect");
            return socket;
          },
          turn: () => ping(https, port),
          close: () => void server.close(),
        };
      },
    };

    // Reads until `bodies` bodies of TOTAL bytes, each behind a head of the
    // same length, have arrived or the connection has closed. Resolves with
    // the number of body bytes.
    function readBody(client: Duplex, bodies = 1) {
      const { promise, resolve } = Promise.withResolvers<number>();
      let head = "";
      let headLength = -1;
      let received = 0;
      client.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (headLength < 0) {
          head += chunk.toString("latin1");
          const i = head.indexOf("\r\n\r\n");
          if (i >= 0) headLength = i + 4;
        }
        if (headLength >= 0 && received >= bodies * (headLength + TOTAL)) resolve(received - bodies * headLength);
      });
      client.on("error", () => {});
      client.on("close", () => resolve(received - bodies * Math.max(headLength, 0)));
      client.resume();
      return promise;
    }

    // The usual pump: write until write() returns false, go on at 'drain'.
    // `callback(end)` makes the callback of the chunk that ends at body offset
    // `end`. `afterWrite` runs right after each write().
    type Progress = { written: number; finished: boolean };
    async function pump(
      res: http.ServerResponse,
      progress: Progress,
      callback: (end: number) => (err?: Error | null) => void,
      afterWrite = () => {},
    ) {
      res.setHeader("Content-Length", TOTAL);
      while (progress.written < TOTAL) {
        const ok = res.write(CHUNK, callback((progress.written += CHUNK.length)));
        afterWrite();
        if (!ok) await once(res, "drain");
      }
      res.end();
      progress.finished = true;
    }

    // The client reads nothing. The pump goes on until the socket stops
    // taking bytes, or to the end of the body if a kernel takes it all.
    async function untilStalled(connection: Connection, progress: Progress) {
      let before: number;
      do {
        before = progress.written;
        await connection.turn();
      } while (!progress.finished && progress.written !== before);
    }

    describe.each(Object.keys(entryPoints))("%s", name => {
      it("write() reports the socket's backpressure, and 'drain' and the write() callbacks wait for the socket", async () => {
        const progress = { written: 0, finished: false };
        const seen = { callbacks: 0, drainsOverBacklog: 0, callbacksBeforeFlush: 0 };
        let maxBacklog = 0;
        const arrived = Promise.withResolvers<void>();
        const handled = Promise.withResolvers<void>();
        const connection = await entryPoints[name]((req, res) => {
          const socket = req.socket;
          res.on("drain", () => {
            if (socket.writableLength > 0) seen.drainsOverBacklog++;
          });
          pump(
            res,
            progress,
            end => () => {
              seen.callbacks++;
              // The socket may hold what was written after this chunk, and nothing more.
              if (socket.writableLength > progress.written - end) seen.callbacksBeforeFlush++;
            },
            () => (maxBacklog = Math.max(maxBacklog, socket.writableLength)),
          ).then(handled.resolve, handled.reject);
          arrived.resolve();
        });
        const client = await connection.connect();
        try {
          client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
          await arrived.promise;
          await untilStalled(connection, progress);
          expect(await readBody(client)).toBe(TOTAL);
          await handled.promise;
          expect(seen).toEqual({ callbacks: TOTAL / CHUNK.length, drainsOverBacklog: 0, callbacksBeforeFlush: 0 });
          // The handler waited at every false: the socket never held more than the head and one chunk.
          expect(maxBacklog).toBeLessThan(2 * CHUNK.length);
        } finally {
          client.destroy();
          connection.close();
        }
      });
    });

    // This needs a socket whose writes Node completes through an async
    // resource of the write (a duplexPair() side completes them from the
    // reader's side), and a kernel that stops taking bytes.
    const netSocket = entryPoints["server.emit('connection', socket) with a net.Socket"];

    it("a write() callback and a 'drain' listener that waited for the socket run in the async context of the write", async () => {
      const storage = new AsyncLocalStorage<string>();
      const progress = { written: 0, finished: false };
      const stores = { callbacks: new Set<string | undefined>(), drains: new Set<string | undefined>() };
      const arrived = Promise.withResolvers<void>();
      const handled = Promise.withResolvers<void>();
      // The server listens in a context of its own, so a callback that runs in
      // the context of the socket's events shows up as "listen".
      const connection = await storage.run("listen", netSocket, (req, res) =>
        storage.run("request", () => {
          res.on("drain", () => stores.drains.add(storage.getStore()));
          pump(res, progress, () => () => stores.callbacks.add(storage.getStore())).then(
            handled.resolve,
            handled.reject,
          );
          arrived.resolve();
        }),
      );
      const client = await connection.connect();
      try {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await arrived.promise;
        await untilStalled(connection, progress);
        expect(await readBody(client)).toBe(TOTAL);
        await handled.promise;
        expect({ callbacks: [...stores.callbacks], drains: [...stores.drains] }).toEqual({
          callbacks: ["request"],
          drains: ["request"],
        });
      } finally {
        client.destroy();
        connection.close();
      }
    });

    // A socket that takes a write and never completes it, like a kernel that
    // is full. destroy() fails the write that it holds, as net.Socket does.
    class StalledSocket extends Duplex {
      #held: ((err?: Error | null) => void) | undefined;
      _read() {}
      _write(_chunk: Buffer, _encoding: string, callback: (err?: Error | null) => void) {
        this.#held = callback;
      }
      _destroy(err: Error | null, callback: (err?: Error | null) => void) {
        this.#held?.(err ?? new Error("canceled"));
        callback(err);
      }
    }

    const writeCallback = (events: string[], name: string) => (err?: Error | null) =>
      events.push(`${name} write callback: ${err ? "error" : "done"}`);

    it("the write() callbacks that wait for the socket fail when the connection dies, before 'close'", async () => {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        res.on("close", () => {
          events.push("close");
          closed.resolve();
        });
        res.write(CHUNK, writeCallback(events, "first"));
        res.write(CHUNK, writeCallback(events, "second"));
        req.socket.destroy();
      });
      const socket = new StalledSocket();
      server.emit("connection", socket);
      socket.push("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await closed.promise;
      expect(events).toEqual(["first write callback: error", "second write callback: error", "close"]);
    });

    // The remaining cases use the duplexPair() side: it takes less than one
    // CHUNK from a client that does not read, on every platform.
    const pair = entryPoints["server.emit('connection', duplex) with a stream.duplexPair() side"];

    it("an empty write() behind a chunk the socket still holds waits with it", async () => {
      const order: string[] = [];
      const wrote = Promise.withResolvers<{ res: http.ServerResponse; returned: boolean[] }>();
      const connection = await pair((req, res) => {
        res.setHeader("Content-Length", CHUNK.length);
        const returned = [res.write(CHUNK, () => order.push("chunk")), res.write("", () => order.push("empty"))];
        wrote.resolve({ res, returned });
      });
      const client = await connection.connect();
      try {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        const { res, returned } = await wrote.promise;
        await connection.turn();
        expect({ returned, order, needDrain: res.writableNeedDrain }).toEqual({
          returned: [false, false],
          order: [],
          needDrain: true,
        });

        const drained = once(res, "drain");
        client.resume();
        await drained;
        // The callbacks run in the tick of the 'drain'.
        await connection.turn();
        expect(order).toEqual(["chunk", "empty"]);
        res.end();
      } finally {
        client.destroy();
      }
    });

    // A client that sends FIN after its request makes the server end the
    // socket (httpAllowHalfOpen is off). An ended socket emits no 'drain', but
    // it still flushes what the response wrote.
    it("the write() callbacks that wait for the socket succeed when the socket finishes after the client's FIN", async () => {
      const events: string[] = [];
      const wrote = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      const connection = await pair((req, res) => {
        res.on("drain", () => events.push("drain"));
        res.on("close", () => {
          events.push("close");
          closed.resolve();
        });
        res.write(CHUNK, writeCallback(events, "first"));
        res.write(CHUNK, writeCallback(events, "second"));
        wrote.resolve();
      });
      const client = await connection.connect();
      try {
        client.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await wrote.promise;
        await connection.turn();
        expect(events).toEqual([]);

        client.resume();
        await closed.promise;
        expect(events).toEqual(["first write callback: done", "second write callback: done", "close"]);
      } finally {
        client.destroy();
      }
    });

    // The socket can still hold the previous response's bytes when the next
    // request arrives. The next response has not written anything, so it does
    // not need a 'drain': pipe() waits for one whenever writableNeedDrain says
    // so, and none would come.
    it("the next response on a socket that still holds the previous body can be piped into", async () => {
      const firstEnded = Promise.withResolvers<void>();
      const needDrain = Promise.withResolvers<boolean>();
      const connection = await pair((req, res) => {
        res.setHeader("Content-Length", TOTAL);
        if (req.url === "/first") {
          res.end(Buffer.alloc(TOTAL, "a"));
          firstEnded.resolve();
        } else {
          needDrain.resolve(res.writableNeedDrain);
          Readable.from(Array.from({ length: TOTAL / CHUNK.length }, () => CHUNK)).pipe(res);
        }
      });
      const client = await connection.connect();
      try {
        client.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await firstEnded.promise;
        await connection.turn();
        client.write("GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n");
        expect(await needDrain.promise).toBe(false);
        expect(await readBody(client, 2)).toBe(2 * TOTAL);
      } finally {
        client.destroy();
      }
    });

    // Node discards a write() to a response without a body and answers true.
    // Nothing reaches the socket, so its backlog is not this write's concern.
    it("a write() to a HEAD response does not wait for a socket that still holds the previous body", async () => {
      const firstEnded = Promise.withResolvers<void>();
      const wrote = Promise.withResolvers<boolean>();
      let called = false;
      const connection = await pair((req, res) => {
        if (req.method === "HEAD") {
          wrote.resolve(res.write("discarded", () => (called = true)));
          res.end();
        } else {
          res.end(Buffer.alloc(TOTAL, "a"));
          firstEnded.resolve();
        }
      });
      const client = await connection.connect();
      try {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await firstEnded.promise;
        await connection.turn();
        client.write("HEAD / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        const returned = await wrote.promise;
        await connection.turn();
        expect({ returned, called }).toEqual({ returned: true, called: true });
      } finally {
        client.destroy();
      }
    });
  });

  it("should handle backpressure with INT_MAX bytes", async () => {
    const totalSize = 1024 * 1024 * 1024 * 2; // 2^31, one past INT_MAX
    const chunk = Buffer.alloc(64 * 1024 * 1024, "a");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });

      writeBytes(res, totalSize, chunk);
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const totalBytes = await countResponseBytes(PORT);

    expect(totalBytes).toBe(totalSize);
  }, 30_000);

  it("should handle backpressure with more than INT_MAX bytes", async () => {
    // enough to fill the socket buffer
    const smallPayloadSize = 1024 * 1024;
    const totalSize = 1024 * 1024 * 1024 * 2; // 2^31, one past INT_MAX
    const chunk = Buffer.alloc(64 * 1024 * 1024, "a");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });
      res.write(Buffer.alloc(smallPayloadSize, "a"));
      writeBytes(res, totalSize, chunk);
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const totalBytes = await countResponseBytes(PORT);

    expect(totalBytes).toBe(totalSize + smallPayloadSize);
  }, 30_000);
});
