// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, normalizeBunSnapshot, tempDir, withoutAsanQuarantine } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
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

// The session of a server handshake exists from the handshake's first packet,
// and lsquic keeps it on the connection. So what the handshake reports (its key
// log, its failure, its completion) reaches that session and no other.
describe("a server session and its handshake", () => {
  const tp = { maxIdleTimeout: 1 };
  const sniOpt = { "*": { keys: [key], certs: [cert] } };
  const alpn = "handshake-test";
  const dial = { alpn, servername: "localhost", verifyPeer: "manual", transportParams: tp };
  const tls13Labels = [
    "CLIENT_HANDSHAKE_TRAFFIC_SECRET",
    "CLIENT_TRAFFIC_SECRET_0",
    "EXPORTER_SECRET",
    "SERVER_HANDSHAKE_TRAFFIC_SECRET",
    "SERVER_TRAFFIC_SECRET_0",
  ];
  // An NSS key log line is "<label> <client random> <secret>".
  const keyLogOf = (lines: string[]) => {
    const fields = lines.map(line => line.trim().split(" "));
    return { labels: fields.map(f => f[0]).sort(), clientRandoms: [...new Set(fields.map(f => f[1]))] };
  };
  const quiet = (s: any) => {
    s.onerror = () => {};
    s.closed.catch(() => {});
  };

  test("a session does not get the key log of a connection that the listen callback destroyed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "quic-keylog-refused-fixture.ts"),
        join(keysDir, "agent1-key.pem"),
        join(keysDir, "agent1-cert.pem"),
        "3",
        "3",
      ],
      // A session can only get another handshake's lines by mistake when its
      // own handshake's TLS state takes the allocation of a refused one's.
      // The release allocator hands a freed block out again. ASAN does so
      // only without its quarantine.
      env: withoutAsanQuarantine(bunEnv),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const own = { labels: tls13Labels, clientRandoms: 1 };
    // `stderr` holds the ExperimentalWarning of a clean run. It is in the
    // compared object so that a failure shows it.
    expect({ sessions: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      sessions: [own, own, own],
      stderr: expect.any(String),
      exitCode: 0,
    });
  }, 30000);

  test("a session keeps its key log when another connection from the same client endpoint closes during its handshake", async () => {
    const sessions: any[] = [];
    const logs = new Map<object, string[]>();
    await using server = await listen(
      (s: any) => {
        quiet(s);
        logs.set(s, []);
        sessions.push(s);
      },
      {
        sni: sniOpt,
        alpn: [alpn],
        keylog: true,
        transportParams: tp,
        onkeylog(this: object, line: string) {
          logs.get(this)!.push(line);
        },
      },
    );

    // One endpoint, so the server sees both connections from one address.
    await using endpoint = new QuicEndpoint();
    const first = await connect(server.address!, { ...dial, endpoint } as SessionOptions);
    first.closed.catch(() => {});
    const clientLines: string[] = [];
    const second = await connect(server.address!, {
      ...dial,
      endpoint,
      keylog: true,
      onkeylog(line: string) {
        clientLines.push(line);
      },
    } as SessionOptions);
    first.close();
    await second.opened;

    const opened = await Promise.any(sessions.map(s => s.opened.then(() => s)));
    expect(keyLogOf(logs.get(opened)!)).toEqual({
      labels: tls13Labels,
      clientRandoms: keyLogOf(clientLines).clientRandoms,
    });
    second.close();
  });

  test("a session gets its key log when the listen callback assigns the handler", async () => {
    const serverLines: string[] = [];
    const accepted = Promise.withResolvers<any>();
    await using server = await listen(
      (s: any) => {
        quiet(s);
        s.onkeylog = (line: string) => serverLines.push(line);
        accepted.resolve(s);
      },
      { sni: sniOpt, alpn: [alpn], keylog: true, transportParams: tp },
    );

    const clientLines: string[] = [];
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      ...dial,
      endpoint,
      keylog: true,
      onkeylog(line: string) {
        clientLines.push(line);
      },
    } as SessionOptions);
    await client.opened;
    await (
      await accepted.promise
    ).opened;

    expect(keyLogOf(serverLines)).toEqual({
      labels: tls13Labels,
      clientRandoms: keyLogOf(clientLines).clientRandoms,
    });
    client.close();
  });

  test("a session gets the key log of a handshake that the client then rejects", async () => {
    const serverLines: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = await listen(
      (s: any) => {
        s.onerror = () => {};
        s.closed.catch(() => {}).then(serverClosed.resolve);
      },
      {
        sni: sniOpt,
        alpn: [alpn],
        keylog: true,
        transportParams: tp,
        onkeylog(line: string) {
          serverLines.push(line);
        },
      },
    );

    // The client has no CA for the server's certificate. It ends the
    // handshake when it reads the server's reply, after the server made all
    // of its secrets.
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, {
      ...dial,
      endpoint,
      verifyPeer: "strict",
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    await expect(client.opened).rejects.toThrow();
    await serverClosed.promise;

    expect(keyLogOf(serverLines).labels).toEqual(tls13Labels);
  });

  // A refused client that logs no secrets got no TLS handshake from the
  // server: the refusal is the answer to its first packet.
  test.each(["busy", "at maxConnectionsTotal", "closing"] as const)(
    "an endpoint that is %s refuses a connection before its TLS handshake",
    async reason => {
      let announced = 0;
      const server = await listen(
        (s: any) => {
          announced++;
          quiet(s);
        },
        {
          endpoint: new QuicEndpoint(reason === "at maxConnectionsTotal" ? { maxConnectionsTotal: 1 } : {}),
          sni: sniOpt,
          alpn: [alpn],
          transportParams: tp,
        },
      );
      // close() clears `address`.
      const address = server.address!;

      await using heldEndpoint = new QuicEndpoint();
      const held = await connect(address, { ...dial, endpoint: heldEndpoint } as SessionOptions);
      await held.opened;
      if (reason === "busy") server.busy = true;
      if (reason === "closing") server.close();

      const clientLines: string[] = [];
      await using refusedEndpoint = new QuicEndpoint();
      const refused = await connect(address, {
        ...dial,
        endpoint: refusedEndpoint,
        keylog: true,
        onerror() {},
        onkeylog(line: string) {
          clientLines.push(line);
        },
      } as SessionOptions);
      const refusedClosed = refused.closed.catch(() => "rejected");
      await expect(refused.opened).rejects.toThrow(expect.objectContaining({ code: "ERR_QUIC_TRANSPORT_ERROR" }));
      expect(await refusedClosed).toBe("rejected");

      expect({ announced, clientKeyLog: clientLines }).toEqual({ announced: 1, clientKeyLog: [] });
      held.close();
      await server.close();
    },
  );

  test("the connection whose session the listen callback destroyed is the one that is refused", async () => {
    let announced = 0;
    await using server = await listen(
      (s: any) => {
        quiet(s);
        // The first session is for the connection whose first packet came first.
        if (++announced === 1) s.destroy();
      },
      { sni: sniOpt, alpn: [alpn], transportParams: tp },
    );

    // One endpoint, so the server sees both connections from one address.
    await using endpoint = new QuicEndpoint();
    const options = { ...dial, endpoint, onerror() {} } as SessionOptions;
    const first = await connect(server.address!, options);
    first.closed.catch(() => {});
    const second = await connect(server.address!, options);
    second.closed.catch(() => {});

    const [firstOpened, secondOpened] = await Promise.allSettled([first.opened, second.opened]);
    expect({ first: firstOpened.status, second: secondOpened.status }).toEqual({
      first: "rejected",
      second: "fulfilled",
    });
    second.close();
  });

  test("a datagram that starts no handshake announces no session", async () => {
    let announced = 0;
    await using server = await listen(
      (s: any) => {
        announced++;
        quiet(s);
      },
      { sni: sniOpt, alpn: [alpn], transportParams: tp },
    );

    // A QUIC v1 Initial header (RFC 9000 §17.2.2) with an 8-byte DCID, in a
    // datagram below the 1200 bytes a first Initial needs (RFC 9000 §14.1).
    const shortInitial = Buffer.alloc(64);
    shortInitial.set([0xc0, 0, 0, 0, 1, 8, 1, 2, 3, 4, 5, 6, 7, 8, 0]);
    const sock = createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      sock.send(shortInitial, server.address!.port, "127.0.0.1", err => (err ? reject(err) : resolve()));
    });
    sock.close();

    // The server reads this connection's first packet after that datagram.
    await using endpoint = new QuicEndpoint();
    const client = await connect(server.address!, { ...dial, endpoint } as SessionOptions);
    await client.opened;
    expect(announced).toBe(1);
    client.close();
  });
});
