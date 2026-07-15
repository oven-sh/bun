import { describe, expect, it } from "bun:test";
import net from "node:net";

// A handler that starts reading the body but responds early must still receive
// the rest of it, not a spurious AbortError, while the client keeps uploading
// on a live keep-alive connection ("respond 202 now, ingest in the background").
describe("request body outliving the response", () => {
  // The parked request is released from inside a uws callback, which can run
  // after the microtask that settles the body promise; poll rather than assume
  // the counter already dropped.
  async function waitForPendingRequests(server: ReturnType<typeof Bun.serve>, expected: number) {
    for (let i = 0; i < 100; i++) {
      if (server.pendingRequests === expected) return;
      await Bun.sleep(10);
    }
    throw new Error(`Timed out waiting for pendingRequests === ${expected}; got ${server.pendingRequests}`);
  }

  function rawClient(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    let buffer = "";
    let expected = 0;
    let pending: { resolve: () => void; reject: (err: Error) => void } | null = null;
    let closedByUs = false;
    const responseCount = () => (buffer.match(/HTTP\/1\.1 \d{3}/g) || []).length;

    // A waiter that only ever resolves turns a server-side regression into an
    // opaque test timeout; settle it on every way the socket can fail too.
    const settle = (err?: Error) => {
      if (!pending) return;
      const { resolve, reject } = pending;
      pending = null;
      if (err) reject(err);
      else resolve();
    };
    socket.on("data", chunk => {
      buffer += chunk;
      if (responseCount() >= expected) settle();
    });
    const fail = (err: Error) => {
      if (!closedByUs) settle(err);
    };
    socket.on("error", err => fail(err));
    socket.on("close", () => fail(new Error(`socket closed after ${responseCount()} response(s)`)));

    const destroy = () => {
      closedByUs = true;
      socket.destroy();
    };
    return {
      connected: new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("error", reject);
      }),
      write: (data: string) => socket.write(data),
      waitForResponses(count: number) {
        if (responseCount() >= count) return Promise.resolve();
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        expected = count;
        pending = { resolve, reject };
        return promise;
      },
      destroy,
      [Symbol.dispose]: destroy,
    };
  }

  // Distinct parking paths: sync `try_end()`, async `try_end()` (after
  // `to_async()` has armed the abort handler), and streaming `end_stream()`.
  type Shape = "sync" | "async" | "streaming-response";
  const shapes: Shape[] = ["sync", "async", "streaming-response"];

  function serveReadingBodyLate(shape: Shape, read: (req: Request) => Promise<string> = req => req.text()) {
    const body = Promise.withResolvers<string>();
    const responded = Promise.withResolvers<{ abortedDuringHandler: boolean }>();

    // Start reading the body, then answer before it has been consumed.
    const startReading = (req: Request) => {
      read(req).then(body.resolve, (err: Error) => body.resolve(`${err.name}: ${err.message}`));
      return { abortedDuringHandler: req.signal.aborted };
    };
    const early = () => new Response("early");
    const earlyStream = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("early"));
            controller.close();
          },
        }),
      );

    const syncFetch = (req: Request) => {
      if (new URL(req.url).pathname !== "/late") return new Response("next");
      responded.resolve(startReading(req));
      return early();
    };
    const asyncFetch = async (req: Request) => {
      if (new URL(req.url).pathname !== "/late") return new Response("next");
      const state = startReading(req);
      // Resume on a later loop turn so the response renders after `to_async()`.
      await new Promise<void>(resolve => setImmediate(resolve));
      responded.resolve(state);
      return shape === "streaming-response" ? earlyStream() : early();
    };

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: shape === "sync" ? syncFetch : asyncFetch,
    });
    return { server, body: body.promise, responded: responded.promise };
  }

  describe.each(shapes)("%s handler", shape => {
    it("delivers a body that arrives after the response was sent", async () => {
      const { server, body, responded } = serveReadingBodyLate(shape);
      using _ = server;
      using client = rawClient(server.port);
      await client.connected;

      client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\n");
      expect(await responded).toEqual({ abortedDuringHandler: false });
      await client.waitForResponses(1);
      client.write("HELLO-WORLD!");

      expect(await body).toBe("HELLO-WORLD!");
      await waitForPendingRequests(server, 0);
    });

    it("rejects the pending body read when the client disconnects mid-upload", async () => {
      const { server, body, responded } = serveReadingBodyLate(shape);
      using _ = server;
      const client = rawClient(server.port);
      await client.connected;

      // Promise a 12 byte body, send 5, then vanish.
      client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nHELLO");
      await responded;
      await client.waitForResponses(1);
      client.destroy();

      expect(await body).toBe("AbortError: The connection was closed.");
      // The read settling is not enough: the parked context must be released too.
      await waitForPendingRequests(server, 0);
    });
  });

  it("resolves req.text() when the body arrives in the same packet as the headers", async () => {
    const { server, body, responded } = serveReadingBodyLate("sync");
    using _ = server;
    using client = rawClient(server.port);
    await client.connected;

    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nHELLO-WORLD!");

    expect(await body).toBe("HELLO-WORLD!");
    expect(await responded).toEqual({ abortedDuringHandler: false });

    // The connection is still usable: the next keep-alive request is served.
    await client.waitForResponses(1);
    client.write("GET /next HTTP/1.1\r\nHost: x\r\n\r\n");
    await client.waitForResponses(2);

    // Outliving the response must not outlive the body: the request is released
    // once the last chunk is delivered.
    await waitForPendingRequests(server, 0);
  });

  it("delivers a streamed req.body after the response was sent", async () => {
    const { server, body, responded } = serveReadingBodyLate("async", async req => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req.body!) chunks.push(chunk);
      return Buffer.concat(chunks).toString();
    });
    using _ = server;
    using client = rawClient(server.port);
    await client.connected;

    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\n");
    await responded;
    await client.waitForResponses(1);
    client.write("HELLO-WORLD!");

    expect(await body).toBe("HELLO-WORLD!");
    await waitForPendingRequests(server, 0);
  });
});
