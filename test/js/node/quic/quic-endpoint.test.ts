// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { createCipheriv, createDecipheriv, createHmac, createPrivateKey } from "node:crypto";
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

// RFC 9001 s5.2: a client protects its Initial packets with keys derived from
// their destination connection id and a public salt, so a UDP socket in the
// place of the server can read them.
const hmac = (key: Buffer, ...data: Buffer[]) => data.reduce((h, d) => h.update(d), createHmac("sha256", key)).digest();
// HKDF-Expand-Label (RFC 8446 s7.1) for an output of at most one hash block.
function expandLabel(secret: Buffer, label: string, length: number) {
  const full = Buffer.from("tls13 " + label, "ascii");
  return hmac(secret, Buffer.from([0, length, full.length]), full, Buffer.from([0, 1])).subarray(0, length);
}
function varint(buf: Buffer, at: number): [value: bigint, next: number] {
  const length = 1 << (buf[at] >> 6);
  let value = BigInt(buf[at] & 0x3f);
  for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(buf[at + i]);
  return [value, at + length];
}
type CloseFrame = { type: "transport" | "application"; code: bigint; reason: string };
type ClientInitials = { dcid: string; hello: string; ping: boolean; closes: CloseFrame[] };
/** What the QUIC v1 client Initial packets in `datagram` carry. `hello` is their CRYPTO data, the ClientHello. */
function readClientInitials(datagram: Buffer): ClientInitials {
  const buf = Buffer.from(datagram);
  const initials: ClientInitials = { dcid: "", hello: "", ping: false, closes: [] };
  // Packets are coalesced back to back. Zero padding can follow the last one.
  for (let start = 0; start < buf.length && buf[start] !== 0; ) {
    // Long header, type Initial (RFC 9000 s17.2.2), version 1.
    expect({ header: buf[start] & 0xf0, version: buf.readUInt32BE(start + 1) }).toEqual({ header: 0xc0, version: 1 });
    let at = start + 5;
    const dcid = buf.subarray(at + 1, at + 1 + buf[at]);
    initials.dcid = dcid.toString("hex");
    at += 1 + buf[at];
    at += 1 + buf[at]; // source connection id
    let tokenLength: bigint, length: bigint;
    [tokenLength, at] = varint(buf, at);
    at += Number(tokenLength);
    [length, at] = varint(buf, at);
    const pn = at;
    const end = pn + Number(length);
    const secret = expandLabel(
      hmac(Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex"), dcid),
      "client in",
      32,
    );
    // Header protection (RFC 9001 s5.4): the mask is AES-ECB of a ciphertext sample.
    const mask = createCipheriv("aes-128-ecb", expandLabel(secret, "quic hp", 16), null).update(
      buf.subarray(pn + 4, pn + 20),
    );
    buf[start] ^= mask[0] & 0x0f;
    const pnLength = (buf[start] & 0x03) + 1;
    const nonce = expandLabel(secret, "quic iv", 12);
    for (let i = 0; i < pnLength; i++) {
      buf[pn + i] ^= mask[1 + i];
      nonce[12 - pnLength + i] ^= buf[pn + i];
    }
    const decipher = createDecipheriv("aes-128-gcm", expandLabel(secret, "quic key", 16), nonce);
    decipher.setAAD(buf.subarray(start, pn + pnLength));
    decipher.setAuthTag(buf.subarray(end - 16, end));
    const payload = Buffer.concat([decipher.update(buf.subarray(pn + pnLength, end - 16)), decipher.final()]);
    for (at = 0; at < payload.length; ) {
      const type = payload[at++];
      if (type === 0x00) continue; // PADDING
      let n = 0n;
      if (type === 0x01) {
        initials.ping = true;
      } else if (type === 0x06) {
        // CRYPTO: offset, length, data
        [, at] = varint(payload, at);
        [n, at] = varint(payload, at);
        initials.hello += payload.toString("latin1", at, at + Number(n));
      } else if (type === 0x1c || type === 0x1d) {
        // CONNECTION_CLOSE: code, frame type (0x1c only), reason
        let code: bigint;
        [code, at] = varint(payload, at);
        if (type === 0x1c) [, at] = varint(payload, at);
        [n, at] = varint(payload, at);
        initials.closes.push({
          type: type === 0x1c ? "transport" : "application",
          code,
          reason: payload.toString("latin1", at, at + Number(n)),
        });
      } else {
        throw new Error(`unexpected frame type 0x${type.toString(16)} in a client Initial`);
      }
      at += Number(n);
    }
    start = end;
  }
  return initials;
}

/**
 * A UDP socket in the place of the server, and a client endpoint that dials
 * it. The socket sends only what `reply` returns, so a session never gets
 * past its Initial packets.
 */
async function udpPeer(reply?: (datagram: Buffer) => Buffer | undefined) {
  const socket = createSocket("udp4");
  const datagrams: Buffer[] = [];
  let received = Promise.withResolvers<void>();
  socket.on("message", (datagram, from) => {
    datagrams.push(datagram);
    received.resolve();
    const answer = reply?.(datagram);
    if (answer) socket.send(answer, from.port, from.address);
  });
  await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  const endpoint = new QuicEndpoint();
  const dial = (servername = "localhost") =>
    connect(
      { address: "127.0.0.1", port: socket.address().port },
      { endpoint, servername, verifyPeer: "manual", onerror() {} },
    );
  /** Waits for a datagram that is `wanted`. Returns what every datagram so far carries. */
  async function until(wanted: (initials: ClientInitials) => boolean) {
    for (;;) {
      const seen = datagrams.map(readClientInitials);
      if (seen.some(wanted)) return seen;
      received = Promise.withResolvers<void>();
      await received.promise;
    }
  }
  return {
    dial,
    until,
    /** What each connection has sent, in the order of their first datagrams. */
    async sent() {
      // No event says that nothing was sent. A new session on the same socket
      // sends its ClientHello after everything that the earlier ones sent.
      const sentinel = await dial("sentinel");
      sentinel.opened.catch(() => {});
      const isSentinel = (initials: ClientInitials) => initials.hello.includes("sentinel");
      const seen = await until(isSentinel);
      sentinel.destroy();
      const sentinelId = seen.find(isSentinel)!.dcid;
      const connections = Map.groupBy(
        seen.filter(initials => initials.dcid !== sentinelId),
        initials => initials.dcid,
      );
      return [...connections.values()].map(list => ({
        hello: list.some(initials => initials.hello !== ""),
        closes: list.flatMap(initials => initials.closes),
      }));
    },
    async [Symbol.asyncDispose]() {
      await endpoint[Symbol.asyncDispose]();
      socket.close();
    },
  };
}

type CloseOptions = { code?: bigint; type?: "transport" | "application"; reason?: string };
const act = (session: any, via: "close" | "destroy", options?: CloseOptions) =>
  via === "close" ? session.close(options) : session.destroy(undefined, options);
const show = (value: unknown) => Bun.inspect(value).replaceAll(/\s+/g, " ").replaceAll(", }", " }");
const showCall = (via: "close" | "destroy", options?: CloseOptions) =>
  via === "close"
    ? `close(${options ? show(options) : ""})`
    : `destroy(${options ? "undefined, " + show(options) : ""})`;
const GET = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

// Node reads `code` first and ignores `type` and `reason` without it: such a
// close() is a plain NO_ERROR close and such a destroy() sends nothing.
// https://github.com/nodejs/node/blob/v26.3.0/src/quic/session.cc#L904-L1000
describe("session close options before the server's first packet", () => {
  const noError = { type: "transport", code: 0n, reason: "" } as const;
  // RFC 9000 s10.2.3: an Initial packet cannot carry an application close. It
  // becomes the transport code APPLICATION_ERROR with no reason.
  const applicationError = { type: "transport", code: 0x0cn, reason: "" } as const;
  // A stream that waits for the handshake does not hold a close back.
  const pending = {
    "a pending request": { headers: GET },
    "a pending stream with a body": { body: new TextEncoder().encode("hello") },
  };
  const cells: [
    via: "close" | "destroy",
    options: CloseOptions | undefined,
    sent: CloseFrame | undefined,
    stream?: keyof typeof pending,
  ][] = [
    ["close", undefined, noError],
    ["close", {}, noError],
    ["close", { reason: "bye" }, noError],
    ["close", { type: "application" }, noError],
    ["close", { type: "application" }, noError, "a pending request"],
    ["close", { code: 0n }, noError],
    ["close", { code: 0n, reason: "bye" }, { type: "transport", code: 0n, reason: "bye" }],
    ["close", { code: 5n }, { type: "transport", code: 5n, reason: "" }],
    ["close", { code: 5n }, { type: "transport", code: 5n, reason: "" }, "a pending stream with a body"],
    ["close", { code: 5n, reason: "bye" }, { type: "transport", code: 5n, reason: "bye" }],
    ["close", { code: 5n, type: "application" }, applicationError],
    ["close", { code: 5n, type: "application", reason: "bye" }, applicationError],
    ["destroy", undefined, undefined],
    ["destroy", {}, undefined],
    ["destroy", { reason: "bye" }, undefined],
    ["destroy", { type: "application" }, undefined],
    ["destroy", { code: 0n }, noError],
    ["destroy", { code: 0n, reason: "bye" }, { type: "transport", code: 0n, reason: "bye" }],
    ["destroy", { code: 5n }, { type: "transport", code: 5n, reason: "" }],
    ["destroy", { code: 5n, reason: "bye" }, { type: "transport", code: 5n, reason: "bye" }],
    ["destroy", { code: 5n, type: "application", reason: "bye" }, applicationError],
  ];

  for (const [via, options, sent, stream] of cells) {
    const call = showCall(via, options) + (stream ? ` with ${stream}` : "");
    test.concurrent(`${call} sends ${sent ? show(sent) : "no CONNECTION_CLOSE"}`, async () => {
      await using peer = await udpPeer();
      const session = await peer.dial();
      session.opened.catch(() => {});
      if (stream) (await session.createBidirectionalStream(pending[stream])).closed.catch(() => {});
      await act(session, via, options);

      expect(await peer.sent()).toEqual([{ hello: true, closes: sent ? [sent] : [] }]);
    });
  }

  // A client that has a packet from the server but no Handshake keys can
  // encrypt only an Initial packet.
  test.concurrent(
    "a close with a code uses an Initial packet after a server packet that has no ServerHello",
    async () => {
      let answered = false;
      await using peer = await udpPeer(datagram => {
        if (answered) return;
        answered = true;
        // A QUIC v1 Initial packet for the client's source connection id with
        // 64 bytes that nothing encrypted. The client cannot read it.
        let at = 5;
        at += 1 + datagram[at];
        const scid = datagram.subarray(at + 1, at + 1 + datagram[at]);
        return Buffer.concat([
          Buffer.from([0xc3, 0, 0, 0, 1, scid.length]),
          scid,
          Buffer.from([8, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0x40, 64]),
          Buffer.alloc(64, 0xaa),
        ]);
      });
      const session = await peer.dial();
      session.opened.catch(() => {});
      // lsquic starts to send PING frames when the first server packet of its
      // version arrives. Before that it only sends the ClientHello again.
      await peer.until(initials => initials.ping && initials.hello === "");
      await session.close({ code: 5n, reason: "bye" });

      expect(await peer.sent()).toEqual([{ hello: true, closes: [{ type: "transport", code: 5n, reason: "bye" }] }]);
    },
  );

  // connect() inside the callback of another session on the same endpoint
  // returns before the ClientHello is sent. Node sends it inside connect().
  describe("on a session that has not sent its ClientHello", () => {
    const neverSent = async (via: "close" | "destroy") => {
      await using peer = await udpPeer();
      const first = await peer.dial();
      first.opened.catch(() => {});
      // The endpoint settles `closed` while it dispatches the close.
      await first.close();
      const session = await peer.dial();
      session.opened.catch(() => {});
      await act(session, via, { code: 5n });
      return (await peer.sent()).slice(1);
    };

    test.concurrent("close({ code: 5n }) sends the ClientHello and then the close", async () => {
      expect(await neverSent("close")).toEqual([
        { hello: true, closes: [{ type: "transport", code: 5n, reason: "" }] },
      ]);
    });

    // A server has no connection to close before it has a ClientHello.
    test.concurrent("destroy(undefined, { code: 5n }) sends no close without a ClientHello", async () => {
      expect((await neverSent("destroy")).filter(connection => !connection.hello)).toEqual([]);
    });
  });
});

describe("session close options against a server", () => {
  const sniOpt = { "*": { keys: [key], certs: [cert] } };
  const clientOpt = { servername: "localhost", verifyPeer: "manual", onerror() {} };
  const outcome = (closed: Promise<unknown>) =>
    closed.then(
      () => "fulfilled",
      (e: any) => ({ code: e.code, errorCode: e.errorCode, reason: e.reason }),
    );

  test("a client close({ code }) before the handshake reaches the server", async () => {
    const serverSaw = Promise.withResolvers<unknown>();
    // A bun server answers an Initial from an address that it did not
    // validate, so it has a session for this client when the close arrives.
    await using server = await listen(
      (serverSession: any) => {
        serverSession.onerror = () => {};
        serverSession.opened.catch(() => {});
        serverSaw.resolve(outcome(serverSession.closed));
      },
      // Without a close frame the server ends the session when this timer
      // expires, and it does so without an error.
      { sni: sniOpt, handshakeTimeout: 3000 },
    );
    await using endpoint = new QuicEndpoint();
    const session = await connect(server.address, { endpoint, ...clientOpt });
    session.opened.catch(() => {});
    await session.close({ code: 5n });

    expect(await serverSaw.promise).toEqual({ code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 5n, reason: undefined });
  });

  const transportError = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 5n, reason: "bye" };
  const applicationError = { code: "ERR_QUIC_APPLICATION_ERROR", errorCode: 5n, reason: "bye" };
  const cells: [who: "client" | "server", via: "close" | "destroy", options: CloseOptions, peer: object | string][] = [
    ["client", "close", { reason: "bye" }, "fulfilled"],
    ["client", "close", { type: "application" }, "fulfilled"],
    ["client", "close", { code: 0n, reason: "bye" }, "fulfilled"],
    ["client", "close", { code: 5n, reason: "bye" }, transportError],
    ["client", "close", { code: 5n, type: "application", reason: "bye" }, applicationError],
    ["client", "destroy", { code: 0n }, "fulfilled"],
    ["client", "destroy", { code: 0n, reason: "bye" }, "fulfilled"],
    ["client", "destroy", { code: 5n, reason: "bye" }, transportError],
    ["server", "close", { reason: "bye" }, "fulfilled"],
    ["server", "close", { code: 0n, reason: "bye" }, "fulfilled"],
    ["server", "close", { code: 5n, type: "application", reason: "bye" }, applicationError],
    ["server", "destroy", { code: 0n }, "fulfilled"],
    ["server", "destroy", { code: 5n, reason: "bye" }, transportError],
  ];

  // Not concurrent: with several servers at once lsquic leaks a connection
  // that it keeps for a stateless reset (#41337), and LeakSanitizer aborts.
  for (const [who, via, options, peer] of cells) {
    const call = `${who} ${showCall(via, options)}`;
    test(`after the handshake, the peer of a ${call} settles ${show(peer)}`, async () => {
      const serverSaw = Promise.withResolvers<unknown>();
      const clientOpened = Promise.withResolvers<unknown>();
      await using server = await listen(
        async (serverSession: any) => {
          serverSession.onerror = () => {};
          serverSaw.resolve(outcome(serverSession.closed));
          if (who === "server") {
            await Promise.all([serverSession.opened, clientOpened.promise]);
            act(serverSession, via, options);
          }
        },
        { sni: sniOpt },
      );
      await using endpoint = new QuicEndpoint();
      const session = await connect(server.address, { endpoint, ...clientOpt });
      const clientSaw = outcome(session.closed);
      clientOpened.resolve(session.opened);
      await clientOpened.promise;
      if (who === "client") act(session, via, options);

      expect(await (who === "client" ? serverSaw.promise : clientSaw)).toEqual(peer);
    });
  }

  // lsquic_conn_close() first resets every stream and sends the close only
  // when they are gone. Node sends the close of a destroy() at once.
  test("a server destroy(undefined, { code: 0n }) does not reset a stream of the client", async () => {
    const serverStream = Promise.withResolvers<void>();
    let serverSession: any;
    await using server = await listen(
      (session: any) => {
        serverSession = session;
        session.onerror = () => {};
        session.closed.catch(() => {});
        session.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          serverStream.resolve();
        };
      },
      { alpn: "quic-test", sni: sniOpt },
    );
    await using endpoint = new QuicEndpoint();
    const session = await connect(server.address, { endpoint, alpn: "quic-test", ...clientOpt });
    const closed = outcome(session.closed);
    await session.opened;
    const stream = await session.createBidirectionalStream();
    let reset = false;
    stream.onreset = () => {
      reset = true;
    };
    stream.closed.catch(() => {});
    stream.writer.writeSync(new TextEncoder().encode("hello"));
    await serverStream.promise;
    serverSession.destroy(undefined, { code: 0n });

    expect({ closed: await closed, reset }).toEqual({ closed: "fulfilled", reset: false });
  });

  for (const options of [undefined, {}, { reason: "bye" }, { type: "application" }] as const) {
    test(`after the handshake, a server ${showCall("destroy", options)} sends no CONNECTION_CLOSE`, async () => {
      const destroyed = Promise.withResolvers<void>();
      const clientOpened = Promise.withResolvers<unknown>();
      await using server = await listen(
        async (serverSession: any) => {
          serverSession.onerror = () => {};
          serverSession.closed.catch(() => {});
          await Promise.all([serverSession.opened, clientOpened.promise]);
          serverSession.destroy(undefined, options);
          destroyed.resolve();
        },
        { sni: sniOpt },
      );
      await using endpoint = new QuicEndpoint();
      const session = await connect(server.address, { endpoint, ...clientOpt });
      const closed = outcome(session.closed);
      clientOpened.resolve(session.opened);
      await destroyed.promise;
      // The client was not told. The server answers its next packet with a
      // stateless reset.
      await session.createBidirectionalStream({ headers: GET, body: new TextEncoder().encode("hello") }).then(
        (stream: any) => stream.closed.catch(() => {}),
        () => {},
      );

      const told: any = await closed;
      expect({ code: told.code, reason: told.reason, reset: server.stats.statelessResetCount > 0n }).toEqual({
        code: "ERR_QUIC_TRANSPORT_ERROR",
        reason: undefined,
        reset: true,
      });
    });
  }

  // The session callback runs before the connection exists. bun keeps the
  // close until it does. Node drops a close that the callback makes.
  for (const options of [{ reason: "bye" }, { type: "application" }, { code: 0n, reason: "bye" }] as const) {
    test(`a server close(${show(options)}) in the session callback is a clean close for the client`, async () => {
      await using server = await listen(
        (serverSession: any) => {
          serverSession.onerror = () => {};
          serverSession.opened.catch(() => {});
          serverSession.close(options).catch(() => {});
        },
        { sni: sniOpt },
      );
      await using endpoint = new QuicEndpoint();
      const session = await connect(server.address, { endpoint, ...clientOpt });

      expect({ opened: await outcome(session.opened), closed: await outcome(session.closed) }).toEqual({
        opened: "fulfilled",
        closed: "fulfilled",
      });
    });
  }

  // A client that has sent its Finished but has no 1-RTT packet from the
  // server has nothing to acknowledge. destroy() queued an ACK anyway, lsquic
  // failed to build it, and that error went out as CONNECTION_CLOSE
  // INTERNAL_ERROR. Node sends nothing.
  test("destroy() without a close error sends nothing when there is nothing to acknowledge", async () => {
    const serverSaw = Promise.withResolvers<unknown>();
    const serverOpened = Promise.withResolvers<unknown>();
    await using server = await listen(
      (serverSession: any) => {
        serverSession.onerror = () => {};
        serverSaw.resolve(outcome(serverSession.closed));
        serverOpened.resolve(serverSession.opened);
      },
      { sni: sniOpt, transportParams: { maxIdleTimeout: 1 } },
    );
    const serverPort = server.address.port;

    // The end of the long header packets (RFC 9000 s17.2) that start `datagram`.
    const longHeadersEnd = (datagram: Buffer) => {
      let at = 0;
      while (at < datagram.length && datagram[at] & 0x80) {
        // Only an Initial packet has a token. Its type is 0 in QUIC v1 and 1
        // in QUIC v2 (RFC 9369 s3.2), which the server switches to.
        const initialType = datagram.readUInt32BE(at + 1) === 0x6b3343cf ? 1 : 0;
        let next = at + 5;
        next += 1 + datagram[next];
        next += 1 + datagram[next];
        let n: bigint;
        if (((datagram[at] >> 4) & 3) === initialType) {
          [n, next] = varint(datagram, next);
          next += Number(n);
        }
        [n, next] = varint(datagram, next);
        at = next + Number(n);
      }
      return Math.min(at, datagram.length);
    };

    // client <-> relay <-> server. The relay drops every 1-RTT packet that the
    // server sends.
    const relay = createSocket("udp4");
    let clientPort = 0;
    relay.on("message", (datagram, from) => {
      if (from.port !== serverPort) {
        clientPort = from.port;
        relay.send(datagram, serverPort, "127.0.0.1");
      } else if (longHeadersEnd(datagram) > 0) {
        relay.send(datagram.subarray(0, longHeadersEnd(datagram)), clientPort, "127.0.0.1");
      }
    });
    await new Promise<void>(resolve => relay.bind(0, "127.0.0.1", resolve));
    try {
      await using endpoint = new QuicEndpoint();
      const session = await connect({ address: "127.0.0.1", port: relay.address().port }, { endpoint, ...clientOpt });
      // `opened` waits for the server's HANDSHAKE_DONE, a 1-RTT frame.
      session.opened.catch(() => {});
      await serverOpened.promise;
      session.destroy();

      // The server hears nothing, so its idle timer ends the session without
      // an error.
      expect(await serverSaw.promise).toBe("fulfilled");
    } finally {
      relay.close();
    }
  });
});
