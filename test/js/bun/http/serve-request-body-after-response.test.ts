import { describe, expect, it } from "bun:test";
import net from "node:net";

// A request body that is still arriving when the response finishes must keep
// being delivered to whoever started reading it. Bun used to reject the pending
// read with "AbortError: The connection was closed." even though the client was
// still happily sending on a live keep-alive connection, silently losing the
// upload of every "respond 202 now, ingest in the background" handler.
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
    let pending: { count: number; resolve: () => void } | null = null;
    const responseCount = () => (buffer.match(/HTTP\/1\.1 \d{3}/g) || []).length;
    socket.on("data", chunk => {
      buffer += chunk;
      if (pending && responseCount() >= pending.count) {
        const { resolve } = pending;
        pending = null;
        resolve();
      }
    });
    socket.on("error", () => {});
    return {
      connected: new Promise<void>(resolve => socket.on("connect", () => resolve())),
      write: (data: string) => socket.write(data),
      waitForResponses(count: number) {
        if (responseCount() >= count) return Promise.resolve();
        const { promise, resolve } = Promise.withResolvers<void>();
        pending = { count, resolve };
        return promise;
      },
      destroy: () => socket.destroy(),
      [Symbol.dispose]: () => socket.destroy(),
    };
  }

  function serveReadingBodyLate(read: (req: Request) => Promise<string>) {
    const body = Promise.withResolvers<string>();
    const handlerRan = Promise.withResolvers<{ abortedDuringHandler: boolean }>();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname !== "/late") return new Response("next");
        // Start reading, then answer before the body has been consumed.
        read(req).then(body.resolve, err => body.resolve(`${err.name}: ${err.message}`));
        handlerRan.resolve({ abortedDuringHandler: req.signal.aborted });
        return new Response("early");
      },
    });
    return { server, body: body.promise, handlerRan: handlerRan.promise };
  }

  it("resolves req.text() when the body arrives in the same packet as the headers", async () => {
    const { server, body, handlerRan } = serveReadingBodyLate(req => req.text());
    using _ = server;
    using client = rawClient(server.port);
    await client.connected;

    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nHELLO-WORLD!");

    expect(await body).toBe("HELLO-WORLD!");
    expect(await handlerRan).toEqual({ abortedDuringHandler: false });

    // The connection is still usable: the next keep-alive request is served.
    await client.waitForResponses(1);
    client.write("GET /next HTTP/1.1\r\nHost: x\r\n\r\n");
    await client.waitForResponses(2);

    // Outliving the response must not outlive the body: the request is released
    // once the last chunk is delivered.
    await waitForPendingRequests(server, 0);
  });

  it("resolves req.text() when the body arrives after the response was sent", async () => {
    const { server, body, handlerRan } = serveReadingBodyLate(req => req.text());
    using _ = server;
    using client = rawClient(server.port);
    await client.connected;

    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\n");
    await handlerRan;
    await client.waitForResponses(1);
    client.write("HELLO-WORLD!");

    expect(await body).toBe("HELLO-WORLD!");
  });

  it("delivers a streamed req.body after the response was sent", async () => {
    const { server, body } = serveReadingBodyLate(async req => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req.body!) chunks.push(chunk);
      return Buffer.concat(chunks).toString();
    });
    using _ = server;
    using client = rawClient(server.port);
    await client.connected;

    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nHELLO-WORLD!");

    expect(await body).toBe("HELLO-WORLD!");
  });

  it("still rejects the pending body read when the client disconnects mid-upload", async () => {
    const { server, body, handlerRan } = serveReadingBodyLate(req => req.text());
    using _ = server;
    const client = rawClient(server.port);
    await client.connected;

    // Promise a 12 byte body, send 5, then vanish.
    client.write("POST /late HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\n\r\nHELLO");
    await handlerRan;
    await client.waitForResponses(1);
    client.destroy();

    expect(await body).toBe("AbortError: The connection was closed.");
    await waitForPendingRequests(server, 0);
  });
});
