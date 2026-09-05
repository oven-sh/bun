import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";
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

  // A connected peer that has stopped reading: the kernel send and receive
  // buffers fill, the rest of the write sits in the handle's native queue, and
  // getBufferedAmount() stays nonzero. Node's _onTimeout heuristic suppresses
  // 'timeout' only while that queue is still *draining* (writeQueueSize moved
  // since the last check), re-arming each time; once it stalls it emits. The
  // old `if (getBufferedAmount(handle) > 0) return` dropped the one-shot timer
  // with no re-arm, so 'timeout' was lost for good.
  //
  // One 64 MiB chunk is far above any POSIX loopback socket-buffer capacity
  // (Linux defaults cap at 4 MiB send + 6 MiB receive), so the native queue
  // can never drain. A smaller write can fit in the kernel outright, and then
  // the old guard never triggers. Windows is skipped: winsock takes the whole
  // non-blocking send() into the kernel (all 64 MiB on loopback in CI), so the
  // write never goes async and the queue under test is never populated.
  it.skipIf(isWindows)(
    "net.Socket 'timeout' fires when a connected write is stalled by a non-reading peer",
    async () => {
      const accepted: net.Socket[] = [];
      const server = net.createServer(s => {
        accepted.push(s);
        s.on("error", () => {});
        s.pause();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;

      const socket = net.connect({ host: "127.0.0.1", port });
      socket.on("error", () => {});
      try {
        await once(socket, "connect");
        let writeComplete = false;
        expect(socket.write(Buffer.alloc(64 << 20), () => (writeComplete = true))).toBe(false);
        expect(socket.writableLength).toBeGreaterThan(0);

        socket.setTimeout(200);
        await once(socket, "timeout");
        expect(writeComplete).toBe(false);
        expect(socket.connecting).toBe(false);
      } finally {
        socket.destroy();
        for (const s of accepted) s.destroy();
        server.close();
      }
    },
  );
});
