// A close-delimited streamed response (HTTP/1.0 request, no framing headers)
// must not have `Content-Length: N\r\n\r\n` written into the body when the
// stream closes after raw body bytes already went out (#38675, #28019).
import { describe, expect, it } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import nodeTls from "node:tls";

function rawHttp10Request(port: number): Promise<Buffer> {
  const socket = net.connect(port, "127.0.0.1");
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  socket.on("error", reject);
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  socket.on("close", () => resolve(Buffer.concat(chunks)));
  socket.write("GET / HTTP/1.0\r\n\r\n");
  return promise;
}

const BIG = 256 * 1024;

describe("close-delimited response framing", () => {
  it("stream close after flush does not append Content-Length to the body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        let pulls = 0;
        return new Response(
          new ReadableStream({
            type: "bytes",
            pull(ctrl) {
              if (pulls++ === 0) {
                // Large enough to flush to the socket before the next pull.
                ctrl.enqueue(Buffer.alloc(BIG, "a"));
              } else {
                ctrl.close();
              }
            },
          }),
        );
      },
    });
    const raw = await rawHttp10Request(server.port!);
    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = raw.subarray(headerEnd + 4);
    expect(body.includes("Content-Length")).toBe(false);
    expect(body.length).toBe(BIG);
  });

  it("stream close with a final chunk pending does not inject Content-Length mid-body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        let pulls = 0;
        return new Response(
          new ReadableStream({
            type: "bytes",
            pull(ctrl) {
              if (pulls++ === 0) {
                ctrl.enqueue(Buffer.alloc(BIG, "a"));
              } else {
                ctrl.enqueue(Buffer.from("final-tail"));
                ctrl.close();
              }
            },
          }),
        );
      },
    });
    const raw = await rawHttp10Request(server.port!);
    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = raw.subarray(headerEnd + 4);
    expect(body.includes("Content-Length")).toBe(false);
    expect(body.length).toBe(BIG + "final-tail".length);
    expect(body.subarray(BIG).toString()).toBe("final-tail");
  });
});

