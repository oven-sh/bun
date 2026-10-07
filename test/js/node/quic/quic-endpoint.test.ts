// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
import { constants } from "node:os";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

describe("QuicEndpoint client-engine mode", () => {
  test("an explicit endpoint rejects a connect() in the other mode", async () => {
    await using server = await listen(
      s => {
        s.onerror = () => {};
        s.closed.catch(() => {});
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams: { maxIdleTimeout: 1 } },
    );

    const endpoint = new QuicEndpoint();
    const raw = await connect(server.address, {
      endpoint,
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
    await raw.opened;
    raw.close();

    // The engine is raw now; an h3 (default-ALPN) connect cannot reuse it.
    expect(() => connect(server.address, { endpoint, verifyPeer: "manual" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_STATE" }),
    );
    await endpoint.close();
  });
});

describe("endpoint blockList", () => {
  test("applies to packets forwarded from a sibling endpoint on the same loop", async () => {
    const tp = { maxIdleTimeout: 1 };
    const sniOpt = { "*": { keys: [key], certs: [cert] } };
    const onSession = async (s: any) => {
      s.onstream = (st: any) => st.closed.catch(() => {});
      await s.closed.catch(() => {});
    };

    const blockList = new BlockList();
    blockList.addAddress("127.0.0.1");

    await using receiver = await listen(onSession, { sni: sniOpt, transportParams: tp });
    await using filtered = await listen(onSession, {
      sni: sniOpt,
      transportParams: tp,
      endpoint: { blockList, blockListPolicy: "deny" },
    });

    const stray = Buffer.alloc(64, 0x41);
    const sock = createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      sock.send(stray, receiver.address.port, "127.0.0.1", err => (err ? reject(err) : resolve()));
    });
    sock.close();

    const client = await connect(receiver.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    });
    await client.opened;
    client.close();

    expect({
      receiver: receiver.stats.packetsBlocked,
      filtered: filtered.stats.packetsBlocked,
    }).toEqual({ receiver: 0n, filtered: 1n });
  });
});

// The engine's HTTP/3-vs-raw framing is fixed from the first ALPN entry, but
// alpn_select_cb offers the whole list, so a mixed list could negotiate the
// framing the engine was not built for and silently corrupt the session.
describe("server ALPN list", () => {
  test("rejects a list mixing HTTP/3 and non-HTTP/3 protocols", async () => {
    const sniOpt = { "*": { keys: [key], certs: [cert] } };
    const tp = { maxIdleTimeout: 1 };
    const onSession = async (s: any) => {
      await s.closed.catch(() => {});
    };

    for (const alpn of [
      ["custom", "h3"],
      ["h3", "custom"],
    ]) {
      await expect(listen(onSession, { sni: sniOpt, transportParams: tp, alpn })).rejects.toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    }

    // Uniform lists on either side of the split are still accepted.
    await using h3 = await listen(onSession, { sni: sniOpt, transportParams: tp, alpn: ["h3", "h3-29"] });
    await using raw = await listen(onSession, { sni: sniOpt, transportParams: tp, alpn: ["a", "b"] });
    expect([typeof h3.address.port, typeof raw.address.port]).toEqual(["number", "number"]);
  });
});

// `setCallbacks` is once-only, but its holder lives on the VM's RareData, which
// outlives the per-file global swap. A second file's call would be ignored and
// its sessions would dispatch into the retired realm.
describe("node:quic under --isolate", () => {
  test("a second test file in the same process gets its own callbacks", async () => {
    const body = (label: string) => `
      import { expect, test } from "bun:test";
      import { createPrivateKey } from "node:crypto";
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      import { connect, listen } from "node:quic";

      const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));
      const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});

      test("quic session opens (${label})", async () => {
        await using server = await listen(
          async s => {
            s.onstream = st => st.closed.catch(() => {});
            await s.closed.catch(() => {});
          },
          { sni: { "*": { keys: [key], certs: [cert] } }, transportParams: { maxIdleTimeout: 1 } },
        );
        const client = await connect(server.address, {
          servername: "localhost",
          verifyPeer: "manual",
          transportParams: { maxIdleTimeout: 1 },
        });
        await client.opened;
        client.close();
        expect(true).toBe(true);
      });
    `;
    using dir = tempDir("quic-isolate", { "a.test.ts": body("a"), "b.test.ts": body("b") });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "--timeout=30000", "a.test.ts", "b.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    // Both files must run their own callbacks: the second one otherwise dies
    // in the first file's retired module scope ("undefined is not an object").
    expect(
      normalizeBunSnapshot(stderr)
        .split("\n")
        .filter(l => l.includes("pass") || l.includes("fail")),
    ).toMatchInlineSnapshot(`
      [
        "(pass) quic session opens (a)",
        "(pass) quic session opens (b)",
        " 2 pass",
        " 0 fail",
      ]
    `);
    expect(exitCode).toBe(0);
  }, 30000);
});

// An endpoint that both listens and dials keeps two lsquic engines on one
// socket. A 1-RTT packet for the client leg that also reaches the server
// engine misses its conns_hash, and the server engine answers unknown packets
// with a stateless reset -- at our own live connection.
describe("dual-mode endpoint", () => {
  test("does not stateless-reset its own client connection", async () => {
    const tp = { maxIdleTimeout: 1 };
    const sniOpt = { "*": { keys: [key], certs: [cert] } };
    const onstream = (s: any) => {
      s.onstream = (st: any) => st.closed.catch(() => {});
      return s.closed.catch(() => {});
    };

    await using peer = await listen(onstream, {
      sni: sniOpt,
      transportParams: tp,
      onheaders(this: any) {
        this.sendHeaders({ ":status": "200" });
        this.writer.endSync();
      },
    });
    await using dual = await listen(onstream, { sni: sniOpt, transportParams: tp });

    const client = await connect(peer.address, {
      endpoint: dual,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    });
    await client.opened;

    const answered = Promise.withResolvers<void>();
    await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders: () => answered.resolve(),
    });
    await answered.promise;
    client.close();

    expect({ dual: dual.stats.statelessResetCount, peer: peer.stats.statelessResetCount }).toEqual({
      dual: 0n,
      peer: 0n,
    });
  });
});

