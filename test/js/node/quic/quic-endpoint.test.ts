// lsquic fixes HTTP/3-vs-raw framing per client *engine*, set by the first
// connect() through an endpoint; a later connect in the other mode must fail
// loudly instead of silently reusing an engine that cannot frame it.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, libcPathForDlopen, normalizeBunSnapshot, tempDir } from "harness";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readdirSync, readFileSync } from "node:fs";
import { BlockList } from "node:net";
import { constants, networkInterfaces } from "node:os";
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

// quic.ts validated udpReceiveBufferSize / udpSendBufferSize / udpTTL /
// ipv6Only / reusePort and passed them to the native endpoint, which never read
// them: the socket was created with flags 0 and nothing was set on it
// afterwards. Node applies all five in Endpoint::UDP::Bind. The buffer sizes and
// TTL are only observable through getsockopt(2) on the endpoint's own socket,
// found here by its bound port among the process's datagram sockets; those
// read-backs need /dev/fd and a libc to dlopen, so they are POSIX-only.
describe("endpoint UDP socket options", () => {
  const sniOpt = { "*": { keys: [key], certs: [cert] } };
  const tp = { maxIdleTimeout: 1 };
  const onSession = async (s: any) => {
    await s.closed.catch(() => {});
  };

  const SOL_SOCKET = isMacOS ? 0xffff : 1;
  const SO_TYPE = isMacOS ? 0x1008 : 3;
  const SO_SNDBUF = isMacOS ? 0x1001 : 7;
  const SO_RCVBUF = isMacOS ? 0x1002 : 8;
  const SOCK_DGRAM = 2;
  const IPPROTO_IP = 0;
  const IP_TTL = isMacOS ? 4 : 2;
  const IPPROTO_IPV6 = 41;
  const IPV6_V6ONLY = isMacOS ? 27 : 26;
  const AF_INET = 2;
  const AF_INET6 = isMacOS ? 30 : 10;

  let libc: ReturnType<typeof dlopen> | undefined;
  function symbols() {
    libc ??= dlopen(libcPathForDlopen(), {
      getsockopt: {
        args: [FFIType.int, FFIType.int, FFIType.int, FFIType.ptr, FFIType.ptr],
        returns: FFIType.int,
      },
      getsockname: { args: [FFIType.int, FFIType.ptr, FFIType.ptr], returns: FFIType.int },
    });
    return libc.symbols;
  }

  function getsockopt(fd: number, level: number, option: number) {
    const value = new Int32Array(1);
    const length = new Uint32Array([4]);
    return symbols().getsockopt(fd, level, option, ptr(value), ptr(length)) === 0 ? value[0] : null;
  }

  // Every inet datagram socket open in this process with its bound port. The
  // sockaddr starts with a native-endian u16 family on Linux and u8 len + u8
  // family on macOS; sin_port / sin6_port both follow at offset 2 in network
  // byte order.
  function udpSockets() {
    const out: Array<{ fd: number; port: number }> = [];
    for (const name of readdirSync("/dev/fd")) {
      const fd = Number(name);
      if (getsockopt(fd, SOL_SOCKET, SO_TYPE) !== SOCK_DGRAM) continue;
      const addr = new Uint8Array(128);
      const length = new Uint32Array([addr.length]);
      if (symbols().getsockname(fd, ptr(addr), ptr(length)) !== 0) continue;
      const family = isMacOS ? addr[1] : addr[0] | (addr[1] << 8);
      if (family !== AF_INET && family !== AF_INET6) continue;
      out.push({ fd, port: (addr[2] << 8) | addr[3] });
    }
    return out;
  }

  function udpSocketFd(port: number) {
    const socket = udpSockets().find(s => s.port === port);
    if (!socket) throw new Error(`no UDP socket bound to port ${port} in this process`);
    return socket.fd;
  }

  const readBack = (port: number) => {
    const fd = udpSocketFd(port);
    return {
      rcvbuf: getsockopt(fd, SOL_SOCKET, SO_RCVBUF),
      sndbuf: getsockopt(fd, SOL_SOCKET, SO_SNDBUF),
      ttl: getsockopt(fd, IPPROTO_IP, IP_TTL),
    };
  };

  // socket(7): Linux clamps the request to net.core.{r,w}mem_max and stores
  // (and reports) twice the clamped value; macOS reports the request as-is.
  const kernelView = (requested: number, max: "rmem_max" | "wmem_max") =>
    isLinux ? 2 * Math.min(requested, Number(readFileSync(`/proc/sys/net/core/${max}`, "utf8"))) : requested;

  // A bind that fails does not make listen() throw: it returns the endpoint
  // already destroyed, and `closed` carries the failure
  // (test-quic-endpoint-bind-failure.mjs). Successful binds are closed again.
  async function listenOutcome(endpoint: object) {
    const ep = await listen(onSession, { sni: sniOpt, transportParams: tp, endpoint });
    if (!ep.destroyed) {
      const { port } = ep.address;
      await ep.close();
      return { bound: true, port };
    }
    return ep.closed.then(
      () => "destroyed, but closed resolved",
      (e: any) => ({ bound: false, code: e.code, message: e.message }),
    );
  }
  const bindFailure = (errno: number) => ({
    bound: false,
    code: "ERR_QUIC_ENDPOINT_CLOSED",
    message: `QUIC endpoint closed: Bind failure (${errno})`,
  });

  test.skipIf(isWindows)("udpReceiveBufferSize, udpSendBufferSize and udpTTL are set on the socket", async () => {
    // Well below any default so the read-back cannot be the default by accident,
    // and distinct from each other so a swapped option would show.
    const options = { udpReceiveBufferSize: 65536, udpSendBufferSize: 98304, udpTTL: 7 };
    const expected = {
      rcvbuf: kernelView(options.udpReceiveBufferSize, "rmem_max"),
      sndbuf: kernelView(options.udpSendBufferSize, "wmem_max"),
      ttl: options.udpTTL,
    };

    // listen() and connect() are the two paths that bind an endpoint.
    await using server = await listen(onSession, {
      sni: sniOpt,
      transportParams: tp,
      endpoint: { address: "127.0.0.1:0", ...options },
    });
    const viaListen = readBack(server.address.port);

    await using endpoint = new QuicEndpoint({ address: "127.0.0.1:0", ...options });
    const client = await connect(server.address, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: tp,
    });
    const viaConnect = readBack(endpoint.address.port);
    client.close();

    expect({ viaListen, viaConnect }).toEqual({ viaListen: expected, viaConnect: expected });
  });

  // Binding `::` needs the IPv6 stack, not routable IPv6 (which is what the
  // harness's isIPv6() asks about): any interface carrying an IPv6 address
  // means the kernel will hand out AF_INET6 sockets.
  const hasIPv6Stack = Object.values(networkInterfaces()).some(addrs => addrs?.some(a => a.family === "IPv6"));
  test.skipIf(isWindows || !hasIPv6Stack)("ipv6Only turns off dual-stack on an IPv6 endpoint", async () => {
    const address = { address: "::", family: "ipv6" as const };
    await using dualStack = await listen(onSession, { sni: sniOpt, transportParams: tp, endpoint: { address } });
    await using v6Only = await listen(onSession, {
      sni: sniOpt,
      transportParams: tp,
      endpoint: { address, ipv6Only: true },
    });
    expect({
      dualStack: getsockopt(udpSocketFd(dualStack.address.port), IPPROTO_IPV6, IPV6_V6ONLY),
      v6Only: getsockopt(udpSocketFd(v6Only.address.port), IPPROTO_IPV6, IPV6_V6ONLY),
    }).toEqual({ dualStack: 0, v6Only: 1 });
  });

  test.skipIf(isWindows)("reusePort lets a second endpoint bind the same port", async () => {
    await using first = await listen(onSession, {
      sni: sniOpt,
      transportParams: tp,
      endpoint: { address: "127.0.0.1:0", reusePort: true },
    });
    const { port } = first.address;
    // Without SO_REUSEPORT on both sockets this is the EADDRINUSE bind failure
    // that test-quic-endpoint-bind-failure.mjs covers.
    expect(await listenOutcome({ address: `127.0.0.1:${port}`, reusePort: true })).toEqual({ bound: true, port });
  });

  // Winsock has no SO_REUSEPORT. Like libuv's UV_UDP_REUSEPORT (which node's
  // endpoint passes to uv_udp_bind), asking for it fails the bind instead of
  // quietly binding without it.
  test.skipIf(!isWindows)("reusePort fails the bind where SO_REUSEPORT does not exist", async () => {
    expect(await listenOutcome({ address: "127.0.0.1:0", reusePort: true })).toEqual(
      bindFailure(constants.errno.WSAEOPNOTSUPP),
    );
  });

  // The options set after the socket exists can fail too; node reports that as
  // a bind failure, and the socket that was already created has to go away
  // with the endpoint. Neither Linux nor current macOS rejects an oversized
  // buffer request (and the TTL is range-checked before the call), so the
  // setsockopt is failed by injection.
  test.skipIf(isWindows || !fault.available())("a rejected socket option is reported as a bind failure", async () => {
    const options = { address: "127.0.0.1:0", udpReceiveBufferSize: 65536 };
    const before = udpSockets().length;
    fault.set({ syscall: "setsockopt", action: "errno", errno: "ENOBUFS" });
    let outcome;
    try {
      outcome = await listenOutcome(options);
    } finally {
      fault.clear();
    }
    // The rule was one-shot, so the same options bind once it has fired.
    const afterwards = await listenOutcome(options);
    expect({ outcome, leakedSockets: udpSockets().length - before, afterwards }).toEqual({
      outcome: bindFailure(constants.errno.ENOBUFS),
      leakedSockets: 0,
      afterwards: { bound: true, port: expect.any(Number) },
    });
  });
});
