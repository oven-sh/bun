// Fetch-spec §4.1 step 12.3: "network error" rejects with a TypeError.
// Node/undici reject `TypeError('fetch failed', {cause: <original>})`, and
// the ecosystem (is-network-error, p-retry, ky, hand-rolled retry loops)
// classifies fetch network errors off `err.name === 'TypeError'` +
// `err.message === 'fetch failed'` + `err.cause?.code`.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";

function shape(e: any) {
  return {
    name: e?.name,
    isTypeError: e instanceof TypeError,
    message: e?.message,
    code: e?.code,
    cause:
      e?.cause == null
        ? e?.cause
        : {
            name: e.cause.name,
            isError: e.cause instanceof Error,
            message: e.cause.message,
            code: e.cause.code,
            syscall: e.cause.syscall,
            path: e.cause.path,
            hostname: e.cause.hostname,
          },
  };
}

async function freePort() {
  const s = net.createServer();
  await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as net.AddressInfo;
  await new Promise<void>(r => s.close(() => r()));
  return port;
}

describe("fetch network errors reject as TypeError('fetch failed') with a cause", () => {
  test("connection refused", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    let err: any;
    await fetch(url).catch(e => (err = e));
    expect(shape(err)).toEqual({
      name: "TypeError",
      isTypeError: true,
      message: "fetch failed",
      code: "ECONNREFUSED",
      cause: {
        name: "Error",
        isError: true,
        message: expect.any(String),
        code: "ECONNREFUSED",
        syscall: "connect",
        path: url,
        hostname: undefined,
      },
    });
  });

  test("socket closed before response headers", async () => {
    const server = net.createServer(socket => socket.destroy());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const url = `http://127.0.0.1:${port}/`;
    try {
      let err: any;
      await fetch(url).catch(e => (err = e));
      expect(shape(err)).toEqual({
        name: "TypeError",
        isTypeError: true,
        message: "fetch failed",
        code: "ECONNRESET",
        cause: {
          name: "Error",
          isError: true,
          message: expect.any(String),
          code: "ECONNRESET",
          syscall: undefined,
          path: url,
          hostname: undefined,
        },
      });
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("malformed HTTP response", async () => {
    const server = net.createServer(socket => socket.end("not http at all\r\n\r\n"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    const url = `http://127.0.0.1:${port}/`;
    try {
      let err: any;
      await fetch(url).catch(e => (err = e));
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toBe("fetch failed");
      expect(err.cause).toBeInstanceOf(Error);
      expect(err.cause.code).toBe(err.code);
      expect(typeof err.cause.code).toBe("string");
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("body truncated mid-read surfaces as TypeError with cause", async () => {
    const server = net.createServer(socket => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n" + Buffer.alloc(1000, "x").toString());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      let err: any;
      await res.text().catch(e => (err = e));
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toBe("fetch failed");
      expect(err.cause).toBeInstanceOf(Error);
      expect(err.cause.code).toBe("ECONNRESET");
      expect(err.code).toBe("ECONNRESET");
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // The published `is-network-error` predicate (the classifier under p-retry,
  // ky recipes, and many hand-rolled retry loops) keys on the TypeError name
  // plus a fixed set of messages. The connection-refused rejection must pass it.
  test("is-network-error classifies the connection-refused rejection", async () => {
    // Inlined from sindresorhus/is-network-error v1.1.0 (MIT).
    const errorMessages = new Set([
      "network error",
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "The Internet connection appears to be offline.",
      "Load failed",
      "Network request failed",
      "fetch failed",
      "terminated",
    ]);
    const isNetworkError = (error: unknown): boolean => {
      const isValid =
        error &&
        (error as Error) instanceof Error &&
        (error as Error).name === "TypeError" &&
        typeof (error as Error).message === "string";
      if (!isValid) return false;
      return errorMessages.has((error as Error).message);
    };

    const port = await freePort();
    let err: unknown;
    await fetch(`http://127.0.0.1:${port}/`).catch(e => (err = e));
    expect(isNetworkError(err)).toBe(true);
    expect((err as any).cause?.code).toBe("ECONNREFUSED");
  });
});
