/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";
import { duplexPair, finished } from "node:stream";
import nodeTls from "node:tls";

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

  // Node runs the write() callbacks a slow reader held up, then emits a
  // response's 'finish' (then the end() callback, then 'close') once every byte
  // of it has been handed to the kernel, not when end() merely accepted them:
  // bytes a slow reader leaves in the server's userspace buffer are still the
  // response's (https://github.com/oven-sh/bun/issues/43155). Until then
  // writableFinished is false, writableLength counts them, the response keeps
  // its socket (the next pipelined response queues behind it, the keep-alive
  // timer has not started) and the body counts as work that keeps the process
  // alive. The usual graceful-shutdown recipe (close the server once the last
  // response has closed) relies on this: server.close() destroys connections
  // whose response has ended, which is only safe once the bytes are in the
  // kernel.
  describe("a response finishes once its body has been written out, not when end() buffered it", () => {
    const BODY = 32 * 1024 * 1024;
    const FIRST = 1024 * 1024;
    const CHUNK = Buffer.alloc(256 * 1024, "a");

    const keysDir = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
    const tlsOptions = {
      cert: readFileSync(path.join(keysDir, "agent1-cert.pem")),
      key: readFileSync(path.join(keysDir, "agent1-key.pem")),
    };

    // The body goes out as write(1 MB) + end(31 MB) to a client that is not
    // reading yet. Most kernels take only a few MB of that from a socket
    // nobody reads, so the rest waits in the server process until the client
    // reads, and res.writableLength says so right after end(). Some do take it
    // all (Windows can buffer any amount, libuv's WSASend always lets it):
    // nothing waits then, so each test checks the "not finished yet" state
    // only when writableLength showed a backlog, and checks the delivered
    // bytes and the event order either way.
    function writeBody(res: http.ServerResponse, endCallback?: () => void) {
      res.setHeader("Content-Length", BODY);
      res.write(Buffer.alloc(FIRST, "a"));
      res.end(Buffer.alloc(BODY - FIRST, "a"), endCallback);
      return res.writableLength > 0;
    }

    // The same body as 256 KB writes, then end(). By the last write a kernel
    // that leaves a backlog has long stopped taking bytes, so that write's
    // callback is one the backlog holds up.
    function writeBodyInChunks(
      res: http.ServerResponse,
      endWithChunk: boolean,
      endCallback: () => void,
      lastWriteCallback?: () => void,
    ) {
      res.setHeader("Content-Length", BODY);
      const writes = BODY / CHUNK.length - (endWithChunk ? 1 : 0);
      for (let i = 0; i < writes; i++) res.write(CHUNK, i === writes - 1 ? lastWriteCallback : undefined);
      if (endWithChunk) res.end(CHUNK, endCallback);
      else res.end(endCallback);
      return res.writableLength > 0;
    }

    // "/ping" is answered at once: see ping().
    function createServer(tls: boolean, handler: http.RequestListener) {
      const listener: http.RequestListener = (req, res) => (req.url === "/ping" ? res.end("pong") : handler(req, res));
      return tls ? https.createServer(tlsOptions, listener) : http.createServer(listener);
    }

    // A complete exchange on a second connection. Whatever end() put on the
    // tick queue has run by the time it is over, so a test that looks at the
    // events afterwards sees the ones that did not wait for the reader.
    function ping(port: number, tls = false) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      (tls ? https : http)
        .get({ port, host: "127.0.0.1", path: "/ping", agent: false, rejectUnauthorized: false }, res => {
          res.resume();
          res.on("end", () => resolve());
        })
        .on("error", reject);
      return promise;
    }

    // A raw client that sends `request` but reads nothing until resume() or read().
    function pausedClient(port: number, request: string, { tls = false, collect = true } = {}) {
      const socket = tls
        ? nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
        : net.connect(port, "127.0.0.1");
      const done = Promise.withResolvers<{ bytes: Buffer; ended: boolean }>();
      const chunks: Buffer[] = [];
      let head = "";
      let headLength = -1;
      let received = 0;
      let target: { count: number; reached: () => void } | undefined;
      let reading = false;
      let ended = false;
      const stopAtTarget = () => {
        if (!target || headLength < 0 || received < target.count * (headLength + BODY)) return;
        reading = false;
        socket.pause();
        target.reached();
        target = undefined;
      };
      socket.pause();
      socket.on(tls ? "secureConnect" : "connect", () => {
        socket.write(request);
        if (!reading) socket.pause();
      });
      socket.on("data", chunk => {
        received += chunk.length;
        if (collect) chunks.push(chunk);
        if (headLength < 0) {
          head += chunk.toString("latin1");
          const i = head.indexOf("\r\n\r\n");
          if (i >= 0) headLength = i + 4;
        }
        stopAtTarget();
      });
      socket.on("end", () => (ended = true));
      socket.on("error", () => {});
      // A connection that dies early resolves too, so it fails the test instead of hanging it.
      socket.on("close", () => done.resolve({ bytes: Buffer.concat(chunks), ended }));
      const resume = () => {
        reading = true;
        socket.resume();
      };
      const destroy = () => void socket.destroy();
      return {
        send: (data: string) => socket.write(data),
        // Sends the FIN. The client still receives.
        end: () => void socket.end(),
        resume,
        // Reads until `count` whole responses (each one a head of the same
        // length plus BODY bytes) have arrived, then stops reading again.
        read(count: number) {
          const reached = Promise.withResolvers<void>();
          target = { count, reached: reached.resolve };
          resume();
          stopAtTarget();
          return Promise.race([
            reached.promise,
            done.promise.then(() => Promise.reject(new Error(`the connection closed after ${received} bytes`))),
          ]);
        },
        get received() {
          return received;
        },
        get headLength() {
          return headLength;
        },
        done: done.promise,
        destroy,
        [Symbol.dispose]: destroy,
      };
    }

    it("the events wait for the reader, so server.close() from 'close' delivers the whole body", async () => {
      const events: string[] = [];
      let backlog = false;
      let stateAfterEnd: unknown, stateAtFinish: unknown;
      const handled = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        res.on("finish", () => {
          stateAtFinish = { writableFinished: res.writableFinished, writableLength: res.writableLength };
          events.push("finish");
        });
        res.on("close", () => {
          events.push("close");
          // The graceful-shutdown recipe: nothing is in flight any more, so this
          // must not cut the body short.
          server.close();
        });
        backlog = writeBody(res, () => events.push("end callback"));
        stateAfterEnd = { writableEnded: res.writableEnded, writableFinished: res.writableFinished };
        handled.resolve();
      });
      try {
        await once(server.listen(0, "127.0.0.1"), "listening");
        using client = pausedClient(
          (server.address() as AddressInfo).port,
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        );
        await Promise.race([handled.promise, client.done]);
        if (backlog) {
          // The client has not read anything yet.
          expect(events).toEqual([]);
          expect(stateAfterEnd).toEqual({ writableEnded: true, writableFinished: false });
        }
        client.resume();
        const { bytes, ended } = await client.done;
        expect(bytes.length - bytes.indexOf("\r\n\r\n") - 4).toBe(BODY);
        expect(ended).toBe(true);
        expect(events).toEqual(["finish", "end callback", "close"]);
        expect(stateAtFinish).toEqual({ writableFinished: true, writableLength: 0 });
      } finally {
        // A second close() is harmless (Node reports ERR_SERVER_NOT_RUNNING to the callback).
        server.close(() => {});
      }
    });

    // https://github.com/oven-sh/bun/issues/43155
    it.each([
      ["res.end(callback)", false, false],
      ["res.end(chunk, callback) over TLS", true, true],
    ] as const)("the write() callbacks wait for the reader too: %s", async (_name, tls, endWithChunk) => {
      const events: string[] = [];
      let backlog = false;
      const handled = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      await using server = createServer(tls, (req, res) => {
        const socket = req.socket;
        res.on("finish", () => events.push("finish"));
        res.on("close", () => {
          events.push("close");
          closed.resolve();
        });
        backlog = writeBodyInChunks(
          res,
          endWithChunk,
          () => {
            events.push("end callback");
            // The handler takes the callback as "the response is sent" and drops the connection.
            socket.destroy();
          },
          () => events.push("write callback"),
        );
        handled.resolve();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const port = (server.address() as AddressInfo).port;
      using client = pausedClient(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", { tls, collect: false });
      await Promise.race([handled.promise, client.done]);
      await ping(port, tls);
      // The client has not read anything yet.
      if (backlog) expect(events).toEqual([]);
      await Promise.all([client.read(1), closed.promise]);
      expect(client.received).toBe(client.headLength + BODY);
      expect(events).toEqual(["write callback", "finish", "end callback", "close"]);
    });

    // Node's failed socket write still runs its callback and the response still
    // emits 'finish', so the order is the same when the bytes never leave.
    it("a client that goes away without reading still completes the response, in the same order", async () => {
      const events: string[] = [];
      const state: Record<string, unknown> = {};
      const handled = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      await using server = createServer(false, (req, res) => {
        res.on("finish", () => {
          events.push("finish");
          state.writableFinishedAtFinish = res.writableFinished;
          // 'finish' comes before the response is torn down, as after a drain.
          state.tornDownAtFinish = res.destroyed || res.closed;
        });
        res.on("close", () => {
          events.push("close");
          state.writableFinishedAtClose = res.writableFinished;
          // The response did finish, so stream.finished() must not report a premature close.
          finished(res, err => {
            state.streamFinished = err?.code ?? "ok";
            closed.resolve();
          });
        });
        writeBodyInChunks(
          res,
          true,
          () => events.push("end callback"),
          () => events.push("write callback"),
        );
        handled.resolve();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      using client = pausedClient((server.address() as AddressInfo).port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await Promise.race([handled.promise, client.done]);
      client.destroy();
      await closed.promise;
      expect(events).toEqual(["write callback", "finish", "end callback", "close"]);
      expect(state).toEqual({
        writableFinishedAtFinish: true,
        tornDownAtFinish: false,
        writableFinishedAtClose: true,
        streamFinished: "ok",
      });
    });

    // Reads are paused while a request waits behind the backed-up response, so
    // the failed write is the only sign of the client's death. The response
    // still completes, and its request, which is still open, is not aborted:
    // it left the connection's queue of requests when the response finished.
    it.each([
      ["http", false],
      ["https", true],
    ] as const)(
      "a client that goes away with a request queued behind the unfinished response still completes it: %s",
      async (_name, tls) => {
        const events: string[] = [];
        let backlog = false;
        const handled = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
        const closed = Promise.withResolvers<void>();
        await using server = createServer(tls, (req, res) => {
          const name = req.url!.slice(1) as "first" | "second";
          if (name === "second") {
            res.end("second");
            handled.second.resolve();
            return;
          }
          req.on("data", () => {});
          req.pause();
          req.on("aborted", () => events.push("request aborted"));
          res.on("finish", () => events.push(`finish, request destroyed: ${req.destroyed}`));
          res.on("close", () => {
            events.push("close");
            closed.resolve();
          });
          backlog = writeBody(res);
          handled.first.resolve();
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        using client = pausedClient(
          (server.address() as AddressInfo).port,
          "POST /first HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello",
          { tls },
        );
        await Promise.race([handled.first.promise, client.done]);
        client.send("GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await Promise.race([handled.second.promise, client.done]);
        // The client has not read anything yet.
        if (backlog) expect(events).toEqual([]);
        client.destroy();
        await closed.promise;
        expect(events).toEqual(["finish, request destroyed: false", "close"]);
      },
    );

    it("a request pipelined behind the unfinished response is answered after it, intact", async () => {
      const events: string[] = [];
      let backlog = false;
      const handled = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
      await using server = http.createServer((req, res) => {
        const name = req.url!.slice(1) as "first" | "second";
        events.push(`request ${name}`);
        res.on("finish", () => events.push(`finish ${name}`));
        res.on("close", () => events.push(`close ${name}`));
        if (name === "first") {
          backlog = writeBody(res);
        } else {
          res.end("second");
        }
        handled[name].resolve();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      using client = pausedClient(
        (server.address() as AddressInfo).port,
        "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n",
      );
      await Promise.race([handled.first.promise, client.done]);
      client.send("GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      await Promise.race([handled.second.promise, client.done]);
      if (backlog) {
        // The client has not read anything yet: the first response still owns
        // the connection and the second is queued behind it.
        expect(events).toEqual(["request first", "request second"]);
      }
      client.resume();
      const { bytes, ended } = await client.done;

      const firstBody = bytes.indexOf("\r\n\r\n") + 4;
      expect(firstBody).toBeGreaterThan(4);
      const secondHead = bytes.indexOf("HTTP/1.1 200", firstBody);
      expect(secondHead).toBe(firstBody + BODY);
      expect(bytes.subarray(firstBody, secondHead).equals(Buffer.alloc(BODY, "a"))).toBe(true);
      expect(bytes.subarray(bytes.indexOf("\r\n\r\n", secondHead) + 4).toString()).toBe("second");
      expect(ended).toBe(true);
      expect(events.filter(e => !e.startsWith("request"))).toEqual([
        "finish first",
        "close first",
        "finish second",
        "close second",
      ]);
      if (backlog) {
        expect(events.indexOf("request second")).toBeLessThan(events.indexOf("finish first"));
      }
    });

    // The second request's body reader is set up while the first response
    // still drains, and the rest of that body arrives after it. Completing
    // the first response must not take the reader away. The first request has
    // a body too: only such a response has a reader of its own to let go of.
    it("a pipelined request still receives its body after the response ahead of it is out", async () => {
      const handled = Promise.withResolvers<void>();
      const dispatched = Promise.withResolvers<void>();
      await using server = createServer(false, (req, res) => {
        if (req.url === "/first") {
          req.resume();
          req.on("end", () => {
            writeBody(res);
            handled.resolve();
          });
          return;
        }
        dispatched.resolve();
        const chunks: Buffer[] = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => res.end(Buffer.concat(chunks)));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      using client = pausedClient(
        (server.address() as AddressInfo).port,
        "POST /first HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello",
      );
      await Promise.race([handled.promise, client.done]);
      client.send("POST /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 10\r\n\r\n12345");
      await Promise.race([dispatched.promise, client.done]);
      await client.read(1);
      client.send("67890");
      client.resume();
      const { bytes, ended } = await client.done;
      const second = bytes.subarray(client.headLength + BODY).toString("latin1");
      expect(second.slice(second.indexOf("\r\n\r\n") + 4)).toBe("1234567890");
      expect(ended).toBe(true);
    });

    // Both pipelined responses back up. The first one is done once its own
    // bytes are out: its callback must not wait for the second response, which
    // the client has not read yet.
    it("a pipelined response that backs up too does not hold up the first one's callback", async () => {
      const events: string[] = [];
      const responses: http.ServerResponse[] = [];
      const handled = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      const calledBack = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      await using server = createServer(false, (req, res) => {
        const id = responses.push(res) - 1;
        writeBodyInChunks(res, true, () => {
          events.push(`end callback ${id}`);
          calledBack[id].resolve();
        });
        handled[id].resolve();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const port = (server.address() as AddressInfo).port;
      using client = pausedClient(
        port,
        "GET /0 HTTP/1.1\r\nHost: localhost\r\n\r\nGET /1 HTTP/1.1\r\nHost: localhost\r\n\r\n",
        { collect: false },
      );
      await Promise.race([Promise.all([handled[0].promise, handled[1].promise]), client.done]);
      await ping(port);
      // The client has not read anything yet.
      if (responses[0].writableLength > 0) expect(events).toEqual([]);

      // The client reads the first response and stops: the second one stays behind.
      await Promise.all([client.read(1), calledBack[0].promise]);
      await ping(port);
      if (responses[1].writableLength > 0) expect(events).toEqual(["end callback 0"]);

      await Promise.all([client.read(2), calledBack[1].promise]);
      expect(events).toEqual(["end callback 0", "end callback 1"]);
      expect(client.received).toBe(2 * (client.headLength + BODY));
    });

    // The keep-alive timer belongs to the idle time after a response. Started
    // at end(), it destroys the connection of a reader that takes longer than
    // keepAliveTimeout (5 seconds by default) to fetch the body. Not on
    // Windows: a body that the kernel took whole is a finished response, so
    // the timer legitimately starts before the client reads.
    (process.platform === "win32" ? it.skip : it)(
      "the keep-alive timer starts once the body is out, not while a slow reader still fetches it",
      async () => {
        const handled = Promise.withResolvers<void>();
        await using server = createServer(false, (req, res) => {
          writeBody(res);
          handled.resolve();
        });
        server.keepAliveTimeout = 1;
        (server as http.Server & { keepAliveTimeoutBuffer: number }).keepAliveTimeoutBuffer = 0;
        await once(server.listen(0, "127.0.0.1"), "listening");
        const port = (server.address() as AddressInfo).port;
        using client = pausedClient(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await Promise.race([handled.promise, client.done]);
        await ping(port);
        client.resume();
        // The server closes the idle connection right after the response.
        const { bytes, ended } = await client.done;
        expect(bytes.length - bytes.indexOf("\r\n\r\n") - 4).toBe(BODY);
        expect(ended).toBe(true);
      },
    );

    it("the unwritten part of the body keeps the process alive", async () => {
      // The child has nothing but the in-flight body left to do once its
      // handler has run and unref'd the server.
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const server = require("node:http").createServer((req, res) => {
            res.setHeader("Content-Length", ${BODY});
            res.write(Buffer.alloc(${FIRST}, "a"));
            res.end(Buffer.alloc(${BODY - FIRST}, "a"));
            server.unref();
          });
          server.listen(0, "127.0.0.1", () => console.log(server.address().port));`,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      try {
        const exited = once(child, "exit");
        const [portLine] = await Promise.race([
          once(child.stdout!, "data"),
          exited.then(([code, signal]) => {
            throw new Error(`server exited before listening: code ${code}, signal ${signal}`);
          }),
        ]);
        using client = pausedClient(
          Number(portLine.toString()),
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        );
        client.resume();
        const { bytes, ended } = await client.done;
        expect(bytes.length - bytes.indexOf("\r\n\r\n") - 4).toBe(BODY);
        expect(ended).toBe(true);
        expect(await exited).toEqual([0, null]);
      } finally {
        child.kill();
      }
    });

    // Bun serves these connections from JS, over the stream it is given: the
    // HTTP/1.1 client of an http2 server with allowHTTP1 (a TLS socket), and
    // a socket handed to an http.Server through emit("connection"). What the
    // reader has not taken yet waits in that stream, so socket.writableLength
    // says whether there is a backlog.
    describe.each(["http2 allowHTTP1", 'emit("connection")'] as const)("on a connection from %s", kind => {
      const tls = kind === "http2 allowHTTP1";

      // "/ping" is answered at once: see ping().
      async function listen(handler: http.RequestListener) {
        const listener: http.RequestListener = (req, res) =>
          req.url === "/ping" ? res.end("pong") : handler(req, res);
        const server = tls
          ? http2.createSecureServer({ ...tlsOptions, allowHTTP1: true }, listener as never)
          : http.createServer(listener);
        // The http.Server never listens: a net.Server accepts its connections.
        const acceptor = tls
          ? (server as net.Server)
          : net.createServer(socket => void server.emit("connection", socket));
        const closed = once(acceptor, "close");
        await once(acceptor.listen(0, "127.0.0.1"), "listening");
        // Like server.close() on a server that listens itself: no new
        // connections, and the ones with no response in flight are closed.
        const close = () => {
          server.close(() => {});
          if (acceptor !== server) acceptor.close(() => {});
        };
        return {
          port: (acceptor.address() as AddressInfo).port,
          close,
          [Symbol.asyncDispose]: () => (close(), closed),
        };
      }

      it("the events wait for the reader, so closing the server from 'close' delivers the whole body", async () => {
        const events: string[] = [];
        let socket!: net.Socket, res!: http.ServerResponse;
        let stateAtFinish: unknown;
        const handled = Promise.withResolvers<void>();
        await using server = await listen((req, response) => {
          socket = req.socket;
          res = response;
          res.on("finish", () => {
            stateAtFinish = { writableFinished: res.writableFinished, writableLength: res.writableLength };
            events.push("finish");
          });
          res.on("close", () => {
            events.push("close");
            // The graceful-shutdown recipe: nothing is in flight any more, so this
            // must not cut the body short.
            server.close();
          });
          writeBody(res, () => events.push("end callback"));
          handled.resolve();
        });
        using client = pausedClient(server.port, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", {
          tls,
        });
        await Promise.race([handled.promise, client.done]);
        // Where the kernel took the whole body, 'close' has closed the server by now.
        await ping(server.port, tls).catch(() => {});
        // The client has not read anything yet.
        if (socket.writableLength > 0) {
          expect({ events, writableFinished: res.writableFinished, counted: res.writableLength > 0 }).toEqual({
            events: [],
            writableFinished: false,
            counted: true,
          });
        }
        client.resume();
        const { bytes, ended } = await client.done;
        expect(bytes.length - bytes.indexOf("\r\n\r\n") - 4).toBe(BODY);
        expect(ended).toBe(true);
        expect(events).toEqual(["finish", "end callback", "close"]);
        expect(stateAtFinish).toEqual({ writableFinished: true, writableLength: 0 });
      });

      // Node's failed socket write still runs its callback and the response still
      // emits 'finish', so the order is the same when the bytes never leave.
      it("a client that goes away without reading still completes the response, in the same order", async () => {
        const events: string[] = [];
        const state: Record<string, unknown> = {};
        let socket!: net.Socket;
        const handled = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        await using server = await listen((req, res) => {
          socket = req.socket;
          res.on("finish", () => {
            events.push("finish");
            state.writableFinishedAtFinish = res.writableFinished;
            // 'finish' comes before the response is torn down, as after a drain.
            state.tornDownAtFinish = res.destroyed || res.closed;
          });
          res.on("close", () => {
            events.push("close");
            state.writableFinishedAtClose = res.writableFinished;
            // The response did finish, so stream.finished() must not report a premature close.
            finished(res, err => {
              state.streamFinished = err?.code ?? "ok";
              closed.resolve();
            });
          });
          writeBody(res, () => events.push("end callback"));
          handled.resolve();
        });
        using client = pausedClient(server.port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", { tls });
        await Promise.race([handled.promise, client.done]);
        await ping(server.port, tls);
        // The client has not read anything yet.
        if (socket.writableLength > 0) expect(events).toEqual([]);
        client.destroy();
        await closed.promise;
        expect(events).toEqual(["finish", "end callback", "close"]);
        expect(state).toEqual({
          writableFinishedAtFinish: true,
          tornDownAtFinish: false,
          writableFinishedAtClose: true,
          streamFinished: "ok",
        });
      });

      // The server side drops the connection (a timeout handler does this). The
      // response completes in the same order, and not inside the destroy() call.
      it("a socket destroyed while the response drains completes it once destroy() has returned", async () => {
        const events: string[] = [];
        let socket!: net.Socket;
        const handled = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        await using server = await listen((req, res) => {
          socket = req.socket;
          res.on("finish", () => events.push("finish"));
          res.on("close", () => {
            events.push("close");
            closed.resolve();
          });
          writeBody(res, () => events.push("end callback"));
          handled.resolve();
        });
        using client = pausedClient(server.port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", { tls });
        await Promise.race([handled.promise, client.done]);
        await ping(server.port, tls);
        // The client has not read anything yet.
        const backlog = socket.writableLength > 0;
        events.push("destroy()");
        socket.destroy();
        events.push("destroy() returned");
        await closed.promise;
        const completed = ["finish", "end callback", "close"];
        const destroyed = ["destroy()", "destroy() returned"];
        expect(events).toEqual(backlog ? [...destroyed, ...completed] : [...completed, ...destroyed]);
      });

      // The server answers the client's FIN by ending its own side, and an ended
      // socket takes no more writes. An end() that comes after that, with the
      // body still draining, must leave that body alone. (Node never emits
      // 'finish' here: the response only closes.)
      it("an end() after the client's FIN does not cut the body that still drains", async () => {
        const events: string[] = [];
        const errors: unknown[] = [];
        let socket!: net.Socket;
        const handled = Promise.withResolvers<void>();
        const ended = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        await using server = await listen((req, res) => {
          socket = req.socket;
          socket.on("error", err => errors.push(err));
          res.on("finish", () => events.push("finish"));
          res.on("close", () => {
            events.push("close");
            closed.resolve();
          });
          res.setHeader("Content-Length", BODY);
          res.write(Buffer.alloc(BODY, "a"));
          // The server's own 'end' listener is older than this one, so it has run.
          socket.once("end", () => {
            res.end(() => events.push("end callback"));
            ended.resolve();
          });
          handled.resolve();
        });
        using client = pausedClient(server.port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n", { tls });
        await Promise.race([handled.promise, client.done]);
        client.end();
        await Promise.race([ended.promise, client.done]);
        await ping(server.port, tls);
        // The client has not read anything yet.
        if (socket.writableLength > 0) expect(events).toEqual([]);
        client.resume();
        const [{ bytes }] = await Promise.all([client.done, closed.promise]);
        expect({ body: bytes.length - bytes.indexOf("\r\n\r\n") - 4, errors }).toEqual({ body: BODY, errors: [] });
        expect(events.at(-1)).toBe("close");
      });

      it("a request pipelined behind the unfinished response is answered after it, intact", async () => {
        const events: string[] = [];
        let socket!: net.Socket;
        const handled = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
        await using server = await listen((req, res) => {
          socket = req.socket;
          const name = req.url!.slice(1) as "first" | "second";
          events.push(`request ${name}`);
          res.on("finish", () => events.push(`finish ${name}`));
          res.on("close", () => events.push(`close ${name}`));
          if (name === "first") {
            writeBody(res);
          } else {
            res.end("second");
          }
          handled[name].resolve();
        });
        using client = pausedClient(server.port, "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n", { tls });
        await Promise.race([handled.first.promise, client.done]);
        client.send("GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        await Promise.race([handled.second.promise, client.done]);
        await ping(server.port, tls);
        if (socket.writableLength > 0) {
          // The client has not read anything yet: the first response still owns
          // the connection and the second is queued behind it.
          expect(events).toEqual(["request first", "request second"]);
        }
        client.resume();
        const { bytes, ended } = await client.done;

        const firstBody = bytes.indexOf("\r\n\r\n") + 4;
        expect(firstBody).toBeGreaterThan(4);
        const secondHead = bytes.indexOf("HTTP/1.1 200", firstBody);
        expect(secondHead).toBe(firstBody + BODY);
        expect(bytes.subarray(firstBody, secondHead).equals(Buffer.alloc(BODY, "a"))).toBe(true);
        expect(bytes.subarray(bytes.indexOf("\r\n\r\n", secondHead) + 4).toString()).toBe("second");
        expect(ended).toBe(true);
        expect(events.filter(e => !e.startsWith("request"))).toEqual([
          "finish first",
          "close first",
          "finish second",
          "close second",
        ]);
      });
    });

    // The same over a stream that is not a socket. A duplexPair side completes a
    // write when the other side reads it, so the backlog does not depend on a kernel.
    it('a response on a duplexPair given to emit("connection") finishes once the other side has read it', async () => {
      const events: string[] = [];
      const body = Buffer.alloc(1024 * 1024, "a");
      let res!: http.ServerResponse;
      const handled = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      const server = http.createServer((req, response) => {
        if (req.url === "/ping") return void response.end("pong");
        res = response;
        res.on("finish", () => events.push("finish"));
        res.on("close", () => {
          events.push("close");
          closed.resolve();
        });
        res.end(body, () => events.push("end callback"));
        handled.resolve();
      });
      const [clientSide, serverSide] = duplexPair();
      const [pingClientSide, pingServerSide] = duplexPair();
      try {
        server.emit("connection", serverSide);
        clientSide.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await handled.promise;
        // A complete exchange on a second connection, like ping().
        server.emit("connection", pingServerSide);
        pingClientSide.end("GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        expect((await Array.fromAsync(pingClientSide)).join("")).toEndWith("pong");
        // The client has not read anything yet.
        expect({
          events,
          writableFinished: res.writableFinished,
          counted: res.writableLength >= body.length,
          queued: serverSide.writableLength >= body.length,
        }).toEqual({ events: [], writableFinished: false, counted: true, queued: true });

        const chunks: Buffer[] = [];
        clientSide.on("data", chunk => chunks.push(chunk));
        await closed.promise;
        const bytes = Buffer.concat(chunks);
        expect(bytes.subarray(bytes.indexOf("\r\n\r\n") + 4).equals(body)).toBe(true);
        expect(events).toEqual(["finish", "end callback", "close"]);
      } finally {
        for (const side of [clientSide, serverSide, pingClientSide, pingServerSide]) side.destroy();
      }
    });

    // The first response completes because its connection dies. Its 'finish'
    // listener throws, and the response queued behind it is still aborted.
    it("a 'finish' listener that throws does not keep a dying connection from closing its queued response", async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const events = [];
          process.on("uncaughtException", err => events.push("uncaughtException: " + err.message));
          const server = require("node:http").createServer((req, res) => {
            const name = req.url.slice(1);
            res.on("close", () => {
              events.push("close " + name);
              if (events.includes("close first") && events.includes("close second")) {
                console.log(JSON.stringify(events));
                process.exit(0);
              }
            });
            if (name === "first") {
              res.on("finish", () => {
                events.push("finish first");
                throw new Error("from 'finish'");
              });
              res.end(Buffer.alloc(${BODY}, "a"));
            } else {
              res.end("second");
              const socket = req.socket;
              setImmediate(() => socket.destroy());
            }
          });
          const acceptor = require("node:net").createServer(socket => server.emit("connection", socket));
          acceptor.listen(0, "127.0.0.1", () => console.log(acceptor.address().port));`,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      try {
        // 'close' comes after the child's stdout has ended.
        const exited = once(child, "close");
        let stdout = "";
        child.stdout!.setEncoding("utf8").on("data", chunk => (stdout += chunk));
        await Promise.race([
          once(child.stdout!, "data"),
          exited.then(([code, signal]) => {
            throw new Error(`server exited before listening: code ${code}, signal ${signal}`);
          }),
        ]);
        // The client reads nothing, so the first response is still draining when the socket is destroyed.
        using client = pausedClient(
          parseInt(stdout),
          "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\n\r\n",
          { collect: false },
        );
        expect(await exited).toEqual([0, null]);
        const events: string[] = JSON.parse(stdout.slice(stdout.indexOf("\n") + 1));
        expect({ first: events.slice(0, 2), closed: events.slice(2).sort() }).toEqual({
          first: ["finish first", "uncaughtException: from 'finish'"],
          closed: ["close first", "close second"],
        });
      } finally {
        child.kill();
      }
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

      const sock = await transports.http.connect((server.address() as AddressInfo).port);
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
