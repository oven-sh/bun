/**
 * Regression coverage for https://github.com/oven-sh/bun/issues/31476
 *
 * Aborting an in-flight `http.ClientRequest` before the response headers arrive
 * must emit an 'error' event ("socket hang up" / ECONNRESET), matching Node.js.
 *
 * These tests are written to also pass on Node.js.
 */
import { describe, expect, it } from "bun:test";
import { createServer, get, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("aborting an in-flight http client request", () => {
  it("emits 'error' with 'socket hang up' (ECONNRESET) when aborted before the response", async () => {
    // The server receives the request but never responds, so the abort happens
    // while the request is in-flight and before any response headers arrive.
    const { promise: gotRequest, resolve: onRequest } = Promise.withResolvers<void>();
    await using server = createServer(() => {
      onRequest();
    });
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = get({ port, host: "127.0.0.1" }, res => {
      res.resume();
    });
    req.on("error", onError);

    await gotRequest;
    req.abort();

    const err = await gotError;
    expect(err.message).toBe("socket hang up");
    expect((err as NodeJS.ErrnoException).code).toBe("ECONNRESET");
  });

  it("emits 'error' with 'socket hang up' when destroyed with no error before the response", async () => {
    const { promise: gotRequest, resolve: onRequest } = Promise.withResolvers<void>();
    await using server = createServer(() => {
      onRequest();
    });
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = get({ port, host: "127.0.0.1" }, res => {
      res.resume();
    });
    req.on("error", onError);

    await gotRequest;
    req.destroy();

    const err = await gotError;
    expect(err.message).toBe("socket hang up");
    expect((err as NodeJS.ErrnoException).code).toBe("ECONNRESET");
  });

  it("emits the error passed to req.destroy(err) when aborted before the response", async () => {
    const { promise: gotRequest, resolve: onRequest } = Promise.withResolvers<void>();
    await using server = createServer(() => {
      onRequest();
    });
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = get({ port, host: "127.0.0.1" }, res => {
      res.resume();
    });
    req.on("error", onError);

    await gotRequest;
    const custom = new Error("custom boom");
    req.destroy(custom);

    const err = await gotError;
    expect(err).toBe(custom);
  });

  it("does not emit 'error' when aborted before the request is sent", async () => {
    await using server = createServer(() => {
      throw new Error("server should not receive a request");
    });
    const port = await listen(server);

    const req = request({ method: "GET", host: "127.0.0.1", port });
    let errored = false;
    req.on("error", () => {
      errored = true;
    });

    const { promise: aborted, resolve: onAbort } = Promise.withResolvers<void>();
    req.on("abort", () => onAbort());

    // Abort before end() is ever called: the request is never dispatched, so
    // it fires 'abort' but must not surface a synthetic 'socket hang up' error.
    req.abort();
    req.end();

    await aborted;
    // Give any stray 'error' a chance to surface before asserting none did.
    await new Promise(resolve => setImmediate(resolve));
    expect(errored).toBe(false);
  });

  it("does not emit a second 'error' when destroy() is called from the error handler", async () => {
    // A real connection error (ECONNREFUSED) must surface exactly once. If the
    // user's error handler calls req.destroy() (a common cleanup pattern), the
    // socket-close handler must not emit a second, synthetic 'socket hang up'.
    // Find a port that nothing is listening on by opening then closing a server.
    const probe = createServer();
    const port = await listen(probe);
    await new Promise<void>(resolve => probe.close(() => resolve()));

    const errors: Array<NodeJS.ErrnoException> = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();

    const req = request({ method: "GET", host: "127.0.0.1", port });
    req.on("error", err => {
      errors.push(err as NodeJS.ErrnoException);
      req.destroy();
    });
    req.on("close", () => onClose());
    req.end();

    await closed;
    // Let any (incorrect) extra error settle before asserting.
    await new Promise(resolve => setImmediate(resolve));

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("ECONNREFUSED");
  });

  it("surfaces the error from destroy(err) called in the same tick as end()", async () => {
    // Node's Writable.destroy(err) always delivers the caller's error, even if
    // the request was destroyed before the 'socket' event fired.
    await using server = createServer(() => {});
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = request({ method: "GET", host: "127.0.0.1", port });
    req.on("error", onError);

    req.end();
    req.destroy(new Error("boom")); // same tick, before 'socket' is emitted

    const err = await gotError;
    expect(err.message).toBe("boom");
  });

  it("surfaces the error from destroy(err) called before the request is dispatched", async () => {
    // destroy(err) before end()/write()/flushHeaders() — the request never
    // got an AbortController, but Node still delivers the caller's error.
    await using server = createServer(() => {});
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = request({ method: "GET", host: "127.0.0.1", port });
    req.on("error", onError);

    req.destroy(new Error("boom")); // no end()/write() first

    const err = await gotError;
    expect(err.message).toBe("boom");
  });

  it("emits a single error when aborted while a custom lookup is pending", async () => {
    // With a slow custom options.lookup, destroying the request before the
    // lookup resolves must emit exactly one 'error' (socket hang up). The stale
    // lookup callback must not add a second error, matching Node.
    await using server = createServer(() => {});
    const port = await listen(server);

    const errors: Array<NodeJS.ErrnoException> = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    const { promise: lookupCalled, resolve: onLookupCalled } = Promise.withResolvers<void>();
    let pendingLookupCb: ((err: Error) => void) | undefined;

    const req = get({
      host: "example.com",
      port,
      lookup(_host: string, _opts: unknown, cb: (err: Error) => void) {
        // Capture the callback and drive it explicitly after the request has
        // been destroyed, so the test is event-driven rather than timing-based.
        pendingLookupCb = cb;
        onLookupCalled();
      },
    } as any);
    req.on("error", err => errors.push(err as NodeJS.ErrnoException));
    req.on("close", () => onClose());
    req.on("socket", () => req.destroy());

    await lookupCalled;
    await closed;
    // Resolve the lookup only now, after the request has been torn down.
    pendingLookupCb?.(new Error("slow DNS failed"));
    await new Promise(resolve => setImmediate(resolve));

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("ECONNRESET");
  });

  it("surfaces the error from destroy(err) called after the response arrives", async () => {
    // The response headers have arrived (this.res is set) but the body has not
    // finished. Node's Writable.destroy(err) still emits the caller's error on
    // the request, before 'close'.
    await using server = createServer((_req, res) => {
      res.writeHead(200);
      res.write("partial"); // keep the response open
    });
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = get({ host: "127.0.0.1", port }, res => {
      res.on("error", () => {}); // swallow the response-side reset
      req.destroy(new Error("boom"));
    });
    req.on("error", onError);

    const err = await gotError;
    expect(err.message).toBe("boom");
  });

  it("emits a single error when all custom-lookup addresses fail to connect", async () => {
    // With a custom options.lookup resolving to an address nothing listens on,
    // the happy-eyeballs iterate()/fail() path must emit exactly one 'error',
    // not one from the failed connection plus a second synthetic ECONNREFUSED.
    const probe = createServer();
    const probePort = await listen(probe);
    await new Promise<void>(resolve => probe.close(() => resolve()));

    const errors: Array<NodeJS.ErrnoException> = [];
    const { promise: errored, resolve: onErrored } = Promise.withResolvers<void>();

    const req = get({
      host: "example.com",
      port: probePort,
      lookup(_host: string, _opts: unknown, cb: (err: Error | null, addrs: unknown) => void) {
        cb(null, [{ address: "127.0.0.1", family: 4 }]);
      },
    } as any);
    req.on("error", err => {
      errors.push(err as NodeJS.ErrnoException);
      onErrored();
    });

    await errored;
    // Let any (incorrect) second error settle before asserting.
    await new Promise(resolve => setImmediate(resolve));

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("ECONNREFUSED");
  });

  it("surfaces the error passed to socket.destroy(err) before the response", async () => {
    // socket.destroy(err) forwards the caller's error to the request, like
    // Node (socket 'error' -> req.emit('error', err)), not a synthetic hang-up.
    await using server = createServer(() => {});
    const port = await listen(server);

    const { promise: gotError, resolve: onError } = Promise.withResolvers<Error>();
    const req = get({ host: "127.0.0.1", port });
    req.on("error", onError);
    req.on("socket", socket => {
      socket.destroy(new Error("boom"));
    });

    const err = await gotError;
    expect(err.message).toBe("boom");
  });
});
