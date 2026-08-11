// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
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

// lsquic's pacer expects to be ticked about when it asks to be (it lets a
// connection run one clock granularity, 1 ms, ahead of its schedule and has
// the engine wake it up then). Bun's engines are ticked from the event loop,
// so on a busy loop the next tick comes whenever JS is done, by which time
// everything in flight has been acknowledged. The pacer used to take that as a
// restart, hand out its ten burst tokens and then let through one more
// millisecond's worth, so however wide the window was, an iteration of a busy
// loop moved ten packets plus a sliver of it: a tenth to a fifth of the window
// here. The pacer-late-tick-credit vendor patch lets such a tick send what was
// due since the last one, which on a busy loop is the window.
//
// busy-loop-pacer-fixture.ts samples the session's bytes sent and window at
// every iteration boundary of its busy loop; asserted on is the share of its
// window that an iteration of the second half moved, on average. Debug builds
// measure about 0.9 on Linux and 0.75 to 0.9 on Windows with the patch and
// 0.1 to 0.25 without it, for both engines (listen() builds one, connect() the
// other). What keeps the patched figure below 1 is the sender running out of
// data every so often (the fixture sizes its chunks to last a good many
// iterations, and refilling costs it an iteration or two each time) and, on
// Windows, the occasional iteration whose ACKs get processed over more than
// the two ticks the patch credits a late tick back to.
//
// This needs Cubic's pacing rate to be sane, which on Windows it is not without
// the cubic-llp64-overflow patch (the rate wraps in 32-bit arithmetic): paced
// at that rate a busy connection moves about 1 KiB per iteration here.
describe.concurrent("pacing on a busy event loop", () => {
  const MIN_MEAN_WINDOW_SHARE = 0.4;
  const fixture = join(import.meta.dir, "busy-loop-pacer-fixture.ts");
  type Sample = { sent: number; cwnd: number };
  type Report = { samples: Sample[] };

  // Mean, over the iterations of the second half, of the share of its window
  // each iteration moved. An iteration counts for at most one window: the one
  // in which the sender refills its data takes longer than the others (see
  // the fixture) and moves more, and must not make up for the rest.
  function meanWindowShareMoved({ samples }: Report) {
    const secondHalf = samples.slice(Math.floor(samples.length / 2));
    let total = 0;
    for (let i = 1; i < secondHalf.length; i++) {
      total += Math.min(1, (secondHalf[i].sent - secondHalf[i - 1].sent) / secondHalf[i - 1].cwnd);
    }
    return total / (secondHalf.length - 1);
  }

  // The receiving side has to keep reading, or flow control rather than the
  // pacer would be what limits the sender.
  async function drain(stream: any) {
    for await (const _ of stream);
  }

  function spawnSender(args: string[]) {
    const port = Promise.withResolvers<number>();
    const report = Promise.withResolvers<Report>();
    const proc = Bun.spawn({
      cmd: [bunExe(), fixture, ...args],
      env: bunEnv,
      stderr: "pipe",
      ipc(message: { port: number } | Report) {
        if ("port" in message) port.resolve(message.port);
        else report.resolve(message);
      },
    });
    // A fixture that dies early fails the test instead of hanging it.
    const died = proc.exited.then(async code => {
      throw new Error(`fixture exited with code ${code} before reporting:\n${await proc.stderr.text()}`);
    });
    died.catch(() => {});
    return {
      proc,
      port: () => Promise.race([port.promise, died]),
      report: () => Promise.race([report.promise, died]),
    };
  }

  // Debug builds spend about two seconds just loading node:quic in the
  // fixture, and the busy loop itself runs for over a second.
  const TIMEOUT = 30_000;

  test(
    "a busy server session (listen engine) sends a window per loop iteration",
    async () => {
      const sender = spawnSender(["listen"]);
      await using _proc = sender.proc;
      const client = await connect(`127.0.0.1:${await sender.port()}`, { alpn: "quic-test", verifyPeer: "manual" });
      const closed = client.closed.then(
        () => {},
        () => {},
      );
      await client.opened;
      // A stream only reaches the peer once something is sent on it.
      const stream = await client.createBidirectionalStream({ body: "go" });
      stream.closed.catch(() => {});
      const draining = drain(stream);
      const report = await sender.report();
      await draining;
      await closed;
      expect(meanWindowShareMoved(report)).toBeGreaterThanOrEqual(MIN_MEAN_WINDOW_SHARE);
    },
    TIMEOUT,
  );

  test(
    "a busy client session (connect engine) sends a window per loop iteration",
    async () => {
      const closed = Promise.withResolvers<void>();
      const draining = Promise.withResolvers<Promise<void>>();
      await using server = await listen(
        (s: any) => {
          s.closed.then(closed.resolve, closed.resolve);
          s.onstream = (stream: any) => {
            stream.closed.catch(() => {});
            // Nothing to send back. Ending this side is what lets the fixture's
            // stream, and so its graceful session close, finish.
            stream.setBody(null);
            draining.resolve(drain(stream));
          };
        },
        { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
      );
      const sender = spawnSender(["connect", String(server.address.port)]);
      await using _proc = sender.proc;
      const report = await sender.report();
      await draining.promise;
      await closed.promise;
      expect(meanWindowShareMoved(report)).toBeGreaterThanOrEqual(MIN_MEAN_WINDOW_SHARE);
    },
    TIMEOUT,
  );
});