// RFC 9000 §18.2: maxIdleTimeout 0 disables the idle timeout, and node stores
// it as `max_idle_timeout * NGTCP2_SECONDS` so 0 survives. lsquic reads its
// seconds field whenever the ms field is zero, so 0 has to reach both or it
// silently becomes the 10s default.
describe("transportParams.maxIdleTimeout", () => {
  test("0 disables the idle timeout instead of falling back to the default", async () => {
    const sniOpt = { "*": { keys: [key], certs: [cert] } };
    const onSession = async (s: any) => {
      await s.closed.catch(() => {});
    };

    // Assert what the server put on the WIRE: localTransportParams echoes the
    // requested value whatever the engine does with it. A fresh endpoint per
    // case, since the implicit client endpoint is shared across connect() calls
    // and its engine keeps the first connect's settings.
    const advertised = async (maxIdleTimeout: number) => {
      await using server = await listen(onSession, { sni: sniOpt, transportParams: { maxIdleTimeout } });
      await using endpoint = new QuicEndpoint();
      const client = await connect(server.address, {
        endpoint,
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: { maxIdleTimeout: 3 },
      });
      await client.opened;
      const remote = client.remoteTransportParams.maxIdleTimeout;
      client.close();
      return remote;
    };

    expect({ zero: await advertised(0), seven: await advertised(7) }).toEqual({ zero: 0n, seven: 7n });
  });
});

// A graceful close() waits for live sessions to drain, but the listener kept
// accepting: each new session re-filled `sessions`, so the
// `closing && sessions.is_empty()` finish gate never tripped and `closed`
// never resolved. Bun's own HTTP/3 listener refuses in on_new_conn while
// closing (packages/bun-usockets/src/quic.c us_quic_on_new_conn).
describe("endpoint.close() while a session is live", () => {
  test("stops accepting new sessions so closed can resolve", async () => {
    const tp = { maxIdleTimeout: 30 };
    const sniOpt = { "*": { keys: [key], certs: [cert] } };
    let announced = 0;
    await using server = await listen(
      async (s: any) => {
        announced++;
        await s.closed.catch(() => {});
      },
      { sni: sniOpt, transportParams: tp },
    );

    // close() clears `address`, so hold on to it for the late connect below.
    const address = server.address;

    // Hold one session open so close() has to drain instead of finishing now.
    await using holdEndpoint = new QuicEndpoint();
    const held = await connect(address, {
      endpoint: holdEndpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    });
    await held.opened;

    server.close();
    let resolved = false;
    server.closed.then(
      () => (resolved = true),
      () => (resolved = true),
    );

    // A client arriving during the drain must not become a session.
    await using lateEndpoint = new QuicEndpoint();
    const late = await connect(address, {
      endpoint: lateEndpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    });
    // `closed` rejects with the same CONNECTION_REFUSED transport error, and
    // does so while `opened` is being awaited -- handle it first.
    const lateClosed = late.closed.catch(() => "rejected");
    await expect(late.opened).rejects.toThrow(expect.objectContaining({ code: "ERR_QUIC_TRANSPORT_ERROR" }));
    expect(await lateClosed).toBe("rejected");

    // Releasing the held session is now the last one, so close finishes.
    held.close();
    await server.closed;
    expect({ announced, resolved }).toEqual({ announced: 1, resolved: true });
  });
});

