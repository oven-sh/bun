// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { socketFaultInjection } from "bun:internal-for-testing";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, libcPathForDlopen, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { BlockList, SocketAddress } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { connect, listen, QuicEndpoint, type EndpointOptions, type SessionOptions } from "node:quic";
import { inspect } from "node:util";

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
    const raw = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    } as SessionOptions);
    await raw.opened;
    raw.close();

    // The engine is raw now; an h3 (default-ALPN) connect cannot reuse it.
    expect(() => connect(server.address!, { endpoint, verifyPeer: "manual" } as SessionOptions)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_STATE" }),
    );
    await endpoint.close();
  });
});

describe("connect() without an endpoint option", () => {
  test("only shares an endpoint between sessions with the same engine options", async () => {
    let serverSaw: (initialMaxStreamsBidi: bigint) => void;
    await using server = await listen(
      async (session: any) => {
        session.closed.catch(() => {});
        await session.opened;
        serverSaw(session.remoteTransportParams.initialMaxStreamsBidi);
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );
    const advertised: bigint[] = [];
    const sessions: any[] = [];
    for (const initialMaxStreamsBidi of [10, 50, 50]) {
      const seen = new Promise<bigint>(resolve => (serverSaw = resolve));
      const session = await connect(server.address!, {
        alpn: "quic-test",
        verifyPeer: "manual",
        transportParams: { initialMaxStreamsBidi },
      } as SessionOptions);
      sessions.push(session);
      await session.opened;
      advertised.push(await seen);
    }
    const [a, b, c] = sessions.map(session => session.endpoint);
    for (const session of sessions) session.close();
    expect({ advertised, shared: [a === b, b === c] }).toEqual({ advertised: [10n, 50n, 50n], shared: [false, true] });
  });
});

describe("inspecting an endpoint with live sessions", () => {
  test("prints each session once", async () => {
    await using server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );
    await using endpoint = new QuicEndpoint();
    const clients: any[] = [];
    for (let i = 0; i < 3; i++) {
      const client = await connect(server.address!, {
        endpoint,
        alpn: "quic-test",
        verifyPeer: "manual",
      } as SessionOptions);
      clients.push(client);
      await client.opened;
    }
    const sessionsIn = (text: string) => text.match(/QuicSession \{/g)?.length;
    const inEndpoint = sessionsIn(Bun.inspect(server));
    const inSession = sessionsIn(Bun.inspect(clients[0]));
    // Without the cycle check, unlimited depth never returns.
    const unlimited = inEndpoint === 3 ? sessionsIn(inspect(server, { depth: null })) : undefined;
    for (const client of clients) client.close();
    expect({ inEndpoint, inSession, unlimited }).toEqual({ inEndpoint: 3, inSession: 3, unlimited: 3 });
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
      endpoint: { blockList, blockListPolicy: "deny" } as EndpointOptions,
    });

    const stray = Buffer.alloc(64, 0x41);
    const sock = createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      sock.send(stray, receiver.address!.port, "127.0.0.1", err => (err ? reject(err) : resolve()));
    });
    sock.close();

    const client = await connect(receiver.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
    await client.opened;
    client.close();

    expect({
      receiver: (receiver.stats as any).packetsBlocked,
      filtered: (filtered.stats as any).packetsBlocked,
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
    expect([typeof h3.address!.port, typeof raw.address!.port]).toEqual(["number", "number"]);
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

    const client = await connect(peer.address!, {
      endpoint: dual,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
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

  // To the server engine, the peer's long-header packets would be the first packets of new connections.
  test("doesn't refuse its own client connection while it's busy as a server", async () => {
    const transportParams = { maxIdleTimeout: 1 };
    const sni = { "*": { keys: [key], certs: [cert] } };
    const quiet = (session: any) => void session.closed.catch(() => {});
    await using peer = await listen(quiet, { sni, alpn: ["dual-test"], transportParams });
    await using dual = await listen(quiet, { sni, alpn: ["dual-test"], transportParams });

    const client = await connect(peer.address!, {
      endpoint: dual,
      alpn: "dual-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams,
    } as SessionOptions);
    dual.busy = true;
    await client.opened;
    client.close();

    expect(dual.stats.serverBusyCount).toBe(0n);
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
      const client = await connect(server.address!, {
        endpoint,
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: { maxIdleTimeout: 3 },
      } as SessionOptions);
      await client.opened;
      const remote = (client as any).remoteTransportParams.maxIdleTimeout;
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
describe("the default congestion controller", () => {
  test("keeps its window while the sender's event loop is busy", async () => {
    let received = 0;
    await using server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
        session.onstream = async (stream: any) => {
          stream.closed.catch(() => {});
          stream.setBody(null);
          for await (const batch of stream) for (const chunk of batch) received += chunk.byteLength;
        };
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
    );
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--no-warnings",
        join(import.meta.dir, "busy-loop-sender-fixture.ts"),
        String(server.address!.port),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // Kills a sender that hangs, before the test's own timeout.
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // If the sender had to be killed, its output and the bytes it sent show where it hung.
    expect({ stderr, killed: proc.signalCode && { stdout, received } }).toEqual({ stderr: "", killed: null });
    // BBRv1 takes loop latency for the path and shrinks to its 4-packet floor, 5840 bytes. Cubic only reacts to loss.
    expect(JSON.parse(stdout).minCwnd).toBeGreaterThanOrEqual(16 * 1024);
    expect(exitCode).toBe(0);
  }, 20_000);
});

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
    const address = server.address!;

    // Hold one session open so close() has to drain instead of finishing now.
    await using holdEndpoint = new QuicEndpoint();
    const held = await connect(address, {
      endpoint: holdEndpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
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
    } as SessionOptions);
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

// https://github.com/oven-sh/bun/issues/45499
describe("closing a session with error code 0", () => {
  // An idle timeout resolves the peer's `closed` too, so keep it longer than the test timeout.
  const transportParams = { maxIdleTimeout: 600 };

  async function closeSeenByPeer(close: (session: any) => unknown) {
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(
      (session: any) => {
        session.closed.catch(() => {});
        accepted.resolve(session);
      },
      { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], transportParams },
    );
    await using endpoint = new QuicEndpoint();
    const session = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams,
    } as SessionOptions);
    session.closed.catch(() => {});
    await session.opened;
    const peer = await accepted.promise;
    await peer.opened;
    close(session);
    return peer.closed.then(
      () => "resolved",
      (err: any) => `${err.code} ${err.errorCode}`,
    );
  }

  test.each([
    ["an application close", { type: "application" }],
    ["an application close with a reason", { type: "application", reason: "bye" }],
    ["a transport close", { type: "transport" }],
    ["a transport close with a reason", { type: "transport", reason: "bye" }],
  ])("%s resolves the peer's closed", async (_, rest) => {
    const options = { code: 0n, ...rest };
    expect(await closeSeenByPeer(session => session.close(options))).toBe("resolved");
    expect(await closeSeenByPeer(session => session.destroy(undefined, options))).toBe("resolved");
  });

  test("a nonzero application code still rejects the peer's closed", async () => {
    expect(await closeSeenByPeer(session => session.destroy(undefined, { code: 2n, type: "application" }))).toBe(
      "ERR_QUIC_APPLICATION_ERROR 2",
    );
  });
});

// lsquic takes a short return from the endpoint's send callback for a blocked socket. It pauses every
// session of the engine and drops the waiting packets that only hold DATAGRAM frames.
describe("a send that fails for one destination", () => {
  const transportParams = { maxIdleTimeout: 30 };
  const sni = { "*": { keys: [key], certs: [cert] } };
  const clientOptions = { alpn: "quic-test", servername: "localhost", verifyPeer: "manual", transportParams };
  const loopTurn = () => new Promise<void>(resolve => setImmediate(resolve));
  const ignoreSettlement = (session: any) => {
    session.opened.catch(() => {});
    session.closed.catch(() => {});
    return session;
  };
  // A graceful close would wait for a peer that can't answer.
  const destroyAtExit = (...sessions: any[][]) => ({
    [Symbol.dispose]() {
      for (const session of sessions.flat()) session.destroy();
    },
  });
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
  // Once the answer is in, each side has every packet the other sent before it.
  async function roundTrip(session: any) {
    const stream = await session.createBidirectionalStream({ body: new Uint8Array(1) });
    stream.closed.catch(() => {});
    for await (const _ of stream);
  }

  // The endpoint is bound to 127.0.0.1. No platform sends to an IPv6 address from an IPv4 socket, and Linux refuses the other two.
  test.each(["[::1]:443", ...(isLinux ? ["192.0.2.1:443", "255.255.255.255:443"] : [])])(
    "to %s doesn't stall the endpoint's other session",
    async address => {
      const received: number[] = [];
      const serverSessions: any[] = [];
      const clientSessions: any[] = [];
      await using server = await listen(onServerSession(serverSessions), {
        sni,
        alpn: ["quic-test"],
        transportParams,
        ondatagram(datagram: Uint8Array) {
          received.push(datagram[0]);
        },
      });
      await using endpoint = new QuicEndpoint();
      using _ = destroyAtExit(clientSessions, serverSessions);
      const live = await connect(server.address!, { ...clientOptions, endpoint } as SessionOptions);
      clientSessions.push(live);
      await live.opened;
      const refused = ignoreSettlement(await connect(address, { ...clientOptions, endpoint } as SessionOptions));
      clientSessions.push(refused);

      // One loop turn per datagram, so each one gets its own send pass.
      const sent = Array.from({ length: 10 }, (_, id) => id);
      for (const id of sent) {
        await live.sendDatagram(new Uint8Array([id]));
        await loopTurn();
      }
      // Without the refused session, the round trip also completes on an endpoint that was stalled.
      refused.destroy();
      await roundTrip(live);

      expect(received).toEqual(sent);
    },
  );

  // With IP_RECVERR, a socket reports the ICMP error about one peer on its next send, whatever that send's destination is.
  test.skipIf(!isLinux)("an ICMP error about dead peers doesn't fail the sends to a live peer", async () => {
    const received: number[] = [];
    const serverSessions: any[] = [];
    const clientSessions: any[] = [];
    let onRound = () => {};
    await using server = await listen(onServerSession(serverSessions), {
      sni,
      alpn: ["quic-test"],
      transportParams,
      // Only the live client sends. The answers to all sessions leave in one pass.
      ondatagram(datagram: Uint8Array) {
        for (const session of serverSessions) session.sendDatagram(datagram);
        onRound();
      },
    });
    await using endpoint = new QuicEndpoint();
    using _ = destroyAtExit(clientSessions, serverSessions);
    using sockets = new DisposableStack();

    const live = await connect(server.address!, {
      ...clientOptions,
      endpoint,
      ondatagram(datagram: Uint8Array) {
        received.push(datagram[0]);
      },
    } as SessionOptions);
    clientSessions.push(live);
    await live.opened;

    // Each dead peer connects through a UDP relay. Closing `upstream` makes the kernel answer the server with ICMP port unreachable.
    const upstreams: ReturnType<typeof createSocket>[] = [];
    for (let i = 0; i < 3; i++) {
      const front = createSocket("udp4");
      const upstream = createSocket("udp4");
      sockets.defer(() => front.close());
      let clientPort = 0;
      upstream.on("message", packet => front.send(packet, clientPort, "127.0.0.1"));
      front.on("message", (packet, from) => {
        clientPort = from.port;
        if (upstreams.includes(upstream)) upstream.send(packet, server.address!.port, "127.0.0.1");
      });
      front.bind(0, "127.0.0.1");
      upstream.bind(0, "127.0.0.1");
      await Promise.all([once(front, "listening"), once(upstream, "listening")]);
      upstreams.push(upstream);
      const session = ignoreSettlement(
        await connect(`127.0.0.1:${front.address().port}`, { ...clientOptions, endpoint } as SessionOptions),
      );
      clientSessions.push(session);
      await session.opened;
    }
    const [, ...sessionsOfDeadPeers] = serverSessions;
    expect(sessionsOfDeadPeers).toHaveLength(3);
    for (const upstream of upstreams.splice(0)) upstream.close();

    const rounds = Array.from({ length: 10 }, (_, round) => round);
    for (const round of rounds) {
      const handled = new Promise<void>(resolve => (onRound = resolve));
      await live.sendDatagram(new Uint8Array([round]));
      await handled;
      await loopTurn();
    }
    // Without them no new ICMP error arrives, so the round trip also completes on an endpoint that lost datagrams.
    for (const session of sessionsOfDeadPeers) session.destroy();
    await roundTrip(live);

    expect(received).toEqual(rounds);
  });
});

describe("ondatagramstatus", () => {
  const sni = { "*": { keys: [key], certs: [cert] } };
  // Two LARGE datagrams don't fit in one packet. Three SMALL ones do.
  const LARGE = 1100;
  const SMALL = 200;
  // The relay only sees ciphertext, so it picks 1-RTT packets by length. A path MTU probe is longer than 1400 bytes.
  const lengthIn = (min: number, max: number) => (packet: Buffer) =>
    !(packet[0] & 0x80) && packet.length >= min && packet.length < max;
  const carriesLarge = lengthIn(LARGE, 1400);
  const carriesThreeSmall = lengthIn(3 * SMALL, LARGE);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const all = (status: string, from: number, to: number) =>
    Object.fromEntries(range(from, to).map(id => [id, [status]]));

  // A client session that reaches the server through a UDP relay, which drops the client packets `lose` picks.
  async function sessionThroughRelay(lose: (packet: Buffer) => boolean) {
    await using setup = new AsyncDisposableStack();
    const received: number[] = [];
    const statuses = new Map<number, string[]>();
    let check = () => {};
    const failed = Promise.withResolvers<never>();
    failed.promise.catch(() => {});
    const serverSession = Promise.withResolvers<any>();
    const server = setup.use(
      await listen(
        session => {
          session.onerror = failed.reject;
          session.closed.catch(() => {});
          serverSession.resolve(session);
        },
        {
          sni,
          alpn: ["quic-test"],
          transportParams: { maxIdleTimeout: 10 },
          // The first byte of each datagram is its id.
          ondatagram(datagram: Uint8Array) {
            received.push(datagram[0]);
            check();
          },
        },
      ),
    );
    setup.defer(() => void serverSession.promise.then(session => session.destroy()));

    const front = createSocket("udp4");
    const upstream = createSocket("udp4");
    setup.defer(() => void (front.close(), upstream.close()));
    let clientPort = 0;
    upstream.on("message", packet => front.send(packet, clientPort, "127.0.0.1"));
    front.on("message", (packet, from) => {
      clientPort = from.port;
      if (!lose(packet)) upstream.send(packet, server.address!.port, "127.0.0.1");
    });
    front.bind(0, "127.0.0.1");
    upstream.bind(0, "127.0.0.1");
    await Promise.all([once(front, "listening"), once(upstream, "listening")]);

    let streamRead = false;
    const client = await connect(`127.0.0.1:${front.address().port}`, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 10 },
      onerror: failed.reject,
      ondatagramstatus(id: bigint, status: string) {
        statuses.set(Number(id), [...(statuses.get(Number(id)) ?? []), status]);
        check();
      },
      async onstream(stream: any) {
        stream.closed.catch(() => {});
        for await (const _ of stream);
        streamRead = true;
        check();
      },
    } as SessionOptions);
    setup.defer(() => client.destroy());
    client.closed.then(() => failed.reject(new Error("the session closed")), failed.reject);
    await client.opened;

    const until = (done: () => boolean) =>
      Promise.race([
        failed.promise,
        new Promise<void>(resolve => {
          check = () => done() && resolve();
          check();
        }),
      ]);
    let sent = 0;
    const resources = setup.move();
    return {
      send: (size = LARGE) => (client.sendDatagram(Buffer.alloc(size, ++sent)), sent),
      status: (id: number) => until(() => statuses.has(id)).then(() => statuses.get(id)![0]),
      // The last datagram has to pass the relay. Once the server has it, the server opens a stream, and the packet
      // with the stream's data carries the ACKs the server still owes. The statuses follow the stream in the same pass.
      async settled() {
        await until(() => received.includes(sent));
        const stream = await (await serverSession.promise).createUnidirectionalStream({ body: new Uint8Array(1) });
        stream.closed.catch(() => {});
        await until(() => streamRead);
        await new Promise<void>(resolve => setImmediate(resolve));
        return { received: received.toSorted((a, b) => a - b), statuses: Object.fromEntries(statuses) };
      },
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  }

  test.each([
    { lost: 1, of: 6 },
    { lost: 3, of: 8 },
  ])("reports the loss of datagram $lost of $of under its id", async ({ lost, of }) => {
    let carriers = 0;
    await using net = await sessionThroughRelay(packet => carriesLarge(packet) && ++carriers === lost);

    for (let i = 0; i < of; i++) net.send();

    expect(await net.settled()).toEqual({
      received: range(1, of).filter(id => id !== lost),
      statuses: { ...all("acknowledged", 1, of), [lost]: ["lost"] },
    });
  });

  test("reports each datagram of a lost packet that carried several", async () => {
    await using net = await sessionThroughRelay(carriesThreeSmall);

    // This `await` resumes inside the session's dispatch of the status. Writes made there leave in one packet.
    expect(await net.status(net.send())).toBe("acknowledged");
    for (let i = 0; i < 3; i++) net.send(SMALL);
    for (let i = 0; i < 6; i++) net.send();

    expect(await net.settled()).toEqual({
      received: [1, ...range(5, 10)],
      statuses: { ...all("acknowledged", 1, 10), ...all("lost", 2, 4) },
    });
  });

  // At its next tick, lsquic drops a packet that's waiting for a blocked socket if it only holds DATAGRAM frames.
  test.skipIf(!socketFaultInjection.available())(
    "reports a datagram that's dropped before the send as lost",
    async () => {
      await using net = await sessionThroughRelay(() => false);
      expect(await net.status(net.send())).toBe("acknowledged");

      // No packet leaves the process, so nothing can acknowledge the datagram or declare its packet lost.
      socketFaultInjection.set({ syscall: "sendmsg", action: "errno", errno: "ENOBUFS", repeat: -1 });
      try {
        let reported: string | undefined;
        net.status(net.send()).then(status => (reported = status));
        // Each further datagram ticks the connection.
        while (reported === undefined) {
          net.send();
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        expect(reported).toBe("lost");
      } finally {
        socketFaultInjection.clear();
      }
    },
  );

  // lsquic merges the ACK frames it reads in one batch of packets into one frame.
  test("reports a late datagram as acknowledged when the ACK that covers it arrives together with an older ACK", async () => {
    const MARK = 600;
    const carriesMark = lengthIn(MARK, LARGE);
    const received: number[] = [];
    const statuses: string[] = [];
    let sent = 0;
    const failed = Promise.withResolvers<never>();
    failed.promise.catch(() => {});
    const failWith = (session: any, name: string) => {
      session.onerror = failed.reject;
      session.closed.then(() => failed.reject(new Error(`the ${name} session closed`)), failed.reject);
    };
    let check = () => {};
    const until = (done: () => boolean) =>
      Promise.race([
        failed.promise,
        new Promise<void>(resolve => {
          check = () => done() && resolve();
          check();
        }),
      ]);

    // While `holding`, the relay holds every packet from both sides.
    let holding = false;
    let serverSession: any;
    await using server = await listen(
      session => {
        serverSession = session;
        failWith(session, "server");
      },
      {
        sni,
        alpn: ["quic-test"],
        transportParams: { maxIdleTimeout: 10 },
        ondatagram(this: any, datagram: Uint8Array) {
          received.push(datagram[0]);
          // The server sends this after the ACK for the packets it has, so it marks the end of a round.
          if (holding && received.length === sent) this.sendDatagram(new Uint8Array(MARK));
          check();
        },
      } as any,
    );
    const serverPort = server.address!.port;

    using cleanup = new DisposableStack();
    cleanup.defer(() => serverSession?.destroy());
    let clientPort = 0;
    const datagramPackets: Buffer[] = [];
    const otherClientPackets: Buffer[] = [];
    const serverPackets: Buffer[] = [];
    const upstream = cleanup.adopt(
      await Bun.udpSocket({
        hostname: "127.0.0.1",
        socket: {
          data(_socket, packet) {
            if (holding) serverPackets.push(Buffer.from(packet));
            else front.send(packet, clientPort, "127.0.0.1");
            check();
          },
          error: (_socket, error) => failed.reject(error),
        },
      }),
      socket => socket.close(),
    );
    const front = cleanup.adopt(
      await Bun.udpSocket({
        hostname: "127.0.0.1",
        socket: {
          data(_socket, packet, port) {
            clientPort = port;
            if (!holding) upstream.send(packet, serverPort, "127.0.0.1");
            else (carriesLarge(packet) ? datagramPackets : otherClientPackets).push(Buffer.from(packet));
            check();
          },
          error: (_socket, error) => failed.reject(error),
        },
      }),
      socket => socket.close(),
    );
    // All of `packets` are in the receiver's socket buffer before it reads, so it reads them in one batch.
    const sendBatch = (socket: typeof front, port: number, packets: Buffer[]) =>
      expect(socket.sendMany(packets.flatMap(packet => [packet, port, "127.0.0.1"]))).toBe(packets.length);

    const client = await connect(`127.0.0.1:${front.port}`, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 10 },
      ondatagram() {},
      ondatagramstatus(_id: bigint, status: string) {
        statuses.push(status);
        check();
      },
    } as SessionOptions);
    cleanup.defer(() => client.destroy());
    failWith(client, "client");
    await Promise.race([failed.promise, client.opened]);
    const send = (count: number) => {
      for (let i = 0; i < count; i++) client.sendDatagram(Buffer.alloc(LARGE, ++sent));
    };

    // Once the client has these statuses, the server owes no ACK.
    send(3);
    await until(() => statuses.length === 3);

    // A receiver can still split a batch into two reads, and that round merges nothing. Hence three rounds.
    for (let round = 1; round <= 3; round++) {
      holding = true;
      send(5);
      await until(() => datagramPackets.length === 5);
      const [late, ...rest] = datagramPackets.splice(0);

      // The server's first ACK has a gap where `late` belongs.
      sendBatch(upstream, serverPort, rest.slice(0, 3));
      await until(() => received.length === sent - 2 && serverPackets.length >= 1);
      const withGap = serverPackets.length;

      // Its second ACK reaches higher and has no gap.
      sendBatch(upstream, serverPort, [rest[3], late]);
      await until(() => serverPackets.some(carriesMark));
      expect(serverPackets.findIndex(carriesMark)).toBeGreaterThan(withGap);

      holding = false;
      sendBatch(front, clientPort, serverPackets.splice(0));
      sendBatch(upstream, serverPort, otherClientPackets.splice(0));
      await until(() => statuses.length === sent);
    }

    const { datagramsAcknowledged, datagramsLost } = client.stats;
    expect({ statuses, datagramsAcknowledged, datagramsLost }).toEqual({
      statuses: Array.from({ length: sent }, () => "acknowledged"),
      datagramsAcknowledged: BigInt(sent),
      datagramsLost: 0n,
    });
  });

  test("stops after a callback that destroys the session", async () => {
    const serverSession = Promise.withResolvers<any>();
    await using server = await listen(
      session => {
        session.onerror = () => {};
        session.closed.catch(() => {});
        serverSession.resolve(session);
      },
      { sni, alpn: ["quic-test"], ondatagram() {} },
    );
    const calls: string[] = [];
    const client = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      onerror() {},
      ondatagramstatus(id: bigint, status: string) {
        calls.push(`${id}:${status}`);
        if (id > 1n) throw new Error("from ondatagramstatus");
        // These leave in one packet, so one acknowledgement covers datagrams 2, 3 and 4.
        for (let i = 0; i < 3; i++) client.sendDatagram(new Uint8Array(SMALL));
      },
    } as SessionOptions);
    await client.opened;
    await client.sendDatagram(new Uint8Array(SMALL));

    // The throw destroys the session. An uncaught ERR_INTERNAL_ASSERTION for datagram 3 or 4 would fail the test.
    const closed = await client.closed.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    (await serverSession.promise).destroy();
    expect({ closed, calls }).toEqual({
      closed: "from ondatagramstatus",
      calls: ["1:acknowledged", "2:acknowledged"],
    });
  });
});

