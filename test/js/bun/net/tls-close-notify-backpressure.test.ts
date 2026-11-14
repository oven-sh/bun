import type { Socket } from "bun";
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { tls as certs, isWindows } from "harness";
import { once } from "node:events";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";

// A close_notify that the kernel refuses waits for the writable event, and the close or the FIN behind it waits too.
describe.skipIf(!fault.available() || isWindows)("TLS sockets whose sends the kernel refuses", () => {
  afterEach(() => fault.clear());

  // TLS 1.2 shows the type of a record: the close_notify is the one alert.
  const ALERT = 21;
  const serverTls = { key: certs.key, cert: certs.cert, maxVersion: 0x0303 };
  const clientTls = { ca: certs.cert, maxVersion: 0x0303 };
  const nodeTls = { key: certs.key, cert: certs.cert, maxVersion: "TLSv1.2" as const };
  const payload = Buffer.alloc(64 * 1024, "p");

  // Twice: what ends a socket may try once more before it gives up. -1 is for ever.
  const refuseSends = (fd: number, repeat = 2) => fault.set({ syscall: "send", action: "zero", fd, repeat });

  // A connection that the peer answers: what was sent before it has been read by the time it resolves.
  async function pendingReadsDone() {
    const server = net.createServer(socket => socket.end("x"));
    await once(server.listen(0, "127.0.0.1"), "listening");
    const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    await once(socket, "data");
    socket.destroy();
    server.close();
  }

  // Forwards one connection to `port`, and lists how the `watched` side of it ends.
  async function relay(port: number, watched: "server" | "client" = "server") {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    let sendFin = () => {};
    const server = net.createServer({ allowHalfOpen: true }, downstream => {
      const upstream = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
      const [from, to] = watched === "server" ? [upstream, downstream] : [downstream, upstream];
      let records = Buffer.alloc(0);
      from.on("data", chunk => {
        to.write(chunk);
        records = Buffer.concat([records, chunk]);
        while (records.length >= 5 && records.length >= 5 + records.readUInt16BE(3)) {
          if (records[0] === ALERT) events.push("close_notify");
          records = records.subarray(5 + records.readUInt16BE(3));
        }
      });
      from.on("end", () => {
        events.push(records.length ? "FIN in a record" : "FIN");
        to.end();
      });
      // Behind its FIN a closed socket resets what still comes in.
      from.on("error", (error: NodeJS.ErrnoException) => void (from.readableEnded || events.push(error.code!)));
      from.on("close", () => {
        to.destroy();
        closed.resolve();
      });
      to.on("data", chunk => void (from.writableEnded || from.write(chunk)));
      to.on("end", () => from.end());
      to.on("error", () => {});
      sendFin = () => void from.end();
      server.close();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      port: (server.address() as AddressInfo).port,
      events,
      closed: closed.promise,
      /** A FIN to the watched side, with no close_notify ahead of it. */
      sendFin: () => sendFin(),
    };
  }

  type Relay = Awaited<ReturnType<typeof relay>>;

  // The watched socket runs `act` once both handshakes are done. The other one answers its end with "reply" and an end of its own.
  async function watchedPair(
    role: "server" | "client",
    act: (socket: Socket, relayed: Relay, other: Socket) => void,
    { allowHalfOpen = false, onEnd }: { allowHalfOpen?: boolean; onEnd?: (socket: Socket) => void } = {},
  ) {
    const watched = { received: "", events: [] as string[] };
    const other = { received: 0, events: [] as string[] };
    const closes = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let relayed!: Relay;
    const shakenHands = [Promise.withResolvers<Socket>(), Promise.withResolvers<Socket>()];
    const watchedHandlers = {
      handshake: (socket: Socket) => shakenHands[0].resolve(socket),
      data: (_socket: Socket, chunk: Buffer) => void (watched.received += chunk),
      end(socket: Socket) {
        watched.events.push("end");
        onEnd?.(socket);
      },
      close(_socket: Socket, error?: Error) {
        // The next socket can get this fd.
        fault.clear();
        watched.events.push(error ? `close: ${(error as NodeJS.ErrnoException).code}` : "close");
        closes[0].resolve();
      },
    };
    const otherHandlers = {
      handshake: (socket: Socket) => shakenHands[1].resolve(socket),
      data: (_socket: Socket, chunk: Buffer) => void (other.received += chunk.length),
      end(socket: Socket) {
        other.events.push("end");
        socket.end("reply");
      },
      close(_socket: Socket, error?: Error) {
        other.events.push(error ? `close: ${(error as NodeJS.ErrnoException).code}` : "close");
        closes[1].resolve();
      },
    };
    const [serverSide, clientSide] =
      role === "server" ? [watchedHandlers, otherHandlers] : [otherHandlers, watchedHandlers];
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: serverTls as any,
      allowHalfOpen: role === "server" ? allowHalfOpen : true,
      socket: serverSide,
    });
    relayed = await relay(server.port, role);
    await Bun.connect({
      hostname: "127.0.0.1",
      port: relayed.port,
      tls: clientTls as any,
      allowHalfOpen: role === "client" ? allowHalfOpen : true,
      socket: clientSide,
    });
    const [socket, otherSocket] = await Promise.all(shakenHands.map(({ promise }) => promise));
    await act(socket, relayed, otherSocket);
    await Promise.all([relayed.closed, ...closes.map(({ promise }) => promise)]);
    return { wire: relayed.events, watched, other };
  }

  describe.each(["server", "client"] as const)("%s", role => {
    test.each([
      ["end()", (socket: Socket) => void socket.end()],
      ["shutdown()", (socket: Socket) => void socket.shutdown()],
      ["shutdown() and end()", (socket: Socket) => (socket.shutdown(), void socket.end())],
    ])("%s sends the close_notify that the kernel refused", async (_name, finish) => {
      const { wire, other } = await watchedPair(role, socket => {
        expect(socket.write(payload)).toBe(payload.length);
        refuseSends((socket as any).fd);
        finish(socket);
      });
      expect({ wire, other }).toEqual({
        wire: ["close_notify", "FIN"],
        other: { received: payload.length, events: ["end", "close"] },
      });
    });

    test("shutdown() behind a refused close_notify still reads", async () => {
      const { wire, watched } = await watchedPair(role, socket => {
        refuseSends((socket as any).fd);
        socket.shutdown();
      });
      expect({ wire, received: watched.received }).toEqual({ wire: ["close_notify", "FIN"], received: "reply" });
    });
  });

  // The peer's end comes while the kernel still refuses what write() reported.
  describe.each([
    ["close_notify and FIN", (_relayed: Relay, other: Socket) => void other.shutdown()],
    ["FIN alone", (relayed: Relay, _other: Socket) => relayed.sendFin()],
  ])("the peer sends its %s and reads on", (_name, endPeer) => {
    test.each([
      ["whose owner waits", {}],
      ["whose owner end()s", { onEnd: (socket: Socket) => void socket.end() }],
      ["that end()ed before", { before: (socket: Socket) => void socket.end() }],
      ["that shutdown() before", { before: (socket: Socket) => void socket.shutdown() }],
      ["that half-opens", { allowHalfOpen: true, onEnd: (socket: Socket) => void socket.end() }],
    ])("a socket %s delivers every reported byte", async (_owner, { before, ...options }) => {
      let reported = 0;
      const { wire, other, watched } = await watchedPair(
        "server",
        async (socket, relayed, other) => {
          refuseSends((socket as any).fd, -1);
          reported = socket.write(payload);
          before?.(socket);
          endPeer(relayed, other);
          await pendingReadsDone();
          await pendingReadsDone();
          fault.clear();
        },
        options,
      );
      expect(reported).toBeGreaterThan(0);
      expect({ wire, received: other.received, closed: watched.events.at(-1) }).toEqual({
        wire: ["close_notify", "FIN"],
        received: reported,
        closed: "close",
      });
    });
  });

  describe("a server that closes behind its response", () => {
    // The response is the first send after this, its close_notify the second.
    const refuseCloseNotify = () => fault.set({ syscall: "send", action: "zero", after: 1, repeat: 2 });

    async function request(port: number) {
      const relayed = await relay(port);
      const response = Promise.withResolvers<string>();
      let text = "";
      await Bun.connect({
        hostname: "127.0.0.1",
        port: relayed.port,
        tls: clientTls as any,
        socket: {
          handshake: socket => void socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
          data: (_socket, chunk) => void (text += chunk),
          close: () => response.resolve(text),
        },
      });
      await relayed.closed;
      return { wire: relayed.events, body: (await response.promise).split("\r\n\r\n")[1] };
    }

    test("Bun.serve", async () => {
      await using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        tls: serverTls as any,
        fetch() {
          refuseCloseNotify();
          return new Response("hello");
        },
      });
      expect(await request(server.port!)).toEqual({ wire: ["close_notify", "FIN"], body: "hello" });
    });

    test("node:https", async () => {
      const server = https.createServer(nodeTls, (_req, res) => {
        res.sendDate = false;
        refuseCloseNotify();
        res.setHeader("Content-Length", 5);
        res.end("hello");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      try {
        expect(await request((server.address() as AddressInfo).port)).toEqual({
          wire: ["close_notify", "FIN"],
          body: "hello",
        });
      } finally {
        server.close();
      }
    });
  });

  test("node:tls end() sends the close_notify that the kernel refused", async () => {
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const server = tls.createServer(nodeTls, socket => {
      socket.on("data", chunk => events.push(String(chunk)));
      socket.on("end", () => events.push("end"));
      socket.on("close", hadError => {
        events.push(`close(hadError=${hadError})`);
        closed.resolve();
      });
      socket.write(payload, () => {
        refuseSends((socket as any)._handle.fd);
        socket.end();
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const relayed = await relay((server.address() as AddressInfo).port);
      const client = tls.connect({ port: relayed.port, host: "127.0.0.1", ca: certs.cert, allowHalfOpen: true } as any);
      let received = 0;
      client.on("data", chunk => (received += chunk.length));
      client.on("end", () => client.end("reply"));
      await Promise.all([relayed.closed, once(client, "close"), closed.promise]);
      expect({ wire: relayed.events, received, events }).toEqual({
        wire: ["close_notify", "FIN"],
        received: payload.length,
        events: ["reply", "end", "close(hadError=false)"],
      });
    } finally {
      server.close();
    }
  });

  // The owner let go: only the deadline (10 s on a 4 s tick) ends the wait.
  test("a kernel that takes nothing more holds a socket until a fixed deadline", async () => {
    const opened: Socket[] = [];
    const servers: { stop(closeConnections?: boolean): void }[] = [];
    async function pair(side: "server" | "client") {
      const shakenHands = [Promise.withResolvers<Socket>(), Promise.withResolvers<Socket>()];
      const ended = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<number>();
      let timeouts = 0;
      const subject = {
        handshake: (socket: Socket) => shakenHands[0].resolve(socket),
        data() {},
        end: () => ended.resolve(),
        timeout: () => void timeouts++,
        close: () => closed.resolve(performance.now()),
      };
      const peer = { handshake: (socket: Socket) => shakenHands[1].resolve(socket), data() {}, end() {} };
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: serverTls as any,
        allowHalfOpen: side === "client",
        socket: side === "server" ? subject : peer,
      });
      servers.push(server);
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: clientTls as any,
        allowHalfOpen: side === "server",
        socket: side === "server" ? peer : subject,
      });
      const [socket, other] = await Promise.all(shakenHands.map(({ promise }) => promise));
      opened.push(socket, other);
      return { socket, other, ended: ended.promise, closed: closed.promise, timeouts: () => timeouts };
    }
    const accepted = await pair("server");
    const connected = await pair("client");
    const peerEnded = await pair("server");
    try {
      refuseSends((peerEnded.socket as any).fd, -1);
      const startedAt = [performance.now()];
      const reported = peerEnded.socket.write(payload);
      peerEnded.other.shutdown();
      await peerEnded.ended;
      peerEnded.socket.timeout(0);
      fault.set({ syscall: "send", action: "zero", repeat: -1 });
      for (const { socket } of [accepted, connected]) {
        socket.timeout(1);
        startedAt.push(performance.now());
        socket.end();
      }
      const subjects = [peerEnded, accepted, connected];
      const waited = (await Promise.all(subjects.map(({ closed }) => closed))).map((at, i) => at - startedAt[i]);
      expect({
        reported: reported > 0,
        atTheDeadline: waited.map(ms => ms > 7_000 && ms < 16_000),
        timeouts: subjects.map(({ timeouts }) => timeouts()),
      }).toEqual({ reported: true, atTheDeadline: [true, true, true], timeouts: [0, 0, 0] });
    } finally {
      fault.clear();
      for (const socket of opened) socket.terminate();
      for (const server of servers) server.stop(true);
    }
  }, 30_000);
});
