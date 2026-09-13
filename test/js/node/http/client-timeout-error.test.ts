import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";

describe("node:http client timeout", () => {
  it("should emit timeout event when timeout is reached", async () => {
    const server = createServer((req, res) => {
      // Intentionally not sending response to trigger timeout
    }).listen(0);

    try {
      await once(server, "listening");
      const port = (server.address() as any).port;

      const req = request({
        port,
        host: "localhost",
        path: "/",
        timeout: 50, // Set a short timeout
      });

      const { promise: timedOut, resolve: onTimeout } = Promise.withResolvers<void>();
      const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
      let closeCalled = false;

      req.on("timeout", () => {
        onTimeout();
      });

      req.on("close", () => {
        closeCalled = true;
        onClose();
      });
      // Destroying an in-flight request surfaces ECONNRESET ("socket hang
      // up") on the request, exactly like Node.js.
      req.on("error", () => {});

      req.end();

      await timedOut;

      // Like Node.js, the timeout event does not destroy the request; the
      // caller is responsible for aborting it.
      expect(closeCalled).toBe(false);
      expect(req.destroyed).toBe(false);

      req.destroy();
      await closed;
      expect(req.destroyed).toBe(true);
    } finally {
      server.close();
    }
  });

  // The `timeout` option must also cover the connect phase, not just an idle
  // connected socket. `ClientRequest` delegates to the socket's idle timer, and
  // that timer was being suppressed while connecting because `end()` had already
  // queued the request head — so a request to an unreachable peer hung until the
  // OS gave up on the TCP connect. TEST-NET-1 (RFC 5737) drops packets rather
  // than refusing them, which holds the socket in the connecting state.
  it("should emit timeout while the socket is still connecting", async () => {
    const req = request({
      host: "192.0.2.1", // TEST-NET-1: no route, connect never completes
      port: 80,
      path: "/",
      timeout: 100,
    });

    const { promise: timedOut, resolve: onTimeout } = Promise.withResolvers<boolean>();
    let socket: import("node:net").Socket | undefined;
    req.on("socket", s => {
      socket = s;
    });
    // Capture the socket state at the moment it fires: `timeout` is also emitted
    // for an idle CONNECTED socket (the first test in this file), so without this
    // the case could regress to the idle path and still pass.
    req.on("timeout", () => onTimeout(socket?.connecting === true));
    req.on("error", () => {});
    req.end();

    try {
      const outcome = await Promise.race([
        timedOut.then(stillConnecting => ({ outcome: "timeout", stillConnecting })),
        Bun.sleep(2000).then(() => ({ outcome: "no timeout within 2000ms", stillConnecting: false })),
      ]);
      expect(outcome).toEqual({ outcome: "timeout", stillConnecting: true });
    } finally {
      req.destroy();
    }
  });

  it("should clear timeout when explicitly set to 0", async () => {
    const server = createServer((req, res) => {
      res.end("OK");
    }).listen(0);

    try {
      await once(server, "listening");
      const port = (server.address() as any).port;

      const req = request({
        port,
        host: "localhost",
        path: "/",
      });

      let timeoutEventEmitted = false;
      req.on("timeout", () => {
        timeoutEventEmitted = true;
      });

      // Set and then clear timeout
      req.setTimeout(50);
      req.setTimeout(0);

      req.end();

      const [res] = await once(req, "response");
      res.resume();
      await once(res, "end");

      // Wait longer than the original timeout to make sure it never fires.
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(timeoutEventEmitted).toBe(false);
    } finally {
      server.close();
    }
  });
});