describe("maxConnectionsPerHost", () => {
  test("refuses a session over the limit until an earlier one closes", async () => {
    const accepted: any[] = [];
    await using server = await listen(
      (session: any) => {
        accepted.push(session);
      },
      {
        endpoint: { maxConnectionsPerHost: 2 },
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
      },
    );
    // Each client has its own endpoint, so the sessions share an IP address and differ in port.
    async function dial() {
      const session = await connect(server.address!, {
        endpoint: new QuicEndpoint(),
        alpn: "quic-test",
        verifyPeer: "manual",
      } as SessionOptions);
      session.closed.catch(() => {});
      const outcome = await session.opened.then(
        () => "opened",
        err => err.code,
      );
      return { session, outcome };
    }

    const first = await dial();
    const second = await dial();
    const third = await dial();
    const acceptedAtLimit = accepted.length;
    first.session.close();
    await accepted[0].closed;
    const fourth = await dial();
    for (const { session } of [second, third, fourth]) if (!session.destroyed) session.close();

    expect({
      outcomes: [first.outcome, second.outcome, third.outcome, fourth.outcome],
      acceptedAtLimit,
    }).toEqual({
      outcomes: ["opened", "opened", "ERR_QUIC_TRANSPORT_ERROR", "opened"],
      acceptedAtLimit: 2,
    });
  });
});

