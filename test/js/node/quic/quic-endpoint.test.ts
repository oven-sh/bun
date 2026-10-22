// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { createCipheriv, createHmac, createPrivateKey, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
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

// lsquic selects the error it closes a connection with (type, code and
// reason) for its CONNECTION_CLOSE frame. The session read only lsquic's
// status enum, so the side that found the error reported transport error 1
// for every one of them, or a clean close when the handshake had also failed.
describe("session close report for an error the local side finds", () => {
  const sniOpt = { "*": { keys: [key], certs: [cert] } };
  // Past every test timeout: an idle timeout also settles `closed`.
  const tp = { maxIdleTimeout: 600 };
  const request = { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" };

  const quicError = (e: any) => ({ code: e.code, type: e.type, errorCode: e.errorCode });
  const settled = (p: Promise<unknown>) => p.then(() => "resolved", quicError);
  const transport = (errorCode: bigint) => ({ code: "ERR_QUIC_TRANSPORT_ERROR", type: "transport", errorCode });
  const application = (errorCode: bigint) => ({ code: "ERR_QUIC_APPLICATION_ERROR", type: "application", errorCode });

  // HKDF-Expand-Label (RFC 8446 section 7.1) for one SHA-256 block.
  function expandLabel(secret: Buffer, label: string, length: number) {
    const full = Buffer.from("tls13 " + label);
    const info = Buffer.concat([Buffer.from([0, length, full.length]), full, Buffer.from([0, 1])]);
    return createHmac("sha256", secret).update(info).digest().subarray(0, length);
  }

  /** The connection IDs of a long-header packet (RFC 8999 section 5.1). */
  function connectionIds(packet: Buffer) {
    const dcid = packet.subarray(6, 6 + packet[5]);
    const scid = packet.subarray(7 + dcid.length, 7 + dcid.length + packet[6 + dcid.length]);
    return { dcid, scid };
  }

  /**
   * A server's Initial packet that carries `frames`, in answer to the client's
   * `first` packet. Initial packets are protected with keys derived from the
   * client's first Destination Connection ID (RFC 9001 section 5.2), so this
   * needs no TLS.
   */
  function serverInitial(first: Buffer, frames: number[]) {
    const { dcid, scid } = connectionIds(first);
    const salt = Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex");
    const secret = expandLabel(createHmac("sha256", salt).update(dcid).digest(), "server in", 32);
    // Long header, type Initial, version 1, no token, 4-byte packet number 0.
    const header = Buffer.concat([
      Buffer.from([0xc3, 0, 0, 0, 1, scid.length]),
      scid,
      Buffer.from([8, 1, 2, 3, 4, 5, 6, 7, 8, 0, 4 + frames.length + 16, 0, 0, 0, 0]),
    ]);
    const aead = createCipheriv("aes-128-gcm", expandLabel(secret, "quic key", 16), expandLabel(secret, "quic iv", 12));
    aead.setAAD(header);
    const sealed = Buffer.concat([aead.update(Buffer.from(frames)), aead.final(), aead.getAuthTag()]);
    const mask = createCipheriv("aes-128-ecb", expandLabel(secret, "quic hp", 16), null).update(sealed.subarray(0, 16));
    header[0] ^= mask[0] & 0x0f;
    for (let i = 0; i < 4; i++) header[header.length - 4 + i] ^= mask[1 + i];
    return Buffer.concat([header, sealed]);
  }

  /** How a client session ends when the peer answers its first packet with `reply(first)`. */
  async function closeAfter(reply: (first: Buffer) => Buffer) {
    const peer = createSocket("udp4");
    peer.bind(0, "127.0.0.1");
    await once(peer, "listening");
    try {
      peer.once("message", (first, from) => peer.send(reply(first), from.port, from.address));
      const errors: unknown[] = [];
      const session = await connect(new SocketAddress({ address: "127.0.0.1", port: peer.address().port }), {
        alpn: "quic-test",
        servername: "localhost",
        verifyPeer: "manual",
        transportParams: tp,
        onerror: (e: unknown) => void errors.push(quicError(e)),
      } as SessionOptions);
      const [opened, closed] = await Promise.all([settled(session.opened), settled(session.closed)]);
      return { opened, closed, errors };
    } finally {
      peer.close();
    }
  }

  // These run before the client has Handshake keys. lsquic sends no
  // CONNECTION_CLOSE then, so only the client's own report shows the error.
  test.each([
    ["a packet with no frames is PROTOCOL_VIOLATION", [], 0xan],
    // CRYPTO, offset 0, length 255, and no data.
    ["a frame that does not parse is FRAME_ENCODING_ERROR", [0x06, 0x00, 0x40, 0xff], 0x7n],
    // CRYPTO with a Finished message where the ServerHello belongs: TLS alert
    // unexpected_message (10).
    ["a TLS alert that fails the handshake is CRYPTO_ERROR", [0x06, 0x00, 0x04, 0x14, 0x00, 0x00, 0x00], 0x100n + 10n],
    // ACK of packet 9, which the client did not send. lsquic aborts with no
    // error code and sends INTERNAL_ERROR.
    ["an abort with no error code is INTERNAL_ERROR", [0x02, 0x09, 0x00, 0x00, 0x00], 0x1n],
  ] as const)("%s", async (_, frames, errorCode) => {
    const error = transport(errorCode);
    expect(await closeAfter(first => serverInitial(first, [...frames]))).toEqual({
      opened: error,
      closed: error,
      errors: [error],
    });
  });

  // lsquic sets the same flags for this as for an error that fails the
  // handshake. Node rejects `closed` with ERR_QUIC_VERSION_NEGOTIATION_ERROR
  // here, after `onversionnegotiation`.
  test("a failed version negotiation is not reported as a transport error", async () => {
    // Version Negotiation (RFC 9000 section 17.2.1) that offers only a version
    // the client does not have.
    const { closed } = await closeAfter(first => {
      const { dcid, scid } = connectionIds(first);
      return Buffer.concat([
        Buffer.from([0x80, 0, 0, 0, 0, scid.length]),
        scid,
        Buffer.from([dcid.length]),
        dcid,
        Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]),
      ]);
    });
    expect(closed).not.toEqual(expect.objectContaining({ code: "ERR_QUIC_TRANSPORT_ERROR" }));
  });
  test.todo("a failed version negotiation rejects closed with ERR_QUIC_VERSION_NEGOTIATION_ERROR, as node does");
  test.todo("a stateless reset is reported as PROTOCOL_VIOLATION (10n), as node does, and not as 1n");
  test.todo("a handshake timeout is reported as INTERNAL_ERROR (1n), as node does, and not as 0x128n");

  /** How a client with `verifyPeer` and its peer end, when the server's certificate has no trusted issuer. */
  async function untrustedCertificate(verifyPeer: "strict" | "auto") {
    const peerClosed = Promise.withResolvers<unknown>();
    await using server = await listen(
      (s: any) => {
        s.onerror = () => {};
        s.opened.catch(() => {});
        peerClosed.resolve(settled(s.closed));
      },
      { sni: sniOpt, alpn: ["quic-test"], transportParams: tp },
    );
    const errors: unknown[] = [];
    const session = await connect(server.address!, {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer,
      transportParams: tp,
      onerror: (e: unknown) => void errors.push(quicError(e)),
    } as SessionOptions);
    const [opened, closed] = await Promise.all([settled(session.opened), settled(session.closed)]);
    return { opened, closed, errors, peer: await peerClosed.promise };
  }

  test("verifyPeer 'strict' against an untrusted certificate", async () => {
    // TLS alert unknown_ca (48).
    const error = transport(0x100n + 48n);
    expect(await untrustedCertificate("strict")).toEqual({
      opened: error,
      closed: error,
      errors: [error],
      peer: error,
    });
  });

  // 'auto' finishes the handshake and JS refuses the certificate: `opened`
  // rejects and `closed` resolves, as on node.
  test("verifyPeer 'auto' against an untrusted certificate", async () => {
    expect(await untrustedCertificate("auto")).toEqual({
      opened: transport(0n),
      closed: "resolved",
      errors: [],
      // TLS alert bad_certificate (42).
      peer: transport(0x100n + 42n),
    });
  });

  /**
   * An HTTP/3 connection. `violate` makes one side break RFC 9114, and the
   * other side's lsquic closes the connection with an application error.
   */
  async function http3(violate: (sides: { client: any; server: any }) => unknown, serverParams: object = {}) {
    const accepted = Promise.withResolvers<any>();
    await using endpoint = await listen(
      (s: any) => {
        s.onerror = () => {};
        s.closed.catch(() => {});
        accepted.resolve(s);
      },
      { sni: sniOpt, transportParams: { ...tp, ...serverParams } },
    );
    const client = await connect(endpoint.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
      onerror() {},
    } as SessionOptions);
    client.closed.catch(() => {});
    const server = await accepted.promise;
    await Promise.all([client.opened, server.opened]);
    await violate({ client, server });
    const [clientClosed, serverClosed] = await Promise.all([settled(client.closed), settled(server.closed)]);
    return { client: clientClosed, server: serverClosed };
  }
  const H3_GENERAL_PROTOCOL_ERROR = 0x101n;
  const H3_STREAM_CREATION_ERROR = 0x103n;
  // Stream type 0x00 (control), then an empty SETTINGS frame: a second control stream.
  const secondControlStream = new Uint8Array([0x00, 0x04, 0x00]);
  // lsquic's default gives the client its three HTTP/3 streams and no more.
  const roomForOneMoreStream = { initialMaxStreamsUni: 100 };

  /** The server opens a bidirectional stream, which an HTTP/3 client must refuse. */
  async function serverOpensStream(server: any) {
    const stream = await server.createBidirectionalStream({ headers: request });
    stream.closed.catch(() => {});
  }

  // Node sends and reports transport INTERNAL_ERROR for these two. lsquic sends
  // the RFC 9114 code, and the side that found the error reports what it sent.
  test("HTTP/3: the client finds a server-initiated bidirectional stream", async () => {
    expect(await http3(({ server }) => serverOpensStream(server))).toEqual({
      client: application(H3_STREAM_CREATION_ERROR),
      server: application(H3_STREAM_CREATION_ERROR),
    });
  });

  test("HTTP/3: the server finds a second control stream", async () => {
    const result = await http3(async ({ client }) => {
      const stream = await client.createUnidirectionalStream({ body: secondControlStream });
      stream.closed.catch(() => {});
    }, roomForOneMoreStream);
    expect(result).toEqual({
      client: application(H3_STREAM_CREATION_ERROR),
      server: application(H3_STREAM_CREATION_ERROR),
    });
  });

  test("HTTP/3: the client cannot open its control and QPACK streams", async () => {
    const peerClosed = Promise.withResolvers<unknown>();
    await using server = await listen(
      (s: any) => {
        s.onerror = () => {};
        s.opened.catch(() => {});
        peerClosed.resolve(settled(s.closed));
      },
      { sni: sniOpt, transportParams: { ...tp, initialMaxStreamsUni: 2 } },
    );
    const errors: unknown[] = [];
    const session = await connect(server.address!, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
      onerror: (e: unknown) => void errors.push(quicError(e)),
    } as SessionOptions);
    const [opened, closed] = await Promise.all([settled(session.opened), settled(session.closed)]);
    const error = application(H3_GENERAL_PROTOCOL_ERROR);
    expect({ opened, closed, errors, peer: await peerClosed.promise }).toEqual({
      opened: error,
      closed: error,
      errors: [error],
      // The client has no 1-RTT keys yet. In a Handshake packet an application
      // error goes out as transport APPLICATION_ERROR (RFC 9000 section 10.2.3).
      peer: transport(0xcn),
    });
  });

  // close() with no code asks lsquic for no error of this side's own, so it
  // must not replace the error that ends the connection. Node reports that
  // error for each of these shapes.
  const closeShapes = [
    ["close()", undefined],
    ["close({ reason })", { reason: "bye" }],
    ["close({ type: 'application' })", { type: "application" }],
  ] as const;
  // A close with type "application" goes out at once. The other two wait for
  // the open request, so an error can still end the connection first.
  const waitingCloseShapes = closeShapes.slice(0, 2);

  test.each(waitingCloseShapes)("HTTP/3: a client's %s does not hide a later error", async (_, options) => {
    const result = await http3(async ({ client, server }) => {
      server.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        serverOpensStream(server);
      };
      // The server never answers, so the graceful close waits for this stream.
      const stream = await client.createBidirectionalStream({ headers: request });
      stream.closed.catch(() => {});
      client.close(options).catch(() => {});
    });
    expect(result.client).toEqual(application(H3_STREAM_CREATION_ERROR));
  });

  test.each(waitingCloseShapes)("HTTP/3: a server's %s does not hide a later error", async (_, options) => {
    const result = await http3(async ({ client, server }) => {
      const goaway = Promise.withResolvers<void>();
      client.ongoaway = () => goaway.resolve();
      // The server never answers, so its graceful close waits for this stream.
      server.onstream = (stream: any) => {
        stream.closed.catch(() => {});
        server.close(options).catch(() => {});
      };
      // Opened before the GOAWAY: a closing session opens no new stream.
      const control = await client.createUnidirectionalStream();
      control.closed.catch(() => {});
      const stream = await client.createBidirectionalStream({ headers: request });
      stream.closed.catch(() => {});
      await goaway.promise;
      control.writer.writeSync(secondControlStream);
      control.writer.endSync();
    }, roomForOneMoreStream);
    expect(result.server).toEqual(application(H3_STREAM_CREATION_ERROR));
  });

  // lsquic closes a stream when it destroys the connection. That reaches JS
  // one turn before the session's own close event, and `destroyedAtClose`
  // shows that close() ran in between.
  test.each(closeShapes)(
    "HTTP/3: a client's %s after lsquic closed the connection reports the error",
    async (_, options) => {
      let destroyedAtClose: boolean | undefined;
      const result = await http3(async ({ client, server }) => {
        server.onstream = (stream: any) => {
          stream.closed.catch(() => {});
          serverOpensStream(server);
        };
        const stream = await client.createBidirectionalStream({ headers: request });
        const close = () => {
          destroyedAtClose = client.destroyed;
          client.close(options).catch(() => {});
        };
        stream.closed.then(close, close);
      });
      expect({ destroyedAtClose, client: result.client }).toEqual({
        destroyedAtClose: false,
        client: application(H3_STREAM_CREATION_ERROR),
      });
    },
  );

  test.each(closeShapes)(
    "HTTP/3: a server's %s after lsquic closed the connection reports the error",
    async (_, options) => {
      let destroyedAtClose: boolean | undefined;
      const result = await http3(async ({ client, server }) => {
        const accepted = Promise.withResolvers<void>();
        server.onstream = (stream: any) => {
          const close = () => {
            destroyedAtClose = server.destroyed;
            server.close(options).catch(() => {});
          };
          stream.closed.then(close, close);
          accepted.resolve();
        };
        const stream = await client.createBidirectionalStream({ headers: request });
        stream.closed.catch(() => {});
        await accepted.promise;
        const control = await client.createUnidirectionalStream({ body: secondControlStream });
        control.closed.catch(() => {});
      }, roomForOneMoreStream);
      expect({ destroyedAtClose, server: result.server }).toEqual({
        destroyedAtClose: false,
        server: application(H3_STREAM_CREATION_ERROR),
      });
    },
  );

  test.each(closeShapes)("HTTP/3: %s with no error resolves on both sides", async (_, options) => {
    const result = await http3(({ client }) => void client.close(options).catch(() => {}));
    expect(result).toEqual({ client: "resolved", server: "resolved" });
  });

  // A rejected 0-RTT resume must not end the connection (RFC 9001 section
  // 4.6.2), and node keeps it open. lsquic keeps its count of 0-RTT bytes
  // sent, finds it above the server's new initialMaxData, and aborts with no
  // error code, which fails the handshake. This test only uses that abort to
  // reach the report for it.
  test("an abort with no error code that fails the handshake is INTERNAL_ERROR", async () => {
    const endpoint = { tokenSecret: randomBytes(16) };
    const streamWindow = { initialMaxStreamDataBidiLocal: 1 << 20, initialMaxStreamDataBidiRemote: 1 << 20 };
    const ticket = Promise.withResolvers<unknown>();
    const token = Promise.withResolvers<unknown>();
    {
      await using first = await listen((s: any) => void s.closed.catch(() => {}), {
        sni: sniOpt,
        alpn: ["quic-test"],
        endpoint,
        transportParams: { ...tp, ...streamWindow, initialMaxData: 1 << 20 },
      });
      const session = await connect(first.address!, {
        alpn: "quic-test",
        verifyPeer: "manual",
        transportParams: tp,
        onsessionticket: ticket.resolve,
        onnewtoken: token.resolve,
      } as SessionOptions);
      await Promise.all([session.opened, ticket.promise, token.promise]);
      await session.close();
    }
    const peerClosed = Promise.withResolvers<unknown>();
    await using second = await listen(
      (s: any) => {
        s.onerror = () => {};
        s.opened.catch(() => {});
        s.onstream = (stream: any) => void stream.closed.catch(() => {});
        peerClosed.resolve(settled(s.closed));
      },
      { sni: sniOpt, alpn: ["quic-test"], endpoint, transportParams: { ...tp, ...streamWindow, initialMaxData: 2000 } },
    );
    const errors: unknown[] = [];
    const session = await connect(second.address!, {
      alpn: "quic-test",
      verifyPeer: "manual",
      transportParams: tp,
      sessionTicket: await ticket.promise,
      token: await token.promise,
      onerror: (e: unknown) => void errors.push(quicError(e)),
    } as SessionOptions);
    const stream = await session.createBidirectionalStream({ body: new Uint8Array(60000) });
    stream.closed.catch(() => {});
    const [opened, closed] = await Promise.all([settled(session.opened), settled(session.closed)]);
    const error = transport(1n);
    expect({ opened, closed, errors, peer: await peerClosed.promise }).toEqual({
      opened: error,
      closed: error,
      errors: [error],
      peer: error,
    });
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

// lsquic read "error code != 0" as "an error is recorded", so a close with
// code 0 that went through lsquic_conn_abort_error (an application close, or
// a transport close with a reason) went out as transport INTERNAL_ERROR (0x1).
describe("session close with error code 0", () => {
  // An idle timeout also resolves the peer's `closed`. Keep it past the test
  // timeout so only a CONNECTION_CLOSE frame can make a test pass.
  const tp = { maxIdleTimeout: 600 };
  const sniOpt = { "*": { keys: [key], certs: [cert] } };

  /** How the peer of a session closed with `close` sees that close. */
  async function peerView(close: (session: any) => void) {
    let accept!: (s: any) => void;
    const accepted = new Promise<any>(r => (accept = r));
    await using server = await listen(
      (s: any) => {
        s.closed.catch(() => {});
        accept(s);
      },
      { sni: sniOpt, alpn: ["quic-test"], transportParams: tp },
    );
    await using endpoint = new QuicEndpoint();
    const session = await connect(server.address!, {
      endpoint,
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    } as SessionOptions);
    session.closed.catch(() => {});
    await session.opened;
    const peer = await accepted;
    await peer.opened;
    close(session);
    return peer.closed.then(
      () => "resolved",
      (e: any) => ({ code: e.code, type: e.type, errorCode: e.errorCode, reason: e.reason }),
    );
  }

  test("destroy(undefined, { code: 0n, type: 'application' }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.destroy(undefined, { code: 0n, type: "application" }))).toBe("resolved");
  });

  test("close({ code: 0n, type: 'application' }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.close({ code: 0n, type: "application" }).catch(() => {}))).toBe("resolved");
  });

  test("close({ code: 0n, type: 'application', reason }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.close({ code: 0n, type: "application", reason: "bye" }).catch(() => {}))).toBe(
      "resolved",
    );
  });

  test("a nonzero application code still reaches the peer as an application error", async () => {
    expect(await peerView(s => s.destroy(undefined, { code: 2n, type: "application" }))).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      type: "application",
      errorCode: 2n,
      reason: undefined,
    });
  });

  test("destroy(undefined, { code: 0n, type: 'transport' }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.destroy(undefined, { code: 0n, type: "transport" }))).toBe("resolved");
  });

  test("close({ code: 0n, type: 'transport' }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.close({ code: 0n, type: "transport" }).catch(() => {}))).toBe("resolved");
  });

  // With a reason the close goes through the same lsquic path as an
  // application close, so it hit the same INTERNAL_ERROR fallback.
  test("destroy(undefined, { code: 0n, type: 'transport', reason }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.destroy(undefined, { code: 0n, type: "transport", reason: "bye" }))).toBe("resolved");
  });

  test("close({ code: 0n, type: 'transport', reason }) resolves the peer's closed", async () => {
    expect(await peerView(s => s.close({ code: 0n, type: "transport", reason: "bye" }).catch(() => {}))).toBe(
      "resolved",
    );
  });
});
