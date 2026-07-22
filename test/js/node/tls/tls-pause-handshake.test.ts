import { describe, expect, it } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import type { AddressInfo } from "net";
import { once } from "node:events";
import { connect, createServer, Server, TLSSocket } from "tls";

describe("pausing a TLS socket before the handshake does not stall it", () => {
  // Socket.prototype.pause() previously stopped native reads unconditionally,
  // starving the TLS engine of the ClientHello. The Node-matching observable
  // is that the handshake completes; where the post-handshake readable state
  // diverges from Node (Bun hands the same TLSSocket to 'connection' and
  // 'secureConnection', Node delivers separate objects) the test says so.

  async function waitFor(cond: () => boolean) {
    for (let i = 0; !cond() && i < 2000; i++) await new Promise<void>(r => setImmediate(r));
  }

  it("server: s.pause() inside the 'connection' handler", async () => {
    const server: Server = createServer(COMMON_CERT);
    let connSock: TLSSocket | undefined;
    server.on("connection", s => {
      connSock = s as TLSSocket;
      s.pause();
    });
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", s => accepted.resolve(s));
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      cli.on("error", () => {});
      // Before the fix this hung: the native poll was switched to write-only
      // and the TLS engine never saw the ClientHello.
      await once(cli, "secureConnect");
      srv = await accepted.promise;
      // Bun delivers the same TLSSocket to 'connection' and 'secureConnection',
      // so the pause() is visible here; in Node `srv` is a separate object
      // with readableFlowing === null and these assertions would not hold.
      expect({ paused: srv.isPaused(), flowing: srv.readableFlowing }).toEqual({ paused: true, flowing: false });

      let stopped = true;
      let got = "";
      srv.on("data", d => {
        if (stopped) throw new Error("data event fired while paused");
        got += d;
      });
      cli.write("hello");
      // Await the actual observable; a reverse round-trip is not a barrier
      // because kqueue/IOCP do not order ready-fd dispatch within a batch.
      await waitFor(() => srv!.readableLength >= 5);
      expect({ got, flowing: srv.readableFlowing, readableLength: srv.readableLength }).toEqual({
        got: "",
        flowing: false,
        readableLength: 5,
      });
      stopped = false;
      const dataP = once(srv, "data");
      srv.resume();
      await dataP;
      expect(got).toBe("hello");
    } finally {
      cli?.destroy();
      srv?.destroy();
      connSock?.destroy();
      server.close();
    }
    await once(server, "close");
  });

  it("server: pauseOnConnect: true", async () => {
    const server: Server = createServer({ ...COMMON_CERT, pauseOnConnect: true });
    const accepted = Promise.withResolvers<{ paused: boolean; flowing: boolean | null; socket: TLSSocket }>();
    server.on("secureConnection", s =>
      accepted.resolve({ paused: s.isPaused(), flowing: s.readableFlowing, socket: s }),
    );
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      cli.on("error", () => {});
      await once(cli, "secureConnect");
      const { paused, flowing, socket } = await accepted.promise;
      srv = socket;
      // Node also reports paused:true / flowing:false here
      // (test-tls-server-parent-constructor-options).
      expect({ paused, flowing }).toEqual({ paused: true, flowing: false });

      cli.write("hello");
      await waitFor(() => srv!.readableLength >= 5);
      expect({ flowing: srv.readableFlowing, readableLength: srv.readableLength }).toEqual({
        flowing: false,
        readableLength: 5,
      });
      srv.resume();
      expect((await once(srv, "data"))[0].toString()).toBe("hello");
    } finally {
      cli?.destroy();
      srv?.destroy();
      server.close();
    }
    await once(server, "close");
  });

  it("server: s.pause() inside the 'secureConnection' handler", async () => {
    // Exercises the readableFlowing === null gate in ServerHandlers.handshake:
    // the post-emit resume() must not stomp a pause() made inside the handler.
    const server: Server = createServer(COMMON_CERT);
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", s => {
      s.pause();
      accepted.resolve(s);
    });
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      cli.on("error", () => {});
      await once(cli, "secureConnect");
      srv = await accepted.promise;
      // Before the fix the post-emit resume() flipped this back to
      // paused:false / flowing:true.
      expect({ paused: srv.isPaused(), flowing: srv.readableFlowing }).toEqual({ paused: true, flowing: false });

      cli.write("hello");
      srv.resume();
      expect((await once(srv, "data"))[0].toString()).toBe("hello");
    } finally {
      cli?.destroy();
      srv?.destroy();
      server.close();
    }
    await once(server, "close");
  });

  it("client: pauseOnConnect: true", async () => {
    const server: Server = createServer(COMMON_CERT);
    const accepted = Promise.withResolvers<TLSSocket>();
    server.on("secureConnection", s => accepted.resolve(s));
    server.on("tlsClientError", accepted.reject);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let cli: TLSSocket | undefined;
    let srv: TLSSocket | undefined;
    try {
      const port = (server.address() as AddressInfo).port;
      cli = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, pauseOnConnect: true });
      cli.on("error", () => {});
      // Before the fix SocketHandlers2.open's self.pause() stopped native
      // reads and the handshake never completed.
      await once(cli, "secureConnect");
      srv = await accepted.promise;
      // Bun pauses the returned TLSSocket here (isPaused()===true); Node leaves
      // it at readableFlowing===null (pauseOnConnect applies to the separate
      // underlying net.Socket). Pre-existing divergence; this PR fixes only
      // the handshake stall, so resume explicitly and assert data flows.
      cli.resume();
      srv.write("from-server");
      expect((await once(cli, "data"))[0].toString()).toBe("from-server");
      cli.write("from-client");
      expect((await once(srv, "data"))[0].toString()).toBe("from-client");
    } finally {
      cli?.destroy();
      srv?.destroy();
      server.close();
    }
    await once(server, "close");
  });
});