describe.skipIf(isWindows)("endpoint UDP socket options", () => {
  const listenOptions = { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] };
  const [SOL_SOCKET, SO_TYPE, SO_SNDBUF, SO_RCVBUF, IP_TTL, IPV6_V6ONLY] = isLinux
    ? [1, 3, 7, 8, 2, 26]
    : [0xffff, 0x1008, 0x1001, 0x1002, 4, 27];
  const [SOCK_DGRAM, IPPROTO_IP, IPPROTO_IPV6] = [2, 0, 41];

  let lib: ReturnType<typeof openLibc> | undefined;
  const openLibc = () =>
    dlopen(libcPathForDlopen(), {
      getsockopt: { args: [FFIType.int, FFIType.int, FFIType.int, FFIType.ptr, FFIType.ptr], returns: FFIType.int },
      getsockname: { args: [FFIType.int, FFIType.ptr, FFIType.ptr], returns: FFIType.int },
    });
  afterAll(() => lib?.close());

  function getsockopt(fd: number, level: number, option: number) {
    const value = new Int32Array(1);
    const { symbols } = (lib ??= openLibc());
    return symbols.getsockopt(fd, level, option, ptr(value), ptr(new Uint32Array([4]))) === 0 ? value[0] : null;
  }

  // Finds this process's UDP socket bound to `port`.
  function udpSocketFd(port: number) {
    for (const fd of readdirSync("/dev/fd").map(Number)) {
      if (getsockopt(fd, SOL_SOCKET, SO_TYPE) !== SOCK_DGRAM) continue;
      const addr = new Uint8Array(128);
      if (lib!.symbols.getsockname(fd, ptr(addr), ptr(new Uint32Array([addr.length]))) !== 0) continue;
      // sin_port and sin6_port are both at offset 2, in network byte order.
      if (((addr[2] << 8) | addr[3]) === port) return fd;
    }
    throw new Error(`no UDP socket is bound to port ${port}`);
  }

  test("udpReceiveBufferSize, udpSendBufferSize and udpTTL are set on the socket", async () => {
    await using server = await listen(() => {}, {
      ...listenOptions,
      endpoint: { udpReceiveBufferSize: 65536, udpSendBufferSize: 98304, udpTTL: 7 },
    });
    // Linux clamps the request to net.core.{r,w}mem_max and reports twice the result.
    const reported = (requested: number, max: string) =>
      isLinux ? 2 * Math.min(requested, Number(readFileSync(`/proc/sys/net/core/${max}`, "utf8"))) : requested;
    const fd = udpSocketFd(server.address!.port);
    expect({
      rcvbuf: getsockopt(fd, SOL_SOCKET, SO_RCVBUF),
      sndbuf: getsockopt(fd, SOL_SOCKET, SO_SNDBUF),
      ttl: getsockopt(fd, IPPROTO_IP, IP_TTL),
    }).toEqual({ rcvbuf: reported(65536, "rmem_max"), sndbuf: reported(98304, "wmem_max"), ttl: 7 });
  });

  const hasIPv6 = Object.values(networkInterfaces()).some(addresses => addresses?.some(a => a.family === "IPv6"));
  test.skipIf(!hasIPv6)("ipv6Only turns off dual-stack on an IPv6 endpoint", async () => {
    const address = "[::]:0";
    await using dualStack = await listen(() => {}, { ...listenOptions, endpoint: { address } });
    await using v6Only = await listen(() => {}, { ...listenOptions, endpoint: { address, ipv6Only: true } });
    expect({
      dualStack: getsockopt(udpSocketFd(dualStack.address!.port), IPPROTO_IPV6, IPV6_V6ONLY),
      v6Only: getsockopt(udpSocketFd(v6Only.address!.port), IPPROTO_IPV6, IPV6_V6ONLY),
    }).toEqual({ dualStack: 0, v6Only: 1 });
  });

  test("reusePort lets a second endpoint bind the same port", async () => {
    await using first = await listen(() => {}, { ...listenOptions, endpoint: { reusePort: true } as EndpointOptions });
    const { port } = first.address!;
    const second = await listen(() => {}, {
      ...listenOptions,
      endpoint: { address: `127.0.0.1:${port}`, reusePort: true } as EndpointOptions,
    });
    // A failed bind doesn't throw. listen() returns a destroyed endpoint whose `closed` rejects.
    const outcome = second.destroyed ? await second.closed.catch(err => err.message) : second.address!.port;
    if (!second.destroyed) await second.close();
    expect(outcome).toBe(port);
  });
});

