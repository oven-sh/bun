// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, normalizeBunSnapshot, tempDir } from "harness";
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

// node:quic reads the caller's `ca`, `crl` and `certs` arrays twice: in JS to
// validate them, then in native code to copy them. An accessor on an element
// runs user code in the second read, after JS tested the endpoint state. Node
// reads every option before its native state test and before it binds
// (src/quic/endpoint.cc, DoListen and DoConnect): listen() is then a no-op
// and connect() fails with ERR_QUIC_CONNECTION_FAILED.
describe("user code that runs while native code reads the options", () => {
  const sni = { "*": { keys: [key], certs: [cert] } };
  const tp = { maxIdleTimeout: 1 };
  const ca = readFileSync(join(keysDir, "ca1-cert.pem"));
  const crl = readFileSync(join(keysDir, "ca2-crl.pem"));
  const badPem = Buffer.from("-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n");
  const onSession = (s: any) => {
    s.closed.catch(() => {});
  };
  const clientOptions = { alpn: "quic-test", verifyPeer: "manual", transportParams: tp };

  // destroy() at the end: a graceful close would wait one idle timeout for
  // each session whose client endpoint a test destroyed.
  let server: QuicEndpoint;
  beforeAll(async () => {
    server = await listen(onSession, { sni, alpn: ["quic-test"], transportParams: tp });
  });
  afterAll(async () => {
    await server.destroy();
  });

  // Element 0 runs `action` on its second read, the one in native code.
  function onNativeRead<T>(value: T, action: () => void): T[] {
    const array = [value];
    let reads = 0;
    Object.defineProperty(array, 0, {
      enumerable: true,
      get() {
        if (++reads === 2) action();
        return value;
      },
    });
    return array;
  }
  type Trap = (value: Buffer) => Buffer[];

  test.each<[string, (trap: Trap) => object]>([
    ["ca", trap => ({ sni, ca: trap(ca) })],
    ["crl", trap => ({ sni, crl: trap(crl) })],
    ["sni['*'].certs", trap => ({ sni: { "*": { keys: [key], certs: trap(cert) } } })],
    ["the certs of a named host", trap => ({ sni: { ...sni, "x.test": { keys: [key], certs: trap(cert) } } })],
  ])("listen() has not bound the endpoint when %s destroys it", async (_, options) => {
    const endpoint = new QuicEndpoint();
    let addressInAccessor: unknown = "the accessor did not run";
    const destroy = () => {
      addressInAccessor = endpoint.address;
      endpoint.destroy();
    };
    const returned = await listen(onSession, { endpoint, ...options(value => onNativeRead(value, destroy)) });
    expect({ addressInAccessor, returned: returned === endpoint }).toEqual({
      addressInAccessor: undefined,
      returned: true,
    });
    await endpoint.closed;
  });

  describe.each<[string, (trap: Trap) => object]>([
    ["ca", trap => ({ ca: trap(ca) })],
    ["crl", trap => ({ crl: trap(crl) })],
    ["certs", trap => ({ keys: [key], certs: trap(cert) })],
  ])("connect() fails when %s", (_, options) => {
    test.each<[string, boolean, (endpoint: QuicEndpoint) => unknown]>([
      ["destroys a new endpoint", false, endpoint => endpoint.destroy()],
      ["destroys an endpoint that has a session", true, endpoint => endpoint.destroy()],
      // close() waits for the session, so the endpoint is closing and not closed.
      ["closes an endpoint that has a session", true, endpoint => endpoint.close()],
    ])("%s", async (_, hasSession, act) => {
      const endpoint = new QuicEndpoint();
      let held;
      if (hasSession) {
        held = await connect(server.address!, { endpoint, ...clientOptions } as SessionOptions);
        held.closed.catch(() => {});
        await held.opened;
      }
      await expect(
        connect(server.address!, {
          endpoint,
          ...clientOptions,
          ...options(value => onNativeRead(value, () => act(endpoint))),
        } as SessionOptions),
      ).rejects.toMatchObject({ code: "ERR_QUIC_CONNECTION_FAILED", message: "QUIC connection failed" });
      held?.destroy();
      await endpoint.closed;
    });
  });

  // Both fixture modes also run on Node v26.3.0 built with QUIC, with this output.
  const fixture = join(import.meta.dir, "quic-endpoint-closed-by-option-fixture.ts");
  const runFixture = async (mode: string, flags: string[] = [], env: Record<string, string> = {}) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, fixture, mode, keysDir],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  };

  test.concurrent(
    "listen() leaves the native endpoint state alone",
    async () => {
      const { stdout, stderr, exitCode } = await runFixture("state", ["--expose-internals"]);
      expect({ state: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
        state: {
          inAccessor: { isBound: false, isListening: false },
          afterDestroy: { isBound: false, isListening: false },
          afterClose: { isBound: true, isListening: false },
        },
        stderr: "",
        exitCode: 0,
      });
    },
    30_000,
  );

  // Without the fix connect() returns a session on the destroyed endpoint, and
  // session.destroy() then reads the endpoint's freed lsquic callbacks.
  test.concurrent(
    "connect() returns no session to destroy",
    async () => {
      expect(await runFixture("destroy-session")).toEqual({
        stdout: "ERR_QUIC_CONNECTION_FAILED",
        stderr: "",
        exitCode: 0,
      });
    },
    30_000,
  );

  // Without the fix listen() builds an lsquic engine on the endpoint that the
  // accessor destroyed, and nothing destroys that engine.
  test.skipIf(!isASAN || !isLinux)(
    "listen() builds no engine on the destroyed endpoint",
    async () => {
      const leakSanitizer = {
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
      };
      expect(await runFixture("leak", [], leakSanitizer)).toEqual({ stdout: "closed", stderr: "", exitCode: 0 });
    },
    // LeakSanitizer needs more than the default 5 s on a debug build.
    60_000,
  );

  test("a listen() made from the accessor is the one that listens", async () => {
    const endpoint = new QuicEndpoint();
    const announced: string[] = [];
    const announce = (label: string) => (s: any) => {
      announced.push(label);
      s.closed.catch(() => {});
    };
    let inner: Promise<unknown> | undefined;
    const listenAgain = () => {
      inner = listen(announce("inner"), { endpoint, sni, alpn: ["inner-proto"], transportParams: tp });
    };
    await listen(announce("outer"), {
      endpoint,
      sni,
      alpn: ["outer-proto"],
      transportParams: tp,
      ca: onNativeRead(ca, listenAgain),
    });
    await inner;

    const dial = async (alpn: string) => {
      await using clientEndpoint = new QuicEndpoint();
      const client = await connect(endpoint.address!, {
        endpoint: clientEndpoint,
        ...clientOptions,
        alpn,
      } as SessionOptions);
      client.closed.catch(() => {});
      try {
        await client.opened;
        return "opened";
      } catch (error: any) {
        return error.code;
      } finally {
        client.destroy();
      }
    };
    // A session is announced at its first packet, before the ALPN is known.
    expect({ inner: await dial("inner-proto"), outer: await dial("outer-proto"), announced }).toEqual({
      inner: "opened",
      outer: "ERR_QUIC_TRANSPORT_ERROR",
      announced: ["inner", "inner"],
    });
    await endpoint.destroy();
  });

  // The first connect() on an endpoint builds its client engine. The outer
  // call must not build a second engine over the one the inner call built.
  test("a connect() made from the accessor keeps its session", async () => {
    const endpoint = new QuicEndpoint();
    let inner: ReturnType<typeof connect> | undefined;
    const connectAgain = () => {
      inner = connect(server.address!, { endpoint, ...clientOptions } as SessionOptions);
    };
    const sessions = await Promise.all([
      connect(server.address!, { endpoint, ...clientOptions, ca: onNativeRead(ca, connectAgain) } as SessionOptions),
      inner!,
    ]);
    for (const session of sessions) session.closed.catch(() => {});
    const opened = await Promise.all(sessions.map(session => session.opened));
    expect(opened.map(info => info.protocol)).toEqual(["quic-test", "quic-test"]);
    await endpoint.destroy();
  });

  // Function.prototype.bind reads `name` after listen() tested the endpoint
  // state in JS and before it calls native code.
  const callbackWithName = (onNameRead: () => void) =>
    Object.defineProperty(() => {}, "name", {
      get() {
        onNameRead();
        return "callback";
      },
    });

  test("listen() rejects when the endpoint is destroyed before the native call", async () => {
    const endpoint = new QuicEndpoint();
    await expect(
      listen(
        callbackWithName(() => endpoint.destroy()),
        { endpoint, sni },
      ),
    ).rejects.toMatchObject({
      code: "ERR_QUIC_ENDPOINT_CLOSED",
      message: "Endpoint is closed",
    });
    await endpoint.closed;
  });

  test("listen() is a no-op when the endpoint starts to close before the native call", async () => {
    const endpoint = new QuicEndpoint();
    const held = await connect(server.address!, { endpoint, ...clientOptions } as SessionOptions);
    held.closed.catch(() => {});
    await held.opened;
    expect(
      await listen(
        callbackWithName(() => endpoint.close()),
        { endpoint, sni },
      ),
    ).toBe(endpoint);
    held.destroy();
    await endpoint.closed;
  });

  test.each<[string, () => object, object]>([
    [
      "an invalid certificate",
      () => ({ sni: { "*": { keys: [key], certs: [badPem] } } }),
      { message: "tls: failed to parse certificate PEM" },
    ],
    [
      "an invalid certificate of a named host",
      () => ({ sni: { ...sni, "x.test": { keys: [key], certs: [badPem] } } }),
      { code: "ERR_INVALID_ARG_VALUE", message: "tls: failed to parse certificate PEM" },
    ],
    ["a mixed ALPN list", () => ({ sni, alpn: ["h3", "custom"] }), { code: "ERR_INVALID_ARG_VALUE" }],
    [
      "an accessor that throws",
      () => ({
        sni,
        ca: onNativeRead(ca, () => {
          throw new Error("thrown by the accessor");
        }),
      }),
      { message: "thrown by the accessor" },
    ],
  ])("listen() that rejects on %s does not bind the endpoint", async (_, options, error) => {
    const endpoint = new QuicEndpoint();
    await expect(listen(onSession, { endpoint, transportParams: tp, ...options() })).rejects.toMatchObject(error);
    expect(endpoint.address).toBeUndefined();
    // The endpoint keeps nothing from the failed call.
    await listen(onSession, { endpoint, sni, transportParams: tp });
    expect(endpoint.address!.port).toBeGreaterThan(0);
    await endpoint.close();
  });

  // listen() stored the ORIGIN frame payload (RFC 9412) before the steps that
  // can throw, so the next listen() on the endpoint advertised the hosts of
  // the call that failed.
  test("listen() that rejects leaves no ORIGIN frame for the next listen()", async () => {
    const endpoint = new QuicEndpoint();
    await expect(
      listen(onSession, { endpoint, sni: { ...sni, "stale.example": sni["*"] }, alpn: ["h3", "custom"] }),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
    await listen(
      (s: any) => {
        s.onstream = (stream: any) => stream.closed.catch(() => {});
        s.closed.catch(() => {});
      },
      {
        endpoint,
        sni,
        transportParams: tp,
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
        },
      },
    );

    const origins: string[][] = [];
    await using clientEndpoint = new QuicEndpoint();
    const client = await connect(endpoint.address!, {
      endpoint: clientEndpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
      onorigin: (list: string[]) => origins.push(list),
    } as SessionOptions);
    client.closed.catch(() => {});
    await client.opened;
    // The server sends ORIGIN with its SETTINGS, before it answers a request.
    const answered = Promise.withResolvers<void>();
    await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders: () => answered.resolve(),
    });
    await answered.promise;
    client.destroy();
    expect(origins).toEqual([]);
    await endpoint.destroy();
  });

  test("connect() that rejects while it reads its options does not bind the endpoint", async () => {
    const endpoint = new QuicEndpoint();
    const throwing = onNativeRead(ca, () => {
      throw new Error("thrown by the accessor");
    });
    await expect(
      connect(server.address!, { endpoint, ...clientOptions, ca: throwing } as SessionOptions),
    ).rejects.toMatchObject({ message: "thrown by the accessor" });
    expect(endpoint.address).toBeUndefined();
    await endpoint.close();
  });

  test("setSNIContexts() returns when certs destroys the endpoint", async () => {
    const endpoint = await listen(onSession, { sni, transportParams: tp });
    const certs = onNativeRead(cert, () => endpoint.destroy());
    expect(endpoint.setSNIContexts({ "x.test": { keys: [key], certs } })).toBeUndefined();
    await endpoint.closed;
  });

  // The default ALPN of an SNI identity is the ALPN the endpoint listens
  // with, so setSNIContexts() has to take it after the read that ran listen().
  test("setSNIContexts() uses the ALPN of a listen() made from the accessor", async () => {
    const endpoint = new QuicEndpoint();
    let listening: Promise<unknown> | undefined;
    const certs = onNativeRead(cert, () => {
      listening = listen(onSession, { endpoint, sni, alpn: ["quic-test"], transportParams: tp });
    });
    endpoint.setSNIContexts({ "x.test": { keys: [key], certs } });
    await listening;

    await using clientEndpoint = new QuicEndpoint();
    const client = await connect(endpoint.address!, {
      endpoint: clientEndpoint,
      servername: "x.test",
      ...clientOptions,
    } as SessionOptions);
    client.closed.catch(() => {});
    const { servername, protocol } = await client.opened;
    client.destroy();
    expect({ servername, protocol }).toEqual({ servername: "x.test", protocol: "quic-test" });
    await endpoint.destroy();
  });
});
