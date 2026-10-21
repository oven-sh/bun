// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import dc from "node:diagnostics_channel";
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
});

// lsquic queues a stateless reset for retry when its send fails. The endpoint socket sets IP_RECVERR,
// so on Linux the ICMP port unreachable for one reset fails the next send with ECONNREFUSED.
describe("endpoint.close() with an unsent stateless reset", () => {
  test.skipIf(!isASAN || !isLinux)(
    "frees the reset's connection object",
    async () => {
      const fixture = `
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

        // Trigger two resets to ports that close before the server answers. The ICMP
        // error for the first reset makes the second send fail.
        const fills = [0x41, 0x42];
        const gone = await Promise.all(fills.map(() => Bun.udpSocket({ hostname: "127.0.0.1" })));
        gone.forEach((socket, i) => socket.send(stray(fills[i]), port, "127.0.0.1"));
        for (const socket of gone) socket.close();
        while (server.stats.statelessResetCount < 3n) await new Promise(resolve => setImmediate(resolve));
        console.log("resets=" + server.stats.statelessResetCount + " sent=" + server.stats.packetsSent);
        await server.close();

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

      // sent=2 means the third reset was still unsent when the engine was destroyed.
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: "resets=3 sent=2",
        stderr: "",
        exitCode: 0,
      });
    },
    // LeakSanitizer needs more than the default 5 s on a debug build.
    60_000,
  );
});

// Every address a session hands to JS is a net.SocketAddress, from the moment
// JS holds the session. Node's Session::Config takes both addresses
// (node/src/quic/session.h), and `session.path` keeps what it reads first.
describe("session addresses", () => {
  const sniOpt = { "*": { keys: [key], certs: [cert] } };
  const tp = { maxIdleTimeout: 1 };
  const plain = (addr: unknown) => {
    const { address, port, family } = (addr ?? {}) as Partial<SocketAddress>;
    return { isSocketAddress: addr instanceof SocketAddress, address, port, family };
  };
  const both = (path: any) => ({ local: plain(path?.local), remote: plain(path?.remote) });
  // "closed" when the session ends first, so a missing event shows in the diff and not as a timeout.
  const orClosed = <T>(event: Promise<T>, session: { closed: Promise<unknown> }) =>
    Promise.race([
      event,
      session.closed.then(
        () => "closed" as const,
        () => "closed" as const,
      ),
    ]);

  test("a server session has both in onsession, before the handshake", async () => {
    const seen = Promise.withResolvers<unknown>();
    await using server = await listen(
      (s: any) => {
        const early = s.path;
        const atOnsession = both(early);
        s.opened.then(() => seen.resolve({ atOnsession, cached: s.path === early }), seen.reject);
        s.closed.catch(() => {});
      },
      { sni: sniOpt, alpn: ["quic-test"], transportParams: tp },
    );
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
    await client.opened;
    const expected = { local: plain(server.address), remote: plain(endpoint.address) };
    const result = await orClosed(seen.promise, client);
    client.close();

    expect(result).toEqual({ atOnsession: expected, cached: true });
  });

  // Publishing the message reads session.path, so a subscriber alone decides
  // what the application's later reads return.
  test("quic.session.created.server carries the peer's address and leaves session.path right", async () => {
    const published = Promise.withResolvers<unknown>();
    const onCreated = (msg: any) => published.resolve(plain(msg.address));
    dc.subscribe("quic.session.created.server", onCreated);
    try {
      const seen = Promise.withResolvers<unknown>();
      await using server = await listen(
        (s: any) => {
          s.opened.then(() => seen.resolve(both(s.path)), seen.reject);
          s.closed.catch(() => {});
        },
        { sni: sniOpt, alpn: ["quic-test"], transportParams: tp },
      );
      await using endpoint = new QuicEndpoint();
      const client = await connect(server.address!, {
        endpoint,
        alpn: "quic-test",
        verifyPeer: "manual",
        transportParams: tp,
      } as SessionOptions);
      await client.opened;
      const local = plain(server.address);
      const remote = plain(endpoint.address);
      const result = {
        published: await orClosed(published.promise, client),
        path: await orClosed(seen.promise, client),
      };
      client.close();

      expect(result).toEqual({ published: remote, path: { local, remote } });
    } finally {
      dc.unsubscribe("quic.session.created.server", onCreated);
    }
  });

  // Node 26.3.0, which this port follows, announces a session before its
  // handshake. Later Node does not surface a failed handshake (nodejs/node#64132).
  test("a server session whose handshake fails has both in onerror", async () => {
    const seen = Promise.withResolvers<unknown>();
    let expected: unknown;
    {
      await using server = await listen(
        (s: any) => {
          s.onerror = () => seen.resolve({ destroyed: s.destroyed, ...both(s.path) });
          s.opened.then(
            () => seen.resolve("opened"),
            () => {},
          );
          s.closed.catch(() => {});
        },
        { sni: sniOpt, alpn: ["quic-test"], transportParams: tp },
      );
      await using endpoint = new QuicEndpoint();
      const client = await connect(server.address!, {
        endpoint,
        alpn: "not-offered",
        verifyPeer: "manual",
        transportParams: tp,
        onerror() {},
      } as SessionOptions);
      const closed = client.closed.catch(() => "rejected");
      expected = { destroyed: false, local: plain(server.address), remote: plain(endpoint.address) };
      await expect(client.opened).rejects.toThrow(expect.objectContaining({ code: "ERR_QUIC_TRANSPORT_ERROR" }));
      expect(await closed).toBe("rejected");
    }
    // Both endpoints are closed, so every server session has ended.
    seen.resolve("no server session reported an error");

    expect(await seen.promise).toEqual(expected);
  });

  // A resumed connection whose first request is queued before its first flush
  // sends the 0-RTT packet ahead of the Initial. Nothing announces that session
  // at the first packet: it is created when the handshake completes, with the
  // conn's own peer address.
  test("a server session for a resumed 0-RTT connection has both in onsession", async () => {
    const sessions: unknown[] = [];
    const resumedSeen = Promise.withResolvers<void>();
    await using server = await listen(
      (s: any) => {
        sessions.push(both(s.path));
        s.onstream = (st: any) => st.closed.catch(() => {});
        s.closed.catch(() => {});
        if (sessions.length === 2) resumedSeen.resolve();
      },
      {
        sni: sniOpt,
        transportParams: tp,
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
        },
      },
    );
    await using endpoint = new QuicEndpoint();
    const options = { endpoint, servername: "localhost", verifyPeer: "manual", transportParams: tp };
    const ticket = Promise.withResolvers<unknown>();
    const first = await connect(server.address!, { ...options, onsessionticket: ticket.resolve } as SessionOptions);
    await first.opened;
    const sessionTicket = await orClosed(ticket.promise, first);
    first.close();

    const resumed = await connect(server.address!, { ...options, sessionTicket } as SessionOptions);
    // No flush has happened since connect(), so this leaves as 0-RTT.
    const request = await resumed.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders() {},
    });
    request.closed.catch(() => {});
    const expected = { local: plain(server.address), remote: plain(endpoint.address) };
    const announced = await orClosed(resumedSeen.promise, resumed);
    const { earlyDataAccepted } = await resumed.opened;
    resumed.close();

    expect({ announced, earlyDataAccepted, resumed: sessions[1] }).toEqual({
      announced: undefined,
      earlyDataAccepted: true,
      resumed: expected,
    });
  });

  test("a client session has both as soon as connect() returns", async () => {
    await using server = await listen((s: any) => s.closed.catch(() => {}), {
      sni: sniOpt,
      alpn: ["quic-test"],
      transportParams: tp,
    });
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
    const atConnect = both(client.path);
    await client.opened;
    client.close();

    expect(atConnect).toEqual({ local: plain(endpoint.address), remote: plain(server.address) });
  });

  // A version the server does not speak makes connect() send a bare probe with
  // no lsquic conn behind the session.
  test("a version negotiation probe session has both", async () => {
    await using server = await listen((s: any) => s.closed.catch(() => {}), {
      sni: sniOpt,
      alpn: ["quic-test"],
      transportParams: tp,
    });
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: tp,
      version: 0x1a1a1a1a,
      onversionnegotiation() {},
      onerror() {},
    } as SessionOptions);
    const atConnect = both(client.path);
    const expected = { local: plain(endpoint.address), remote: plain(server.address) };
    await expect(client.closed).rejects.toThrow(
      expect.objectContaining({ code: "ERR_QUIC_VERSION_NEGOTIATION_ERROR" }),
    );

    expect(atConnect).toEqual(expected);
  });

  // Node's Session::EmitNewToken passes remote_address() (node/src/quic/session.cc).
  test("onnewtoken and quic.session.new.token get the server's address", async () => {
    const published = Promise.withResolvers<unknown>();
    const onToken = (msg: any) => published.resolve(plain(msg.address));
    dc.subscribe("quic.session.new.token", onToken);
    try {
      const delivered = Promise.withResolvers<unknown>();
      await using server = await listen((s: any) => s.closed.catch(() => {}), {
        sni: sniOpt,
        alpn: ["quic-test"],
        transportParams: tp,
      });
      await using endpoint = new QuicEndpoint();
      const client = await connect(server.address!, {
        endpoint,
        alpn: "quic-test",
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: tp,
        onnewtoken(token: Buffer, address: unknown) {
          delivered.resolve({ tokenBytes: token.length > 0, address: plain(address) });
        },
      } as SessionOptions);
      await client.opened;
      const address = plain(server.address);
      const result = {
        delivered: await orClosed(delivered.promise, client),
        published: await orClosed(published.promise, client),
      };
      client.close();

      expect(result).toEqual({ delivered: { tokenBytes: true, address }, published: address });
    } finally {
      dc.unsubscribe("quic.session.new.token", onToken);
    }
  });
});