describe("node:quic in a Worker", () => {
  test("worker.terminate() doesn't crash with live sessions and streams", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "quic-worker-terminate-fixture.ts"),
        join(keysDir, "agent1-key.pem"),
        join(keysDir, "agent1-cert.pem"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr contains each worker's ExperimentalWarning.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "PASS\n", stderr: expect.any(String), exitCode: 0 });
  }, 30000);

  test("worker.terminate() doesn't crash with sessions that are still in their handshake", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "quic-worker-terminate-handshake-fixture.ts"),
        join(keysDir, "agent1-key.pem"),
        join(keysDir, "agent1-cert.pem"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "PASS\n", stderr: expect.any(String), exitCode: 0 });
  }, 30000);
});

describe("a server session and its handshake", () => {
  const transportParams = { maxIdleTimeout: 1 };
  const sni = { "*": { keys: [key], certs: [cert] } };
  const alpn = "handshake-test";
  const dial = { alpn, servername: "localhost", verifyPeer: "manual", transportParams } as SessionOptions;
  const tls13Labels = [
    "CLIENT_HANDSHAKE_TRAFFIC_SECRET",
    "CLIENT_TRAFFIC_SECRET_0",
    "EXPORTER_SECRET",
    "SERVER_HANDSHAKE_TRAFFIC_SECRET",
    "SERVER_TRAFFIC_SECRET_0",
  ];
  const connectionRefused = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 2n };
  const quiet = (session: any) => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.opened.catch(() => {});
    return session;
  };
  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => "fulfilled" as const,
      (e: any) => ({ code: e?.code, errorCode: e?.errorCode }),
    );

  // A QUIC v1 Initial whose payload no key decrypts.
  function strayInitial(size: number) {
    const dcid = Buffer.from("stray-01");
    const head = [0xc0, 0, 0, 0, 1, dcid.length, ...dcid, 0, 0];
    const rest = size - head.length - 2;
    head.push(0x40 | (rest >> 8), rest & 0xff);
    return Buffer.concat([Buffer.from(head), Buffer.alloc(rest, 0x5a)], size);
  }

  test.each([64, 1200])("a %d-byte Initial that starts no handshake gets no session", async size => {
    let announced = 0;
    await using server = await listen(
      session => {
        announced++;
        quiet(session);
      },
      { sni, alpn: [alpn], transportParams },
    );
    const stray = await Bun.udpSocket({ hostname: "127.0.0.1" });
    stray.send(strayInitial(size), server.address!.port, "127.0.0.1");
    stray.close();
    // The server reads this connection's first packet after the stray datagram.
    await using endpoint = new QuicEndpoint();
    const client = quiet(await connect(server.address!, { ...dial, endpoint }));
    await client.opened;
    client.close();

    expect(announced).toBe(1);
  });

  test("has its path in the listen callback", async () => {
    const paths: { local: number; remote: number }[] = [];
    await using server = await listen(
      session => {
        quiet(session);
        paths.push({ local: session.path!.local.port, remote: session.path!.remote.port });
      },
      { sni, alpn: [alpn], transportParams },
    );
    await using endpoint = new QuicEndpoint();
    const client = quiet(await connect(server.address!, { ...dial, endpoint }));
    await client.opened;
    const clientPort = client.path.local.port;
    client.close();

    expect(paths).toEqual([{ local: server.address!.port, remote: clientPort }]);
  });

  test("onnewtoken gets the server's address", async () => {
    const got = Promise.withResolvers<any>();
    await using server = await listen(quiet, { sni, alpn: [alpn], transportParams });
    await using endpoint = new QuicEndpoint();
    const client = quiet(
      await connect(server.address!, {
        ...dial,
        endpoint,
        onnewtoken: (_token: Buffer, address: unknown) => got.resolve(address),
      } as SessionOptions),
    );
    const address = await got.promise;
    client.close();

    expect(address).toBeInstanceOf(SocketAddress);
    expect({ address: address.address, port: address.port }).toEqual({
      address: "127.0.0.1",
      port: server.address!.port,
    });
  });

  test("a failed handshake closes its own session, not another connection's from the same client endpoint", async () => {
    const sessions: Promise<unknown>[] = [];
    await using server = await listen(
      session => {
        quiet(session);
        sessions.push(outcome(session.opened));
      },
      { sni, alpn: [alpn], transportParams },
    );
    // One endpoint, so the server sees both connections from one address.
    await using endpoint = new QuicEndpoint();
    const right = quiet(await connect(server.address!, { ...dial, endpoint }));
    const wrong = quiet(await connect(server.address!, { ...dial, endpoint, alpn: "not-offered" }));
    const client = await Promise.all([outcome(right.opened), outcome(wrong.opened)]);
    const serverSide = await Promise.all(sessions);
    right.close();

    // TLS alert no_application_protocol (120) as a QUIC CRYPTO_ERROR (RFC 9001 §4.8).
    const noApplicationProtocol = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 0x178n };
    expect({ client, server: serverSide }).toEqual({
      client: ["fulfilled", noApplicationProtocol],
      server: ["fulfilled", noApplicationProtocol],
    });
  });

  test("keeps its key log when another connection from the same client endpoint closes mid-handshake", async () => {
    const logs = new Map<object, string[]>();
    const keptSession = Promise.withResolvers<object>();
    await using server = await listen(
      session => {
        quiet(session);
        logs.set(session, []);
        session.opened.then(
          () => keptSession.resolve(session),
          () => {},
        );
      },
      {
        sni,
        alpn: [alpn],
        keylog: true,
        transportParams,
        onkeylog(this: object, line: string) {
          logs.get(this)!.push(line);
        },
      } as any,
    );
    await using endpoint = new QuicEndpoint();
    const closing = quiet(await connect(server.address!, { ...dial, endpoint }));
    const kept = quiet(await connect(server.address!, { ...dial, endpoint }));
    closing.close();
    await kept.opened;
    // An NSS key log line is "<label> <client random> <secret>".
    const fields = logs.get(await keptSession.promise)!.map(line => String(line).trim().split(" "));
    kept.close();

    expect({ labels: fields.map(f => f[0]).sort(), clientRandoms: new Set(fields.map(f => f[1])).size }).toEqual({
      labels: tls13Labels,
      clientRandoms: 1,
    });
  });

  test.each(["busy", "at maxConnectionsTotal"])(
    "an endpoint that's %s refuses a connection before its TLS handshake",
    async limit => {
      let announced = 0;
      await using serverEndpoint = new QuicEndpoint(limit === "busy" ? {} : { maxConnectionsTotal: 1 });
      await using server = await listen(
        session => {
          announced++;
          quiet(session);
        },
        { endpoint: serverEndpoint, sni, alpn: [alpn], transportParams },
      );
      await using heldEndpoint = new QuicEndpoint();
      const held = quiet(await connect(server.address!, { ...dial, endpoint: heldEndpoint }));
      await held.opened;
      if (limit === "busy") serverEndpoint.busy = true;

      const clientKeyLog: string[] = [];
      await using refusedEndpoint = new QuicEndpoint();
      const refused = quiet(
        await connect(server.address!, {
          ...dial,
          endpoint: refusedEndpoint,
          keylog: true,
          // A client derives its first secret when it reads the server's first TLS flight.
          onkeylog: (line: string) => clientKeyLog.push(line),
        } as SessionOptions),
      );
      const [opened, closed] = await Promise.all([outcome(refused.opened), outcome(refused.closed)]);
      held.close();

      expect({ opened, closed, announced, clientKeyLog }).toEqual({
        opened: connectionRefused,
        closed: connectionRefused,
        announced: 1,
        clientKeyLog: [],
      });
    },
  );

  // The handshake completes without a session. Unless the endpoint refuses it, the client waits out its idle timeout.
  test("a client is refused when the listen callback throws", async () => {
    const server = await listen(
      () => {
        throw new Error("from the listen callback");
      },
      { sni, alpn: [alpn], transportParams },
    );
    const serverClosed = server.closed.then(
      () => "closed",
      (e: Error) => e.message,
    );
    await using endpoint = new QuicEndpoint();
    const client = quiet(
      await connect(server.address!, { ...dial, endpoint, transportParams: { maxIdleTimeout: 30 } }),
    );

    expect({ opened: await outcome(client.opened), serverClosed: await serverClosed }).toEqual({
      opened: connectionRefused,
      serverClosed: "from the listen callback",
    });
  });
});

