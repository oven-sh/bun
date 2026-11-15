// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
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
const lsanEnv = {
  BUN_DESTRUCT_VM_ON_EXIT: "1",
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
  LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
};

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

describe("a handshake in flight", () => {
  test.concurrent.each(["Bun.serve", "fetch", "node:quic"])(
    "completes when %s makes its first QUIC engine",
    async api => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(import.meta.dir, "quic-handshake-in-flight-fixture.ts"),
          api,
          join(keysDir, "agent1-key.pem"),
          join(keysDir, "agent1-cert.pem"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // stderr contains the ExperimentalWarning.
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: '{"result":"answered","connections":1}\n',
        stderr: expect.any(String),
        exitCode: 0,
      });
    },
  );
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
        env: { ...bunEnv, NODE_NO_WARNINGS: "1", ...lsanEnv },
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

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// uSockets closes a UDP socket on a poll error. On Linux it only does so if neither the error queue nor recvmmsg()
// reports the error, so the shim hides the ICMP error of a closed port from both.
test.skipIf(!isLinux || !cc)("an endpoint closes with a receive failure if uSockets closes its socket", async () => {
  using dir = tempDir("quic-receive-failure", {
    "shim.c": `
      #define _GNU_SOURCE
      #include <dlfcn.h>
      #include <errno.h>
      #include <sys/types.h>

      #define MSG_ERRQUEUE 0x2000

      static int failed_fd = -1;

      ssize_t recvmsg(int fd, void *msg, int flags) {
        if (flags & MSG_ERRQUEUE) {
          failed_fd = fd;
          errno = EAGAIN;
          return -1;
        }
        return ((ssize_t (*)(int, void *, int)) dlsym(RTLD_NEXT, "recvmsg"))(fd, msg, flags);
      }

      int recvmmsg(int fd, void *msgs, unsigned len, int flags, void *timeout) {
        if (fd == failed_fd) {
          failed_fd = -1;
          return 0;
        }
        return ((int (*)(int, void *, unsigned, int, void *)) dlsym(RTLD_NEXT, "recvmmsg"))(fd, msgs, len, flags, timeout);
      }
    `,
    "fixture.mjs": `
      import { connect, QuicEndpoint } from "node:quic";

      const gone = await Bun.udpSocket({ hostname: "127.0.0.1" });
      const address = { address: "127.0.0.1", port: gone.port };
      gone.close();
      const endpoint = new QuicEndpoint();
      const session = await connect(address, { endpoint, alpn: "x" });
      for (const { status, reason } of await Promise.allSettled([session.opened, session.closed, endpoint.closed])) {
        console.log(status, reason?.message);
      }
    `,
  });
  await using compiler = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await compiler.exited).toBe(0);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NODE_NO_WARNINGS: "1",
      LD_PRELOAD: [join(String(dir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "rejected Invalid state: Session was destroyed before it opened",
      "fulfilled undefined",
      "rejected QUIC endpoint closed: Receive failure (0)",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

describe.concurrent("transferred state and stats, and getters on options", () => {
  async function run(body: string, env = {}) {
    const fixture = `
      import { createPrivateKey } from "node:crypto";
      import { readFileSync } from "node:fs";
      import { connect, listen, QuicEndpoint } from "node:quic";

      const key = createPrivateKey(readFileSync(${JSON.stringify(join(keysDir, "agent1-key.pem"))}));
      const cert = readFileSync(${JSON.stringify(join(keysDir, "agent1-cert.pem"))});
      const identity = { keys: [key], certs: [cert] };
      const transportParams = { maxIdleTimeout: 2 };
      const client = { alpn: "x", verifyPeer: "manual", transportParams };
      const nativeTls = { keys: [key.export({ type: "pkcs8", format: "pem" })], certs: [cert] };
      const nativeAlpn = Buffer.from("\\x01x");
      async function until(condition) {
        const deadline = Date.now() + 4000;
        while (!condition()) {
          if (Date.now() > deadline) throw new Error("timed out: " + condition);
          await new Promise(setImmediate);
        }
      }
      const findSymbol = (object, name) => Object.getOwnPropertySymbols(object).find(s => s.description === name);
      function ignoreErrors(session) {
        session.onstream = stream => stream.closed.catch(() => {});
        session.opened.catch(() => {});
        session.closed.catch(() => {});
        return session;
      }
      // The first read is the validation in JS, the second read is native code.
      function onNativeRead(value, callback) {
        let reads = 0;
        return Object.defineProperty([], 0, { enumerable: true, get: () => (++reads === 2 && callback(), value) });
      }
      const binding = require("internal/test/binding").internalBinding("quic");
      const server = await listen(ignoreErrors, { sni: { "*": identity }, alpn: "x", transportParams });
      ${body}
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, NODE_NO_WARNINGS: "1", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // ASAN only tracks ArrayBuffer memory with Malloc=1. Without ASAN, the write lands in a buffer allocated later.
  const mallocEnv = isASAN ? { Malloc: "1", ASAN_OPTIONS: bunEnv.ASAN_OPTIONS + ":detect_leaks=0" } : {};
  const detachAndCopy = `
    const laterBuffers = [];
    function detachAndCopy(buffer) {
      const copy = buffer.slice(0);
      buffer.transfer(0);
      for (let i = 0; i < 128; i++) laterBuffers.push(new Uint8Array(new ArrayBuffer(copy.byteLength)));
      return copy;
    }
    const sizes = () => [...new Set(laterBuffers.map(bytes => bytes.length))].sort().join();
    const written = () => laterBuffers.filter(bytes => bytes.some(Boolean)).length;
  `;

  test("state isn't written to freed memory after its ArrayBuffer is transferred", async () => {
    const result = await run(
      `
        ${detachAndCopy}
        const { DataView } = globalThis;
        globalThis.DataView = function (buffer) {
          return new DataView(detachAndCopy(buffer));
        };
        const endpoint = new QuicEndpoint();
        const session = ignoreErrors(await connect(server.address, { ...client, endpoint }));
        await session.opened;
        (await session.createBidirectionalStream()).destroy();
        endpoint.busy = true;
        console.log(sizes(), written());
        process.exit(0);
      `,
      mallocEnv,
    );
    expect(result).toEqual({ stdout: "144,24,336 0\n", stderr: "", exitCode: 0 });
  });

  test("stats aren't written to freed memory after their ArrayBuffer is transferred", async () => {
    const result = await run(
      `
        ${detachAndCopy}
        const handle = new binding.Endpoint();
        const session = handle.connect(server.address, { tls: { alpn: nativeAlpn } });
        const stream = session.openStream(binding.STREAM_DIRECTION_BIDIRECTIONAL);
        for (const { stats } of [handle, session, stream]) detachAndCopy(stats);
        stream.destroy();
        session.destroy();
        handle.releaseSocket();
        console.log(sizes(), written());
        process.exit(0);
      `,
      mallocEnv,
    );
    expect(result).toEqual({ stdout: "144,152,336 0\n", stderr: "", exitCode: 0 });
  });

  test("connect() rejects if a getter on ca closes the endpoint", async () => {
    const result = await run(`
      const endpoint = new QuicEndpoint();
      const ca = onNativeRead(cert, () => endpoint.close());
      const session = await connect(server.address, { ...client, endpoint, ca }).then(ignoreErrors, e => console.log(e.code));
      await endpoint.closed;
      await new Promise(setImmediate);
      session?.destroy(undefined, { code: 1 });
      process.exit(0);
    `);
    expect(result).toEqual({ stdout: "ERR_QUIC_ENDPOINT_CLOSED\n", stderr: "", exitCode: 0 });
  });

  test.each(["transportParams", "qlog"])("connect() throws if the %s getter releases the socket", async name => {
    const result = await run(`
      const handle = new binding.Endpoint();
      handle.connect(server.address, { tls: { alpn: nativeAlpn } });
      try {
        handle.connect(server.address, { tls: { alpn: nativeAlpn }, get ${name}() { handle.releaseSocket(); } });
      } catch (e) {
        console.log(e.code);
      }
      process.exit(0);
    `);
    expect(result).toEqual({ stdout: "ERR_QUIC_ENDPOINT_CLOSED\n", stderr: "", exitCode: 0 });
  });

  test("listen() from a transportParams getter keeps its ORIGIN frame", async () => {
    const result = await run(`
      const endpoint = new QuicEndpoint();
      let inner;
      endpoint[findSymbol(QuicEndpoint.prototype, "kListen")](ignoreErrors, {
        tls: { ...nativeTls, origins: ["https://a.example"] },
        transportParams: {
          get maxIdleTimeout() {
            inner ??= listen(ignoreErrors, { endpoint, sni: { "*": identity, "b.example": identity } });
          },
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      ignoreErrors(await connect(endpoint.address, { verifyPeer: "manual", transportParams, onorigin: resolve }));
      console.log((await promise).join());
      process.exit(0);
    `);
    expect(result).toEqual({ stdout: "https://b.example\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!isASAN || !isLinux)(
    "listen() from a getter on certs doesn't leak an engine",
    async () => {
      const result = await run(
        `
          const endpoint = new QuicEndpoint();
          const options = certs => ({ endpoint, alpn: "x", sni: { "*": { keys: [key], certs } } });
          await listen(ignoreErrors, options(onNativeRead(cert, () => console.log(typeof listen(ignoreErrors, options([cert]))))));
          await Promise.all([endpoint.close(), server.close()]);
        `,
        lsanEnv,
      );
      expect(result).toEqual({ stdout: "object\n", stderr: "", exitCode: 0 });
    },
    // LeakSanitizer needs more than the default 5 s on a debug build.
    60_000,
  );

  test("listen() reads its options once, not once per session", async () => {
    const result = await run(`
      const handle = new binding.Endpoint();
      const stats = new BigUint64Array(handle.stats);
      // onSessionNew throws: the handle has no QuicEndpoint.
      process.on("uncaughtException", () => {});
      let listening = false, reads = 0;
      handle.listen({
        tls: { ...nativeTls, alpn: nativeAlpn },
        get qlog() {
          if (listening) {
            reads++;
            handle.releaseSocket();
          }
        },
      });
      listening = true;
      // A busy endpoint creates no provisional session, so the session is created in on_new_conn.
      handle.markBusy(true);
      ignoreErrors(await connect(handle.address(), client));
      await until(() => stats[binding.IDX_STATS_ENDPOINT_PACKETS_RECEIVED] > 0n);
      handle.markBusy(false);
      await until(() => stats[binding.IDX_STATS_ENDPOINT_SERVER_SESSIONS] > 0n);
      console.log(reads);
      process.exit(0);
    `);
    expect(result).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
  });
});
