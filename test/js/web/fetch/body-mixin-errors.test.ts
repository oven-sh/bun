import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import net from "node:net";

describe("body-mixin-errors", () => {
  it.concurrent.each([
    ["Response", () => new Response("a"), (b: Response | Request) => b.text()],
    [
      "Request",
      () => new Request("https://example.com", { body: "{}", method: "POST" }),
      (b: Response | Request) => b.json(),
    ],
  ])("should throw TypeError when body already used on %s", async (type, createBody, secondCall) => {
    const body = createBody();
    await body.text();

    try {
      await secondCall(body);
      expect.unreachable("body is already used");
    } catch (err: any) {
      expect(err.name).toBe("TypeError");
      expect(err.message).toBe("Body already used");
      expect(err instanceof TypeError).toBe(true);
    }
  });

  // fetch spec: every network error is a TypeError, and once a body read has
  // started the body's stream is disturbed regardless of how the read ends.
  // Server announces Content-Length: 100000 but only ever sends 1000 bytes
  // then closes, so the body read is guaranteed to fail.
  async function withTruncatedBodyServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const body = Buffer.alloc(1000, "x").toString();
    const server = net.createServer(socket => {
      // Drain the inbound request so 'end' can fire once the client closes;
      // otherwise server.close() below waits on a paused socket with buffered
      // data forever (Node behaves the same way).
      socket.resume();
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100000\r\n\r\n${body}`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${port}/`);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  function expectBodyAlreadyUsed(err: unknown) {
    expect(err).toBeInstanceOf(TypeError);
    expect((err as any).code).toBe("ERR_BODY_ALREADY_USED");
    expect((err as Error).message).toBe("Body already used");
  }

  it.concurrent("fetch: truncated body read rejects with TypeError and marks body used", async () => {
    await withTruncatedBodyServer(async url => {
      const res = await fetch(url);
      expect(res.bodyUsed).toBe(false);

      let firstErr: unknown;
      await res.text().catch(e => (firstErr = e));
      expect(firstErr).toBeInstanceOf(TypeError);
      expect((firstErr as any).code).toBe("ECONNRESET");

      expect(res.bodyUsed).toBe(true);

      let secondErr: unknown;
      await res.text().catch(e => (secondErr = e));
      expectBodyAlreadyUsed(secondErr);
    });
  });

  it.concurrent("fetch: body that failed before any reader call is still consumed by the first read", async () => {
    await withTruncatedBodyServer(async url => {
      const res = await fetch(url);
      // Force the download to run to its (truncated) end before we ever call
      // a reader: arrayBuffer() on a clone drains the underlying connection.
      await expect(res.clone().arrayBuffer()).rejects.toThrow(TypeError);

      expect(res.bodyUsed).toBe(false);

      let firstErr: unknown;
      await res.text().catch(e => (firstErr = e));
      expect(firstErr).toBeInstanceOf(TypeError);

      expect(res.bodyUsed).toBe(true);

      let secondErr: unknown;
      await res.text().catch(e => (secondErr = e));
      expectBodyAlreadyUsed(secondErr);
    });
  });

  it.concurrent("fetch: reading .body directly marks body used when the stream errors", async () => {
    await withTruncatedBodyServer(async url => {
      const res = await fetch(url);
      const reader = res.body!.getReader();
      let firstErr: unknown;
      try {
        while (!(await reader.read()).done) {}
      } catch (e) {
        firstErr = e;
      }
      expect(firstErr).toBeInstanceOf(TypeError);

      expect(res.bodyUsed).toBe(true);

      let secondErr: unknown;
      await res.text().catch(e => (secondErr = e));
      expectBodyAlreadyUsed(secondErr);
    });
  });

  // The body can also have failed before anything reads it: here the whole response arrives at
  // once and its body does not decode, so the Response is created with the failure already in
  // hand. `.body` then has to be the body's stream all the same: the same stream each time, read
  // once it counts as used, and the readers see "already used" afterwards instead of the
  // network error again.
  async function withUndecodableBodyServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const server = net.createServer(socket => {
      socket.resume();
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 16\r\nConnection: close\r\n\r\nthis is not gzip",
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${port}/`);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  it.concurrent("fetch: .body of a body that failed before it was read is still the body", async () => {
    await withUndecodableBodyServer(async url => {
      const res = await fetch(url);
      const body = res.body!;
      expect(res.body).toBe(body);
      expect(res.bodyUsed).toBe(false);

      let firstErr: unknown;
      await body
        .getReader()
        .read()
        .catch(e => (firstErr = e));
      expect(firstErr).toBeInstanceOf(TypeError);
      expect(res.bodyUsed).toBe(true);

      let secondErr: unknown;
      await res.text().catch(e => (secondErr = e));
      expectBodyAlreadyUsed(secondErr);
    });
  });

  // textStream() is one shot: handing it out uses the body up, failed or not.
  it.concurrent("fetch: textStream() of a body that failed before it was read uses the body up", async () => {
    await withUndecodableBodyServer(async url => {
      const res = await fetch(url);
      expect(res.bodyUsed).toBe(false);

      let firstErr: unknown;
      await res
        .textStream()
        .getReader()
        .read()
        .catch(e => (firstErr = e));
      expect(firstErr).toBeInstanceOf(TypeError);
      expect(res.bodyUsed).toBe(true);

      expect(() => res.textStream()).toThrow(TypeError);
    });
  });

  it.concurrent.each(["arrayBuffer", "bytes", "blob", "json"] as const)(
    "fetch: truncated body %s() marks body used",
    async method => {
      await withTruncatedBodyServer(async url => {
        const res = await fetch(url);

        let firstErr: unknown;
        await (res as any)[method]().catch((e: unknown) => (firstErr = e));
        expect(firstErr).toBeInstanceOf(TypeError);

        expect(res.bodyUsed).toBe(true);

        let secondErr: unknown;
        await res.text().catch(e => (secondErr = e));
        expectBodyAlreadyUsed(secondErr);
      });
    },
  );

  // Counts inbound TCP connections on a server that answers a chunked POST
  // once it sees the 0\r\n\r\n terminator. `expectConnections(n)` first sends
  // a probe request so every accept queued before it has been delivered by the
  // time the response arrives, then asserts the total (including the probe).
  async function withConnectionCountingServer(
    fn: (ctx: {
      url: string;
      makeBody: () => ReadableStream;
      expectConnections: (n: number) => Promise<void>;
    }) => Promise<void>,
  ): Promise<void> {
    let connections = 0;
    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => {
      connections++;
      sockets.push(socket);
      let buf = Buffer.alloc(0);
      socket.on("data", d => {
        buf = Buffer.concat([buf, d]);
        if (buf.toString("latin1").endsWith("\r\n0\r\n\r\n")) {
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const url = `http://127.0.0.1:${port}/up`;
    const makeBody = () =>
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("hello"));
          c.close();
        },
      });
    try {
      await fn({
        url,
        makeBody,
        expectConnections: async n => {
          const probe = await fetch(url, { method: "POST", body: makeBody(), duplex: "half" } as RequestInit);
          expect(probe.status).toBe(200);
          expect(connections).toBe(n);
        },
      });
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  it.concurrent(
    "fetch: re-fetching a Request whose stream body was consumed rejects before any network I/O",
    async () => {
      await withConnectionCountingServer(async ({ url, makeBody, expectConnections }) => {
        const req = new Request(url, { method: "POST", body: makeBody(), duplex: "half" } as RequestInit);

        const first = await fetch(req);
        expect(first.status).toBe(200);
        expect(req.bodyUsed).toBe(true);

        const errors: unknown[] = [];
        for (let i = 0; i < 3; i++) {
          await fetch(req).then(
            () => errors.push(null),
            e => errors.push(e),
          );
        }

        // First fetch + probe only. The three re-fetches must not have opened
        // connections or written request heads to the origin.
        await expectConnections(2);

        expect(errors).toHaveLength(3);
        for (const e of errors) {
          expect(e).toBeInstanceOf(TypeError);
          expect((e as any).code).toBe("ERR_BODY_ALREADY_USED");
        }
      });
    },
  );

  it.concurrent("fetch: Request with a locked stream body rejects before any network I/O", async () => {
    await withConnectionCountingServer(async ({ url, makeBody, expectConnections }) => {
      const req = new Request(url, { method: "POST", body: makeBody(), duplex: "half" } as RequestInit);
      // Lock the stream without disturbing it.
      req.body!.getReader();
      expect(req.bodyUsed).toBe(false);

      let err: unknown;
      await fetch(req).then(
        () => expect.unreachable("fetch should reject for a locked body"),
        e => (err = e),
      );

      // Probe only. The rejected fetch must not have opened a connection.
      await expectConnections(1);

      expect(err).toBeInstanceOf(TypeError);
      expect((err as any).code).toBe("ERR_BODY_ALREADY_USED");
    });
  });
});