// lsquic queues a stateless reset for retry when its send fails. The endpoint socket sets IP_RECVERR,
// so on Linux the ICMP port unreachable for one reset fails the next send with ECONNREFUSED.
describe("endpoint.close() with an unsent stateless reset", () => {
  test.skipIf(!isASAN || !isLinux)(
    "frees the reset's connection object",
    async () => {
      const fixture = `
        import { socketFaultInjection } from "bun:internal-for-testing";
        import { createPrivateKey } from "node:crypto";
        import { readFileSync } from "node:fs";
        import { listen } from "node:quic";

        const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));
        const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});
        const server = await listen(async s => {
          await s.closed.catch(() => {});
        }, {
          sni: { "*": { keys: [key], certs: [cert] } },
          transportParams: { maxIdleTimeout: 1 },
        });
        const { port } = server.address;

        // A short-header packet with an unknown DCID. The server answers each one with a stateless reset.
        const stray = fill => Buffer.alloc(64, fill);

        // The server socket's first writable event retries unsent packets, so wait until it has fired.
        const answered = Promise.withResolvers();
        const live = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data: () => answered.resolve() } });
        live.send(stray(0x40), port, "127.0.0.1");
        await answered.promise;
        live.close();

        // The server reads this packet on a later loop turn, so only its answer hits the fault.
        const unanswered = await Bun.udpSocket({ hostname: "127.0.0.1" });
        unanswered.send(stray(0x41), port, "127.0.0.1");
        socketFaultInjection.set({ syscall: "sendmsg", action: "errno", errno: "ENOBUFS", repeat: -1 });
        while (server.stats.statelessResetCount < 2n) await new Promise(resolve => setImmediate(resolve));
        console.log("resets=" + server.stats.statelessResetCount + " sent=" + server.stats.packetsSent);
        await server.close();
        socketFaultInjection.clear();
        unanswered.close();

        // The loop's send buffer still points into the unsent reset. Send one more
        // datagram to overwrite it, so LeakSanitizer doesn't see the reset as reachable.
        const last = await Bun.udpSocket({ hostname: "127.0.0.1" });
        last.send(Buffer.alloc(8), last.port, "127.0.0.1");
        last.close();
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: {
          ...bunEnv,
          NODE_NO_WARNINGS: "1",
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // sent=1 means the second reset was still unsent when the engine was destroyed.
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: "resets=2 sent=1",
        stderr: "",
        exitCode: 0,
      });
    },
    // LeakSanitizer needs more than the default 5 s on a debug build.
    60_000,
  );
});