// The end of the connection is the end of a close-delimited body. When the
// server ends the connection before the body is complete (the idle timer,
// server.timeout(), server.stop(true), a client that ends its side), an end
// without an error makes the short body a whole answer to the client. Such a
// cut must reach the client as a reset, and over TLS with no close_notify
// before it.
describe.concurrent("the end of a connection that carries a close-delimited body", () => {
  const transports = [
    ["tcp", false],
    ["tls", true],
  ] as const;

  function serve(secure: boolean, options: Partial<Bun.Serve.Options<undefined>>) {
    return Bun.serve({ port: 0, hostname: "127.0.0.1", tls: secure ? tls : undefined, ...options } as any);
  }

  // One request over a raw socket. `ending` resolves when the connection is
  // gone. `framing` is what the header section says of the body. `endedBy`
  // holds "end" for an end without an error, and the error code for any other.
  function request(port: number, { version = "1.0", secure = false, path = "/" } = {}) {
    const socket: net.Socket = secure
      ? nodeTls.connect({ port, host: "127.0.0.1", ca: tls.cert })
      : net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const endedBy: string[] = [];
    const ending = Promise.withResolvers<{ framing: string; body: string; endedBy: string[] }>();
    const response = () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      const headEnd = raw.indexOf("\r\n\r\n");
      if (headEnd < 0) return { framing: "none", body: "" };
      const head = raw.slice(0, headEnd);
      const framing = /^content-length:/im.test(head)
        ? "content-length"
        : /^transfer-encoding:\s*chunked/im.test(head)
          ? "chunked"
          : "close";
      return { framing, body: raw.slice(headEnd + 4) };
    };
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => endedBy.push("end"));
    socket.on("error", (err: NodeJS.ErrnoException) => endedBy.push(err.code ?? err.message));
    socket.on("close", () => ending.resolve({ ...response(), endedBy }));
    socket.write(`GET ${path} HTTP/${version}\r\nHost: localhost\r\n\r\n`);
    const gone = ending.promise.then(() => {
      throw new Error(`the connection is gone: ${endedBy.join(", ") || "closed"}`);
    });
    gone.catch(() => {});
    return {
      socket,
      ending: ending.promise,
      // `event`, unless the connection is gone first.
      before: <T>(event: Promise<T>) => Promise.race([event, gone]),
      async received(text: string) {
        while (!response().body.includes(text)) await Promise.race([once(socket, "data"), gone]);
      },
      [Symbol.dispose]: () => void socket.destroy(),
    };
  }

  // A body of two parts. The second part waits for finish().
  function twoParts() {
    const gate = Promise.withResolvers<void>();
    let pulls = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (pulls++ === 0) {
          controller.enqueue("part 1 of 2\n");
          return;
        }
        await gate.promise;
        controller.enqueue("part 2 of 2\n");
        controller.close();
      },
    });
    return { stream, finish: gate.resolve };
  }

  // A body that the application has ended while the server still holds bytes
  // of it: the client does not read. `ended` reports that this state exists.
  const megabyte = Buffer.alloc(1024 * 1024, "a");
  function endedBeforeDrained(chunk = megabyte) {
    const ended = Promise.withResolvers<{ sent: number; backedUp: boolean; endParked: boolean }>();
    const stream = new ReadableStream({
      type: "direct",
      pull(controller: any) {
        // write() returns a Promise once the socket has refused bytes.
        let backedUp = false;
        let sent = 0;
        while (!backedUp && sent < 512 * megabyte.length) {
          backedUp = controller.write(chunk) instanceof Promise;
          sent += chunk.length;
        }
        const endParked = controller.end() instanceof Promise;
        ended.resolve({ sent, backedUp, endParked });
      },
    } as any);
    return { stream, ended: ended.promise };
  }
  const isWhole = (received: string, sent: number) =>
    received.length === sent && received === Buffer.alloc(sent, "a").toString();
  const endedAndNotDrained = { backedUp: true, endParked: false, pendingRequests: 0 };

  describe("a cut ends with a reset", () => {
    const cut = { framing: "close", body: "part 1 of 2\n", endedBy: ["ECONNRESET"] };

    // The idle timer sweeps the connections every 4 seconds: these rows wait for one sweep.
    it.each(transports)(
      "the idle timer, %s",
      async (_, secure) => {
        const body = twoParts();
        using server = serve(secure, { idleTimeout: 1, fetch: () => new Response(body.stream) });
        using client = request(server.port!, { secure });
        expect(await client.ending).toEqual(cut);
      },
      15_000,
    );

    it("server.timeout(request, seconds)", async () => {
      const body = twoParts();
      using server = serve(false, {
        idleTimeout: 0,
        fetch(req, server) {
          server.timeout(req, 1);
          return new Response(body.stream);
        },
      });
      using client = request(server.port!);
      expect(await client.ending).toEqual(cut);
    }, 15_000);

    it.each(transports)("server.stop(true), %s", async (_, secure) => {
      const body = twoParts();
      using server = serve(secure, { fetch: () => new Response(body.stream) });
      using client = request(server.port!, { secure });
      await client.received("part 1 of 2\n");
      server.stop(true);
      expect(await client.ending).toEqual(cut);
    });

    // The server takes the end of the client's side for a disconnect, and a client can still read after it.
    it.each(transports)("the client ends its side, %s", async (_, secure) => {
      const body = twoParts();
      using server = serve(secure, { fetch: () => new Response(body.stream) });
      using client = request(server.port!, { secure });
      await client.received("part 1 of 2\n");
      client.socket.end();
      expect(await client.ending).toEqual(cut);
    });

    it("server.stop(true), the body has ended but has not drained", async () => {
      const body = endedBeforeDrained();
      using server = serve(false, { fetch: () => new Response(body.stream) });
      using client = request(server.port!);
      client.socket.pause();
      const { sent, ...state } = await client.before(body.ended);
      const pendingRequests = server.pendingRequests;
      server.stop(true);
      client.socket.resume();
      const { framing, body: received, endedBy } = await client.ending;
      expect({ ...state, pendingRequests, framing, whole: isWhole(received, sent), endedBy }).toEqual({
        ...endedAndNotDrained,
        // A reset on Windows drops the bytes that the client has not read, the header section with them.
        framing: isWindows ? expect.any(String) : "close",
        whole: false,
        endedBy: ["ECONNRESET"],
      });
    });

    // server.stop(true) closes the connections one after the other, and the abort listener of a request runs
    // before the next connection closes. A body that begins in that listener is cut by the same stop(true).
    it("server.stop(true), the body begins while it closes another connection", async () => {
      // Too large for the cork buffer: the bytes are on the socket before stop(true) closes it.
      const late = Buffer.alloc(64 * 1024, "a").toString();
      const controllers: Record<string, any> = {};
      const parked: Record<string, PromiseWithResolvers<void>> = {
        "/first": Promise.withResolvers(),
        "/second": Promise.withResolvers(),
      };
      let beganLate: string | undefined;
      using server = serve(false, {
        fetch(req) {
          const path = new URL(req.url).pathname;
          req.signal.addEventListener("abort", () => {
            if (beganLate) return;
            beganLate = path === "/first" ? "/second" : "/first";
            controllers[beganLate].write(late);
            controllers[beganLate].flush();
          });
          return new Response(
            new ReadableStream({
              type: "direct",
              pull(controller: any) {
                controllers[path] = controller;
                parked[path].resolve();
                return new Promise(() => {});
              },
            } as any),
          );
        },
      });
      using first = request(server.port!, { path: "/first" });
      await first.before(parked["/first"].promise);
      using second = request(server.port!, { path: "/second" });
      await second.before(parked["/second"].promise);
      server.stop(true);
      const endings: Record<string, { endedBy: string[] }> = {
        "/first": await first.ending,
        "/second": await second.ending,
      };
      expect({ beganLate: beganLate !== undefined, endedBy: endings[beganLate!]?.endedBy }).toEqual({
        beganLate: true,
        endedBy: ["ECONNRESET"],
      });
    });

    // The sink of the response has not seen close() yet: to the server the body is not complete.
    it("controller.close() and server.stop(true) in one call", async () => {
      const started = Promise.withResolvers<ReadableStreamDefaultController>();
      using server = serve(false, {
        fetch: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue("part 1 of 2\n");
                controller.enqueue("part 2 of 2\n");
                started.resolve(controller);
              },
            }),
          ),
      });
      using client = request(server.port!);
      const controller = await client.before(started.promise);
      await client.received("part 2 of 2\n");
      controller.close();
      server.stop(true);
      expect(await client.ending).toEqual({ ...cut, body: "part 1 of 2\npart 2 of 2\n" });
    });

    // A graceful stop leaves the connection to its reader, and a reader that never reads again to the idle timer.
    // The bytes have to wait in the server until the timer fires: one write holds more than the loopback buffers
    // of Linux and macOS take for a client that does not read. How much Windows takes depends on the machine.
    it.skipIf(isWindows)(
      "server.stop() and then the idle timer, the body has ended but has not drained",
      async () => {
        const body = endedBeforeDrained(Buffer.alloc(64 * megabyte.length, "a"));
        using server = serve(false, { idleTimeout: 1, fetch: () => new Response(body.stream) });
        using client = request(server.port!);
        client.socket.pause();
        const { sent, ...state } = await client.before(body.ended);
        const pendingRequests = server.pendingRequests;
        await server.stop();
        client.socket.resume();
        const { framing, body: received, endedBy } = await client.ending;
        expect({ ...state, pendingRequests, framing, whole: isWhole(received, sent), endedBy }).toEqual({
          ...endedAndNotDrained,
          framing: "close",
          whole: false,
          endedBy: ["ECONNRESET"],
        });
      },
      15_000,
    );
  });

  it.each(transports)("a graceful stop delivers a body that has ended but has not drained, %s", async (_, secure) => {
    const body = endedBeforeDrained();
    using server = serve(secure, { fetch: () => new Response(body.stream) });
    using client = request(server.port!, { secure });
    client.socket.pause();
    const { sent, ...state } = await client.before(body.ended);
    const pendingRequests = server.pendingRequests;
    const closedBySweep = server.closeIdleConnections();
    const stopped = server.stop();
    client.socket.resume();
    const { framing, body: received, endedBy } = await client.ending;
    await stopped;
    expect({ ...state, pendingRequests, closedBySweep, framing, whole: isWhole(received, sent), endedBy }).toEqual({
      ...endedAndNotDrained,
      closedBySweep: 0,
      framing: "close",
      whole: true,
      endedBy: ["end"],
    });
  });

  describe("an orderly end stays", () => {
    const whole = { framing: "close", body: "part 1 of 2\npart 2 of 2\n", endedBy: ["end"] };
    // A client of HTTP/1.1 sees that the last chunk is missing.
    const cutChunked = { framing: "chunked", body: "c\r\npart 1 of 2\n\r\n", endedBy: ["end"] };
    // A client counts the bytes of a body that has a Content-Length.
    const large = Buffer.alloc(16 * 1024 * 1024, "a").toString();
    const cutFile = { framing: "content-length", whole: false, endedBy: ["end"] };

    it.each(transports)("a whole body, %s", async (_, secure) => {
      const body = twoParts();
      using server = serve(secure, { fetch: () => new Response(body.stream) });
      using client = request(server.port!, { secure });
      await client.received("part 1 of 2\n");
      body.finish();
      expect(await client.ending).toEqual(whole);
    });

    it.each([
      ["server.stop(true)", (server: Bun.Server<undefined>) => void server.stop(true)],
      ["server.stop()", (server: Bun.Server<undefined>) => void server.stop()],
      ["server.closeIdleConnections()", (server: Bun.Server<undefined>) => void server.closeIdleConnections()],
    ] as const)("a whole body, then %s in the same call", async (_, stop) => {
      using server = serve(false, {
        fetch: () =>
          new Response(
            new ReadableStream({
              type: "direct",
              pull(controller: any) {
                controller.write("part 1 of 2\n");
                controller.flush();
                controller.write("part 2 of 2\n");
                controller.end();
                stop(server);
              },
            } as any),
          ),
      });
      using client = request(server.port!);
      expect(await client.ending).toEqual(whole);
    });

    it("controller.close(), then server.stop(true) from a microtask", async () => {
      const started = Promise.withResolvers<ReadableStreamDefaultController>();
      using server = serve(false, {
        fetch: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue("part 1 of 2\n");
                controller.enqueue("part 2 of 2\n");
                started.resolve(controller);
              },
            }),
          ),
      });
      using client = request(server.port!);
      const controller = await client.before(started.promise);
      await client.received("part 2 of 2\n");
      controller.close();
      queueMicrotask(() => void server.stop(true));
      expect(await client.ending).toEqual(whole);
    });

    it("a request without an answer that server.stop(true) cuts", async () => {
      const requested = Promise.withResolvers<void>();
      using server = serve(false, {
        fetch() {
          requested.resolve();
          return new Promise<Response>(() => {});
        },
      });
      using client = request(server.port!);
      await client.before(requested.promise);
      server.stop(true);
      expect(await client.ending).toEqual({ framing: "none", body: "", endedBy: ["end"] });
    });

    it("a file body that server.stop(true) cuts", async () => {
      using dir = tempDir("serve-cut-file-body", { "large.txt": large });
      using server = serve(false, { fetch: () => new Response(Bun.file(join(String(dir), "large.txt"))) });
      using client = request(server.port!);
      await client.received("a");
      client.socket.pause();
      server.stop(true);
      client.socket.resume();
      const { framing, body: received, endedBy } = await client.ending;
      expect({ framing, whole: received === large, endedBy }).toEqual(cutFile);
    });

    it.each(transports)(
      "a file body that the idle timer cuts, %s",
      async (_, secure) => {
        using dir = tempDir("serve-cut-file-body", { "large.txt": large });
        const aborted = Promise.withResolvers<void>();
        using server = serve(secure, {
          idleTimeout: 1,
          fetch(req) {
            req.signal.addEventListener("abort", () => aborted.resolve());
            return new Response(Bun.file(join(String(dir), "large.txt")));
          },
        });
        using client = request(server.port!, { secure });
        await client.received("a");
        client.socket.pause();
        await client.before(aborted.promise);
        client.socket.resume();
        const { framing, body: received, endedBy } = await client.ending;
        expect({ framing, whole: received === large, endedBy }).toEqual(cutFile);
      },
      15_000,
    );

    it("a chunked body that server.stop(true) cuts", async () => {
      const body = twoParts();
      using server = serve(false, { fetch: () => new Response(body.stream) });
      using client = request(server.port!, { version: "1.1" });
      await client.received("part 1 of 2\n");
      server.stop(true);
      expect(await client.ending).toEqual(cutChunked);
    });

    it("a chunked body that the idle timer cuts", async () => {
      const body = twoParts();
      using server = serve(false, { idleTimeout: 1, fetch: () => new Response(body.stream) });
      using client = request(server.port!, { version: "1.1" });
      expect(await client.ending).toEqual(cutChunked);
    }, 15_000);

    it.each(transports)(
      "an idle keep-alive connection that the idle timer closes, %s",
      async (_, secure) => {
        using server = serve(secure, { idleTimeout: 1, fetch: () => new Response("whole") });
        using client = request(server.port!, { version: "1.1", secure });
        expect(await client.ending).toEqual({ framing: "content-length", body: "whole", endedBy: ["end"] });
      },
      15_000,
    );
  });
});
