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
      await res
        .clone()
        .arrayBuffer()
        .catch(() => {});

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
});
