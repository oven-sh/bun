// https://github.com/oven-sh/bun/issues/27275
//
// When fetch() is given a `tls.checkServerIdentity` callback, the HTTP client
// sends an intermediate progress update carrying the certificate info before
// response headers arrive. If the connection then fails (e.g. the server
// closes the socket after the TLS handshake without sending a response —
// common when an mTLS server rejects a client that didn't present a cert),
// `onProgressUpdate` would run `checkServerIdentity`, see it pass, notice
// `metadata == null`, and early-return *without* rejecting the promise.
// Because `is_done == true`, the FetchTasklet was then deref'd and the abort
// listener detached — so the fetch promise hung forever and `AbortController
// .abort()` became a no-op.

import { expect, test } from "bun:test";
import { tls as cert } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import tls from "node:tls";

test("fetch with checkServerIdentity rejects when connection closes before response headers", async () => {
  // TLS server that completes the handshake, receives the request, and then
  // immediately closes the socket without sending any HTTP response.
  const server = tls.createServer({ key: cert.key, cert: cert.cert }, socket => {
    socket.once("data", () => socket.destroy());
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    let checkServerIdentityCalled = false;
    let err: unknown;
    try {
      await fetch(`https://localhost:${port}/`, {
        tls: {
          ca: cert.cert,
          checkServerIdentity() {
            checkServerIdentityCalled = true;
            return undefined;
          },
        },
      });
    } catch (e) {
      err = e;
    }

    // Before the fix, the `await fetch(...)` above never settled and the test
    // hit the default timeout.
    expect(checkServerIdentityCalled).toBe(true);
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).toBe("ECONNRESET");
  } finally {
    server.close();
  }
});

test("fetch with checkServerIdentity + AbortSignal rejects when connection closes before response headers", async () => {
  // Same scenario, but with an abort signal attached. Before the fix, abort()
  // fired the DOM event on the signal but the fetch promise still hung because
  // the FetchTasklet had already been torn down.
  const server = tls.createServer({ key: cert.key, cert: cert.cert }, socket => {
    socket.once("data", () => socket.destroy());
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const controller = new AbortController();
    const { promise: aborted, resolve: onAbort } = Promise.withResolvers<void>();
    controller.signal.addEventListener("abort", () => onAbort());

    let err: unknown;
    try {
      await fetch(`https://localhost:${port}/`, {
        signal: controller.signal,
        tls: {
          ca: cert.cert,
          checkServerIdentity: () => undefined,
        },
      });
    } catch (e) {
      err = e;
    }

    // The fetch should have rejected with the underlying connection error
    // *before* we ever needed to abort.
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).toBe("ECONNRESET");

    // Abort is now a no-op (promise already settled), but it must not throw
    // and the signal's abort event still fires normally.
    controller.abort();
    await aborted;
  } finally {
    server.close();
  }
});
