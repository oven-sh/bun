import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

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

  // The peer accepts the TCP connection and never answers the ClientHello. The
  // bytes the client wrote stay queued in the handle behind the handshake, so
  // the queue is not empty and does not move.
  describe("when the TLS handshake stalls", () => {
    const IDLE = 100;

    async function listenWithoutTLS() {
      const peers: net.Socket[] = [];
      const server = net.createServer(peer => {
        peers.push(peer);
        peer.on("error", () => {});
        peer.resume();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return {
        port: (server.address() as net.AddressInfo).port,
        [Symbol.dispose]() {
          for (const peer of peers) peer.destroy();
          server.close();
        },
      };
    }

    it("https.request({ timeout }) emits 'timeout'", async () => {
      using server = await listenWithoutTLS();
      const req = https.request({ host: "127.0.0.1", port: server.port, timeout: IDLE });
      req.on("error", () => {});
      let handshakeCompleted = false;
      req.on("socket", socket => socket.on("secureConnect", () => (handshakeCompleted = true)));
      try {
        req.end();
        await once(req, "timeout");
        expect({ connecting: req.socket!.connecting, handshakeCompleted }).toEqual({
          connecting: false,
          handshakeCompleted: false,
        });
      } finally {
        req.destroy();
      }
    });

    it("tls.connect() with a queued write emits 'timeout'", async () => {
      using server = await listenWithoutTLS();
      const socket = tls.connect({ host: "127.0.0.1", port: server.port });
      socket.on("error", () => {});
      let handshakeCompleted = false;
      socket.on("secureConnect", () => (handshakeCompleted = true));
      try {
        await once(socket, "connect");
        socket.write("GET / HTTP/1.1\r\nHost: example\r\n\r\n");
        socket.setTimeout(IDLE);
        await once(socket, "timeout");
        expect({ connecting: socket.connecting, handshakeCompleted }).toEqual({
          connecting: false,
          handshakeCompleted: false,
        });
      } finally {
        socket.destroy();
      }
    });
  });
});
