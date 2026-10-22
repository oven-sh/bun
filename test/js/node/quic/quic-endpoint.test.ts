// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { BlockList, SocketAddress } from "node:net";
import { join } from "node:path";
import { connect, listen, QuicEndpoint, type EndpointOptions, type SessionOptions } from "node:quic";

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

// lsquic merges the 1-RTT ACK frames that it reads in one batch of packets
// into one frame. A range of one frame that lay inside a range of the other
// cut the merged range short: [16-8] merged with [15-12][10-9] gave
// [16-12][10-9]. A packet that arrived late, and that only the newer frame
// acknowledged, was then declared lost.
describe("ACK frames read in one batch", () => {
  test("a packet is acknowledged when the frame that covers it is merged with an older frame", async () => {
    // Two datagrams of SIZE bytes do not fit in one packet. The relay sees
    // ciphertext, so it tells the packets apart by length: one with a SIZE
    // datagram, one with the server's MARK datagram. A path MTU probe is
    // longer than 1400 bytes.
    const SIZE = 1100;
    const MARK = 600;
    const lengthIn = (min: number, max: number) => (packet: Buffer) =>
      !(packet[0] & 0x80) && packet.length >= min && packet.length < max;
    const carriesDatagram = lengthIn(SIZE, 1400);
    const carriesMark = lengthIn(MARK, SIZE);

    const received: number[] = [];
    const statuses: string[] = [];
    let sent = 0;
    // A session or a socket that fails rejects the wait that is pending.
    const failed = Promise.withResolvers<never>();
    failed.promise.catch(() => {});
    const failWith = (session: any, name: string) => {
      session.onerror = failed.reject;
      session.closed.then(() => failed.reject(new Error(`the ${name} session closed`)), failed.reject);
    };
    // Each event source below calls `check`, and the pending wait tests its condition again.
    let check = () => {};
    const until = (done: () => boolean) =>
      Promise.race([
        failed.promise,
        new Promise<void>(resolve => {
          check = () => done() && resolve();
          check();
        }),
      ]);

    // While `keeping`, the relay below keeps what both sides send.
    let keeping = false;
    let serverSession: any;
    await using server = await listen(
      (session: any) => {
        serverSession = session;
        failWith(session, "server");
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        alpn: ["quic-test"],
        transportParams: { maxIdleTimeout: 10 },
        ondatagram(this: any, datagram: Uint8Array) {
          received.push(datagram[0]);
          // This datagram leaves after the ACK of the packets that the server has.
          if (keeping && received.length === sent) this.sendDatagram(new Uint8Array(MARK));
          check();
        },
      } as any,
    );
    const serverPort = server.address!.port;

    // The sessions and the sockets go first, then the server.
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
            if (keeping) serverPackets.push(Buffer.from(packet));
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
            if (!keeping) upstream.send(packet, serverPort, "127.0.0.1");
            else (carriesDatagram(packet) ? datagramPackets : otherClientPackets).push(Buffer.from(packet));
            check();
          },
          error: (_socket, error) => failed.reject(error),
        },
      }),
      socket => socket.close(),
    );
    // One call hands the receiver all `packets` before it reads: it reads them in one batch.
    const sendBatch = (socket: typeof front, port: number, packets: Buffer[]) =>
      expect(socket.sendMany(packets.flatMap(packet => [packet, port, "127.0.0.1"]))).toBe(packets.length);

    const client: any = await connect(new SocketAddress({ address: "127.0.0.1", port: front.port }), {
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
      for (let i = 0; i < count; i++) client.sendDatagram(Buffer.alloc(SIZE, ++sent));
    };

    // Datagrams 1 to 3 arrive in order. Once the client has their statuses, the server owes no ACK.
    send(3);
    await until(() => statuses.length === 3);

    // A receiver can still read a batch in two parts, and then a round ends
    // without a merge. So the test runs three rounds.
    for (let round = 1; round <= 3; round++) {
      // The relay keeps the packets of the next five datagrams: N to N+4.
      keeping = true;
      send(5);
      await until(() => datagramPackets.length === 5);
      const [n, ...later] = datagramPackets.splice(0);

      // N+1, N+2 and N+3 arrive: the ACK frame of the server has the gap of N.
      sendBatch(upstream, serverPort, later.slice(0, 3));
      await until(() => received.length === sent - 2 && serverPackets.length >= 1);
      const withGap = serverPackets.length;

      // N+4 and N arrive in one batch. The server answers it with one ACK
      // frame, which reaches higher than the first one and has no gap.
      sendBatch(upstream, serverPort, [later[3], n]);
      await until(() => serverPackets.some(carriesMark));
      expect(serverPackets.findIndex(carriesMark)).toBeGreaterThan(withGap);

      // The client reads both ACK frames in one batch, and lsquic merges them.
      keeping = false;
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
});