// lsquic reads a short return of the endpoint's send callback as "the socket
// is blocked". It then stops every session of the engine, and at its next
// tick it drops each waiting packet that holds only DATAGRAM frames. So an
// error that belongs to one destination must not reach lsquic that way, and
// the socket must not report the error of one peer on a send to another.
describe("an error on the endpoint's socket", () => {
  const tp = { maxIdleTimeout: 30 };
  const sni = { "*": { keys: [key], certs: [cert] } };
  const clientOptions = { alpn: "quic-test", servername: "localhost", verifyPeer: "manual", transportParams: tp };
  const loopTurn = () => new Promise<void>(resolve => setImmediate(resolve));
  const ignoreSettlement = (session: any) => {
    session.opened.catch(() => {});
    session.closed.catch(() => {});
    return session;
  };
  /** Ends the sessions at once. A graceful close waits for a peer that cannot answer. */
  const destroyAtExit = (...sessions: any[][]) => ({
    [Symbol.dispose]() {
      for (const session of sessions.flat()) session.destroy();
    },
  });
  /** Writes how `closed` settles into `order`. */
  const logClose = (order: string[], name: string, closed: Promise<unknown>) =>
    closed.then(
      () => void order.push(`${name} closed`),
      (error: any) => void order.push(`${name} closed with ${error.code}`),
    );

  /** The server answers each stream with one byte. */
  const onServerSession = (sessions: any[]) => (session: any) => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = (stream: any) => {
      stream.closed.catch(() => {});
      stream.writer.writeSync(new Uint8Array(1));
      stream.writer.endSync();
    };
    sessions.push(session);
  };

  /**
   * A stream round trip. When it ends, each side has every packet that the
   * other sent before it. Returns the number of bytes in the answer.
   */
  async function roundTrip(session: any) {
    const stream = await session.createBidirectionalStream({ body: new Uint8Array(1) });
    stream.closed.catch(() => {});
    let answered = 0;
    for await (const batch of stream) for (const chunk of [batch].flat()) answered += chunk.byteLength;
    return answered;
  }

  /** Resolves when `session` gets the answer to a stream. It stays pending when the session ends first. */
  const answered = (session: any) =>
    new Promise<string>(
      resolve =>
        void roundTrip(session).then(
          bytes => bytes === 1 && resolve("answered"),
          () => {},
        ),
    );

  /** A UDP port of 127.0.0.1 that nothing is bound to. */
  async function closedPort() {
    const socket = createSocket("udp4");
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const { port } = socket.address();
    await new Promise<void>(resolve => socket.close(() => resolve()));
    return port;
  }

  /** A UDP relay in front of the server. `cut()` closes the socket that the server sends to. */
  async function relayTo(serverPort: number) {
    const front = createSocket("udp4");
    const upstream = createSocket("udp4");
    let clientPort = 0;
    let cut = false;
    upstream.on("message", packet => front.send(packet, clientPort, "127.0.0.1"));
    front.on("message", (packet, from) => {
      clientPort = from.port;
      if (!cut) upstream.send(packet, serverPort, "127.0.0.1");
    });
    front.bind(0, "127.0.0.1");
    upstream.bind(0, "127.0.0.1");
    await Promise.all([once(front, "listening"), once(upstream, "listening")]);
    return {
      port: front.address().port,
      /** The kernel answers each later packet of the server with ICMP port unreachable. */
      cut() {
        cut = true;
        upstream.close();
      },
      [Symbol.dispose]() {
        front.close();
        if (!cut) upstream.close();
      },
    };
  }

  // The endpoint is bound to 127.0.0.1. An IPv6 destination cannot leave its
  // IPv4 socket on any platform. Linux refuses the other two with EINVAL and
  // EACCES.
  const refused = ["[::1]:443", ...(isLinux ? ["192.0.2.1:443", "255.255.255.255:443"] : [])];

  test.each(refused)("a datagram that the kernel refuses for %s does not stop another session", async address => {
    const received: number[] = [];
    const serverSessions: any[] = [];
    const clientSessions: any[] = [];
    await using server = await listen(onServerSession(serverSessions), {
      sni,
      alpn: ["quic-test"],
      transportParams: tp,
      ondatagram(datagram: Uint8Array) {
        received.push(datagram[0]);
      },
    });
    await using endpoint = new QuicEndpoint();
    using _sessions = destroyAtExit(clientSessions, serverSessions);
    const live = await connect(server.address, { ...clientOptions, endpoint });
    clientSessions.push(live);
    await live.opened;
    const refusedSession = ignoreSettlement(await connect(address, { ...clientOptions, endpoint }));
    clientSessions.push(refusedSession);

    // A loop turn after each datagram, so each one is a send pass of its own.
    const sent = Array.from({ length: 10 }, (_, id) => id);
    for (const id of sent) {
      await live.sendDatagram(new Uint8Array([id]));
      await loopTurn();
    }
    // The session that cannot send goes first. Without it the round trip
    // ends on an endpoint that held the live session back too.
    refusedSession.destroy();
    await roundTrip(live);

    expect(received).toEqual(sent);
  });

  test("a session opens and exchanges a stream while an earlier session of the endpoint cannot send", async () => {
    const serverSessions: any[] = [];
    const clientSessions: any[] = [];
    await using server = await listen(onServerSession(serverSessions), {
      sni,
      alpn: ["quic-test"],
      transportParams: tp,
    });
    await using endpoint = new QuicEndpoint();
    using _sessions = destroyAtExit(clientSessions, serverSessions);
    const refusedSession = ignoreSettlement(await connect("[::1]:443", { ...clientOptions, endpoint }));
    clientSessions.push(refusedSession);

    const live = await connect(server.address, { ...clientOptions, endpoint });
    clientSessions.push(live);
    await live.opened;

    expect({ answered: await roundTrip(live), refusedIsPending: !refusedSession.destroyed }).toEqual({
      answered: 1,
      refusedIsPending: true,
    });
  });

  // Linux only: a socket with IP_RECVERR gets the ICMP error about one peer
  // on its next send, whatever the destination of that send is.
  describe.skipIf(!isLinux)("an ICMP error about a dead peer", () => {
    test.each([2, 3])("does not fail the sends to a live peer (%d dead peers)", async dead => {
      const received: number[] = [];
      const serverSessions: any[] = [];
      const clientSessions: any[] = [];
      let onRound = () => {};
      await using server = await listen(onServerSession(serverSessions), {
        sni,
        alpn: ["quic-test"],
        transportParams: tp,
        // Only the live client sends. The answers for all sessions leave in one pass.
        ondatagram(datagram: Uint8Array) {
          for (const session of serverSessions) session.sendDatagram(datagram);
          onRound();
        },
      });
      await using endpoint = new QuicEndpoint();
      using _sessions = destroyAtExit(clientSessions, serverSessions);
      using relays = new DisposableStack();

      const live = await connect(server.address, {
        ...clientOptions,
        endpoint,
        ondatagram(datagram: Uint8Array) {
          received.push(datagram[0]);
        },
      });
      clientSessions.push(live);
      await live.opened;
      const cuts: (() => void)[] = [];
      for (let i = 0; i < dead; i++) {
        const relay = relays.use(await relayTo(server.address.port));
        const session = ignoreSettlement(
          await connect({ address: "127.0.0.1", port: relay.port }, { ...clientOptions, endpoint }),
        );
        clientSessions.push(session);
        await session.opened;
        cuts.push(relay.cut);
      }
      // The server announces a session when its first packet arrives.
      const [, ...sessionsOfDeadPeers] = serverSessions;
      expect(sessionsOfDeadPeers).toHaveLength(dead);
      for (const cut of cuts) cut();

      const rounds = Array.from({ length: 10 }, (_, round) => round);
      for (const round of rounds) {
        const handled = new Promise<void>(resolve => (onRound = resolve));
        await live.sendDatagram(new Uint8Array([round]));
        await handled;
        await loopTurn();
      }
      // The sessions with a dead peer go first. Without them no new error
      // arrives, so the round trip ends on an endpoint that lost datagrams too.
      for (const session of sessionsOfDeadPeers) session.destroy();
      await roundTrip(live);

      expect(received).toEqual(rounds);
    });

    test("does not eat the version negotiation probe of another session", async () => {
      const serverSessions: any[] = [];
      const clientSessions: any[] = [];
      await using server = await listen(onServerSession(serverSessions), {
        sni,
        alpn: ["quic-test"],
        transportParams: tp,
      });
      const deadPort = await closedPort();
      await using endpoint = new QuicEndpoint();
      using _sessions = destroyAtExit(clientSessions, serverSessions);

      // Both leave in one turn, so the error about the first is still pending
      // on the socket when the probe of the second is sent.
      const toDeadPeer = connect({ address: "127.0.0.1", port: deadPort }, { ...clientOptions, endpoint });
      const probing = connect(server.address, { ...clientOptions, endpoint, version: 0x1a1a1a1a, onerror() {} });
      clientSessions.push(ignoreSettlement(await toDeadPeer));
      const session = await probing;
      clientSessions.push(session);
      session.opened.catch(() => {});

      expect(
        await session.closed.then(
          () => "closed",
          (error: any) => error.code,
        ),
      ).toBe("ERR_QUIC_VERSION_NEGOTIATION_ERROR");
    });
  });

  // These need the fault hooks of a debug or ASAN build. A rule has no fd
  // here, so it hits the next send or receive of a UDP socket in the process.
  // On Windows an injected errno does not pass through the Winsock mapping.
  describe.skipIf(!fault.available() || isWindows)("injected in uSockets", () => {
    /** One server, and `count` open sessions to it on one client endpoint. */
    async function connected(count: number, serverOptions: object = {}, sessionOptions: object = {}) {
      const stack = new AsyncDisposableStack();
      stack.defer(() => fault.clear());
      const serverSessions: any[] = [];
      const clientSessions: any[] = [];
      const server = await listen(onServerSession(serverSessions), {
        sni,
        alpn: ["quic-test"],
        transportParams: tp,
        ...serverOptions,
      });
      // After a receive error the endpoint is closed, and `close()` rejects.
      stack.defer(() => server.close().catch(() => {}));
      const endpoint = new QuicEndpoint();
      stack.defer(() => endpoint.close().catch(() => {}));
      stack.use(destroyAtExit(clientSessions, serverSessions));
      for (let i = 0; i < count; i++) {
        const session = ignoreSettlement(
          await connect(server.address, { ...clientOptions, endpoint, ...sessionOptions }),
        );
        clientSessions.push(session);
        await session.opened;
      }
      return { server, endpoint, serverSessions, clientSessions, [Symbol.asyncDispose]: () => stack.disposeAsync() };
    }
    const receiveError = { syscall: "recvmsg", action: "errno", errno: "ENOMEM" } as const;

    // Both endpoints are in this process, and the loopback loses nothing. So
    // the packets that one endpoint counts and the other never gets are the
    // failed sends, plus the few that are still on their way.
    test.each([
      ["the socket would block", { action: "errno", errno: "EAGAIN", repeat: 5 }, false],
      ["a send returns 0", { action: "zero", repeat: 5 }, false],
      ["the kernel refuses 3 sends", { action: "errno", errno: "ENETUNREACH", repeat: 3 }, true],
    ] as const)("a stream round trip completes when %s", async (_case, rule, countedAsSent) => {
      await using net = await connected(1);
      const [session] = net.clientSessions;
      /** The packets that `from` counts as sent and `to` did not receive. */
      const missing = (from: any, to: any) => Number(from.stats.packetsSent - to.stats.packetsReceived);

      fault.set({ syscall: "sendmsg", ...rule });
      // Two datagrams take the first failures. lsquic does not send a datagram
      // again, so the stream data waits for one retransmission, not for three.
      for (const id of [0, 1]) {
        await session.sendDatagram(new Uint8Array([id]));
        await loopTurn();
      }
      const answered = await roundTrip(session);
      const neverArrived = missing(net.endpoint, net.server) + missing(net.server, net.endpoint);

      expect({ answered, failedSendsCountedAsSent: neverArrived >= rule.repeat }).toEqual({
        answered: 1,
        failedSendsCountedAsSent: countedAsSent,
      });
    });

    /**
     * Two sessions on a `listen()` endpoint. The server answers a datagram of
     * the first client with one datagram to each session, in one pass, and the
     * first send of the first pass fails with `errno`.
     */
    async function twoSessionsOneFailedSend(errno: "ENETUNREACH" | number) {
      const received: number[][] = [[], []];
      const gotSecond = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      const firstHandled = Promise.withResolvers<void>();
      const net = await connected(
        2,
        {
          ondatagram(datagram: Uint8Array) {
            if (datagram[0] === 0) fault.set({ syscall: "sendmsg", action: "errno", errno });
            for (const session of net.serverSessions) if (!session.destroyed) session.sendDatagram(datagram);
            firstHandled.resolve();
          },
        },
        {
          ondatagram(this: any, datagram: Uint8Array) {
            const index = net.clientSessions.indexOf(this);
            received[index].push(datagram[0]);
            if (datagram[0] === 1) gotSecond[index].resolve();
          },
        },
      );
      await net.clientSessions[0].sendDatagram(new Uint8Array([0]));
      await firstHandled.promise;
      await loopTurn();
      return { net, received, gotSecond: gotSecond.map(second => second.promise) };
    }

    test("on a listen() endpoint, a refused datagram costs only that datagram", async () => {
      const { net, received, gotSecond } = await twoSessionsOneFailedSend("ENETUNREACH");
      await using _net = net;

      await net.clientSessions[0].sendDatagram(new Uint8Array([1]));
      await Promise.all(gotSecond);

      expect(received.toSorted((a, b) => a.length - b.length)).toEqual([[1], [0, 1]]);
    });

    // lsquic takes EMSGSIZE for a packet that is not an MTU probe as fatal for
    // the connection that owns it. The rest of the batch still leaves.
    test("on a listen() endpoint, EMSGSIZE ends only the session that owns the packet", async () => {
      const { net, received } = await twoSessionsOneFailedSend(constants.errno.EMSGSIZE);
      await using _net = net;

      const answers = await Promise.allSettled(net.clientSessions.map(roundTrip));
      const ended = answers.findIndex(answer => answer.status !== "fulfilled" || answer.value !== 1);
      const other = ended === 0 ? 1 : 0;

      expect({
        endedOnTheServer: await net.serverSessions[ended]?.closed.then(
          () => "closed",
          (error: any) => error.code,
        ),
        endedGot: received[ended],
        otherGot: received[other],
        otherAnswered: answers[other],
      }).toEqual({
        endedOnTheServer: "ERR_QUIC_TRANSPORT_ERROR",
        endedGot: [],
        otherGot: [0],
        otherAnswered: { status: "fulfilled", value: 1 },
      });
    });

    // The socket has no receive-error callback, so uSockets closes it when a
    // receive fails. Node destroys the endpoint then: its sessions end with no
    // packet, and `closed` rejects.
    test("a receive error ends each session, then closes the endpoint", async () => {
      const order: string[] = [];
      const armed = Promise.withResolvers<void>();
      await using net = await connected(1, {
        // This runs inside the receive loop of the server's socket, so the
        // next receive on that socket is the one that fails.
        ondatagram() {
          fault.set(receiveError);
          armed.resolve();
        },
      });
      logClose(order, "session", net.serverSessions[0].closed);
      const endpointClosed = logClose(order, "endpoint", net.server.closed);

      await net.clientSessions[0].sendDatagram(new Uint8Array(1));
      await armed.promise;
      // A server that is still open answers this stream, and that ends the wait.
      await Promise.race([endpointClosed, answered(net.clientSessions[0])]);

      expect({ order, destroyed: net.server.destroyed }).toEqual({
        order: ["session closed", "endpoint closed with ERR_QUIC_ENDPOINT_CLOSED"],
        destroyed: true,
      });
    });

    // The engine still holds the connection of the handshake, and the session
    // has no connection yet. The endpoint waits for neither.
    test("a receive error during a handshake ends the announced session, then closes the endpoint", async () => {
      const order: string[] = [];
      const serverSessions: any[] = [];
      using _fault = { [Symbol.dispose]: () => fault.clear() };
      const server = await listen(
        (session: any) => {
          // Inside the receive loop of the server's socket, as above.
          fault.set(receiveError);
          serverSessions.push(session);
          session.onerror = () => {};
          session.opened.then(
            () => void order.push("session opened"),
            (error: any) => void order.push(`session opened rejected with ${error.code}`),
          );
          logClose(order, "session", session.closed);
        },
        { sni, alpn: ["quic-test"], transportParams: tp },
      );
      await using _server = { [Symbol.asyncDispose]: () => server.close().catch(() => {}) };
      const endpointClosed = logClose(order, "endpoint", server.closed);
      await using endpoint = new QuicEndpoint();
      const client = ignoreSettlement(await connect(server.address, { ...clientOptions, endpoint }));
      using _sessions = destroyAtExit([client], serverSessions);

      // A server that is still open completes the handshake, and that ends the wait.
      await Promise.race([endpointClosed, client.opened.catch(() => {})]);

      expect({ order, destroyed: server.destroyed }).toEqual({
        order: [
          "session opened rejected with ERR_INVALID_STATE",
          "session closed",
          "endpoint closed with ERR_QUIC_ENDPOINT_CLOSED",
        ],
        destroyed: true,
      });
    });

    test("a receive error on a client endpoint also ends a session that waits for version negotiation", async () => {
      const order: string[] = [];
      const armed = Promise.withResolvers<void>();
      await using net = await connected(
        1,
        {},
        {
          // Inside the receive loop of the client's socket.
          ondatagram() {
            fault.set(receiveError);
            armed.resolve();
          },
        },
      );
      const [live] = net.clientSessions;
      // Nothing answers this probe, so the session has no connection.
      const probe = ignoreSettlement(
        await connect(
          { address: "127.0.0.1", port: await closedPort() },
          { ...clientOptions, endpoint: net.endpoint, version: 0x1a1a1a1a, onerror() {} },
        ),
      );
      net.clientSessions.push(probe);
      const sessionsClosed = Promise.all([
        logClose(order, "live", live.closed),
        logClose(order, "probe", probe.closed),
      ]);
      const endpointClosed = logClose(order, "endpoint", net.endpoint.closed);

      await net.serverSessions[0].sendDatagram(new Uint8Array(1));
      await armed.promise;
      // A client that is still open gets the answer to this stream.
      await Promise.race([Promise.all([sessionsClosed, endpointClosed]), answered(live)]);

      expect({ sessions: order.slice(0, 2).toSorted(), then: order.slice(2) }).toEqual({
        sessions: ["live closed", "probe closed"],
        then: ["endpoint closed with ERR_QUIC_ENDPOINT_CLOSED"],
      });
    });

    // `connect()` with no `endpoint` option reuses an endpoint. It must not
    // pick one that a receive error is closing.
    test("a connect() after a receive error uses another endpoint", async () => {
      const armed = Promise.withResolvers<void>();
      const serverSessions: any[] = [];
      const clientSessions: any[] = [];
      using _fault = { [Symbol.dispose]: () => fault.clear() };
      await using server = await listen(onServerSession(serverSessions), {
        sni,
        alpn: ["quic-test"],
        transportParams: tp,
      });
      using _sessions = destroyAtExit(clientSessions, serverSessions);
      const options = {
        ...clientOptions,
        ondatagram() {
          fault.set(receiveError);
          armed.resolve();
        },
      };
      const first = ignoreSettlement(await connect(server.address, options));
      clientSessions.push(first);
      await first.opened;
      const firstEndpoint = first.endpoint;
      firstEndpoint.closed.catch(() => {});

      await serverSessions[0].sendDatagram(new Uint8Array(1));
      await armed.promise;
      // A client that is still open gets the answer to this stream.
      const firstEnded = await Promise.race([first.closed.then(() => "closed"), answered(first)]);
      const second = ignoreSettlement(await connect(server.address, clientOptions));
      clientSessions.push(second);
      await second.opened;

      expect({ firstEnded, sameEndpoint: second.endpoint === firstEndpoint }).toEqual({
        firstEnded: "closed",
        sameEndpoint: false,
      });
    });
  });
});
