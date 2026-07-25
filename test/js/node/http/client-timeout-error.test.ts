import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, get, request } from "node:http";
import net from "node:net";

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

  // The socket stays in the `connecting` state while the lookup callback is
  // withheld, which is observationally equivalent to a SYN that is never
  // acknowledged. Node.js arms the idle timer at socket creation, so the
  // 'timeout' event fires mid-connect; it must not be swallowed just because
  // the request headers are queued in _pendingData waiting for the handle.
  describe("fires while the socket is still connecting", () => {
    type Finish = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

    function stallingLookup(deferred: { finish?: Finish }) {
      return function lookup(_hostname: string, opts: unknown, cb?: Finish) {
        deferred.finish = typeof opts === "function" ? (opts as Finish) : cb!;
      };
    }

    it("options.timeout emits req 'timeout' before connect", async () => {
      const deferred: { finish?: Finish } = {};
      const req = get({
        host: "stalled.invalid",
        port: 1,
        path: "/",
        timeout: 100,
        agent: false,
        autoSelectFamily: false,
        lookup: stallingLookup(deferred),
      });
      req.on("error", () => {});
      try {
        await once(req, "timeout");
        expect(req.socket?.connecting).toBe(true);
      } finally {
        req.destroy();
        deferred.finish?.(new Error("aborted"), "", 0);
      }
    });

    it("socket.setTimeout() emits socket 'timeout' before connect", async () => {
      const deferred: { finish?: Finish } = {};
      const req = get({
        host: "stalled.invalid",
        port: 1,
        path: "/",
        agent: false,
        autoSelectFamily: false,
        lookup: stallingLookup(deferred),
      });
      req.on("error", () => {});
      const [socket] = await once(req, "socket");
      socket.setTimeout(100);
      try {
        await once(socket, "timeout");
        expect(socket.connecting).toBe(true);
      } finally {
        req.destroy();
        deferred.finish?.(new Error("aborted"), "", 0);
      }
    });

    it("net.Socket 'timeout' fires with a write buffered pre-connect", async () => {
      const deferred: { finish?: Finish } = {};
      const socket = net.connect({
        host: "stalled.invalid",
        port: 1,
        autoSelectFamily: false,
        lookup: stallingLookup(deferred),
      });
      socket.on("error", () => {});
      socket.write("GET / HTTP/1.1\r\n\r\n");
      socket.setTimeout(100);
      try {
        await once(socket, "timeout");
        expect(socket.connecting).toBe(true);
      } finally {
        socket.destroy();
        deferred.finish?.(new Error("aborted"), "", 0);
      }
    });
  });
});
