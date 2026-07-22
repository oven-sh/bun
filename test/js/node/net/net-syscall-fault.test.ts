import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { once } from "node:events";
import net from "node:net";

// Windows uses the libuv eventing backend; bsd_recv/bsd_send are still the
// chokepoints there but errno semantics differ. Land POSIX coverage first.
const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

async function connectedPair(onServerSocket?: (s: net.Socket) => void) {
  const server = net.createServer();
  server.on("connection", s => onServerSocket?.(s));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  // Register the server-side listener before initiating connect so the
  // 'connection' event cannot be missed.
  const serverSockP = once(server, "connection") as Promise<[net.Socket]>;
  const client = net.connect({ port, host: "127.0.0.1" });
  const [, [serverSock]] = await Promise.all([once(client, "connect"), serverSockP]);

  return {
    server,
    client,
    serverSock,
    [Symbol.dispose]() {
      client.destroy();
      serverSock.destroy();
      server.close();
    },
  };
}

describe.skipIf(skip)("node:net under injected syscall faults", () => {
  test("recv → ECONNRESET surfaces as 'error' and destroys the socket", async () => {
    using p = await connectedPair();
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: 1 });
    // Trigger a recv() on the client by writing from the server.
    const errP = once(p.client, "error");
    p.serverSock.write("hello");
    const [err] = (await errP) as [NodeJS.ErrnoException];
    expect(err.code).toBe("ECONNRESET");
    expect(p.client.destroyed).toBe(true);
  });

  test("recv → ETIMEDOUT surfaces as 'error' with code ETIMEDOUT", async () => {
    using p = await connectedPair();
    p.serverSock.on("error", () => {});
    fault.set({ syscall: "recv", action: "errno", errno: "ETIMEDOUT", repeat: 1 });
    const errP = once(p.client, "error");
    p.serverSock.write("hello");
    const [err] = (await errP) as [NodeJS.ErrnoException];
    expect(err.code).toBe("ETIMEDOUT");
    expect(p.client.destroyed).toBe(true);
  });

  test("recv → 0 (peer closed) emits 'end' without 'error'", async () => {
    using p = await connectedPair();
    fault.set({ syscall: "recv", action: "zero", repeat: 1 });
    let gotError: unknown = null;
    p.client.on("error", e => (gotError = e));
    const endP = once(p.client, "end");
    p.serverSock.write("hello");
    await endP;
    expect(gotError).toBeNull();
  });

  test("recv → short reads still deliver complete payload", async () => {
    using p = await connectedPair();
    // Clamp every recv to 1 byte: the loop should keep draining until EAGAIN
    // and the application must still observe the full payload.
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    const chunks: Buffer[] = [];
    p.client.on("data", c => chunks.push(c));
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i & 0xff));
    p.serverSock.write(payload);
    p.serverSock.end();
    await once(p.client, "end");
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  test("send → EAGAIN forever: data is buffered, then flushed after disarm", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1 });
    p.client.write(Buffer.alloc(256, "x"));
    fault.clear();
    p.client.end();
    await once(p.serverSock, "end");
    expect(received.length).toBe(256);
  });

  // EAGAIN forever parks the write callback on a drain that can never arrive,
  // so the socket's teardown is the only path left to it. Node cancels the
  // write request on handle close; Bun dropped the callback entirely.
  test("a peer reset fails a client's parked write callback", async () => {
    using p = await connectedPair(s => s.on("error", () => {}));
    const clientFd = (p.client as any)._handle.fd;
    expect(clientFd).toBeGreaterThanOrEqual(0);
    const errors: NodeJS.ErrnoException[] = [];
    p.client.on("error", e => errors.push(e));

    fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1, fd: clientFd });
    const written = Promise.withResolvers<NodeJS.ErrnoException | null | undefined>();
    p.client.write(Buffer.alloc(256, "x"), err => written.resolve(err));
    p.serverSock.resetAndDestroy();

    const writeErr = await written.promise;
    // The cancelled write and the error that caused it are separate signals,
    // exactly as Node reports them.
    expect({ code: writeErr?.code, syscall: writeErr?.syscall }).toEqual({ code: "ECANCELED", syscall: "write" });
    expect(errors.map(e => e.code)).toEqual(["ECONNRESET"]);
    expect(p.client.writableFinished).toBe(false);
  });

  // Same gap on the accepted side, which reaches it through SocketEmitEndNT:
  // a server still writing a response when the client resets.
  test("a peer reset fails a server socket's parked write callback", async () => {
    using p = await connectedPair(s => s.on("error", () => {}));
    const serverFd = (p.serverSock as any)._handle.fd;
    expect(serverFd).toBeGreaterThanOrEqual(0);
    // resetAndDestroy() emits on the resetting socket when terminate() fails; an
    // unhandled 'error' would crash the run instead of failing an assertion.
    p.client.on("error", () => {});

    fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1, fd: serverFd });
    const written = Promise.withResolvers<NodeJS.ErrnoException | null | undefined>();
    p.serverSock.write(Buffer.alloc(256, "x"), err => written.resolve(err));
    p.client.resetAndDestroy();

    const writeErr = await written.promise;
    expect({ code: writeErr?.code, syscall: writeErr?.syscall }).toEqual({ code: "ECANCELED", syscall: "write" });
    expect(p.serverSock.writableFinished).toBe(false);
  });

  // One write parks and the rest queue in the Writable; failing the parked one
  // is what cascades through that queue. Without it every queued callback is
  // left pending forever.
  test("a peer reset settles every queued write callback, not just the parked one", async () => {
    using p = await connectedPair(s => s.on("error", () => {}));
    const serverFd = (p.serverSock as any)._handle.fd;
    p.client.on("error", () => {});

    fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1, fd: serverFd });
    const N = 32;
    const settled: string[] = new Array(N).fill("PENDING");
    const closed = Promise.withResolvers<void>();
    p.serverSock.on("close", () => closed.resolve());
    for (let i = 0; i < N; i++) {
      p.serverSock.write(
        Buffer.alloc(256, "x"),
        err => (settled[i] = err ? (err as NodeJS.ErrnoException).code! : "OK"),
      );
    }
    p.client.resetAndDestroy();
    await closed.promise;

    // Node: the in-flight write gets ECANCELED; the queued ones get the
    // stream's stored error (ECONNRESET) via errorBuffer.
    expect(settled.filter(x => x === "PENDING")).toEqual([]);
    expect(settled[0]).toBe("ECANCELED");
    expect(new Set(settled.slice(1))).toEqual(new Set(["ECONNRESET"]));
  });

  test("send → short writes still deliver complete payload to peer", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    const payload = Buffer.alloc(512, "b");
    p.client.write(payload);
    p.client.end();
    await once(p.serverSock, "end");
    fault.clear();
    expect(received.length).toBe(payload.length);
    expect(received.equals(payload)).toBe(true);
  });

  // A short send leaves the remainder in the native buffered_data_for_node_net;
  // the next writable event drives internal_flush(), and if that retry's send()
  // fails with a transient errno (ENOBUFS/ENOMEM on a healthy connection) the
  // bytes must stay buffered and be retried, not dropped. Dropping them fired
  // 'drain' on a socket that had silently lost a span of the application's
  // byte stream. SocketBody is shared by connecting and accepted sockets, so
  // both the client writer and the net.createServer response writer are
  // exercised.
  for (const side of ["client", "server"] as const) {
    test.each(["ENOBUFS", "ENOMEM"] as const)(
      `send → %s on the drain-path flush of buffered data does not drop bytes (${side} writer)`,
      async errno => {
        using p = await connectedPair();
        const writer = side === "client" ? p.client : p.serverSock;
        const reader = side === "client" ? p.serverSock : p.client;
        let received = Buffer.alloc(0);
        reader.on("data", c => (received = Buffer.concat([received, c])));

        const writerFd = (writer as any)._handle.fd as number;
        expect(writerFd).toBeGreaterThanOrEqual(0);

        const head = Buffer.from(Array.from({ length: 200 }, (_, i) => i & 0xff));
        const body = Buffer.alloc(4096, 0xee);

        // send #0: clamp to 1 byte so the other 199 bytes of `head` land in
        // buffered_data_for_node_net and the writable poll is armed.
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: 1, fd: writerFd });
        const headWritten = new Promise<void>((resolve, reject) =>
          writer.write(head, err => (err ? reject(err) : resolve())),
        );

        // send #1: the drain-path flush of the buffered remainder. Inject a
        // one-shot transient errno; once it fires the rule self-disarms and the
        // next retry must deliver the bytes.
        fault.set({ syscall: "send", action: "errno", errno, repeat: 1, fd: writerFd });

        // A follow-up write on the same connection after the first write's
        // callback fires lets the peer observe a mid-stream gap (head[0]
        // followed by body) if the buffered remainder was dropped.
        await headWritten;
        writer.write(body);
        writer.end();
        await once(reader, "end");
        fault.clear();

        const expected = Buffer.concat([head, body]);
        expect({ length: received.length, intact: received.equals(expected) }).toEqual({
          length: expected.length,
          intact: true,
        });
      },
    );
  }

  // us_socket_write_check_error gives send() errnos that are neither
  // would-block/transient nor known peer-gone (EPROTOTYPE: macOS returns it
  // racily from send() on healthy sockets) a bounded retry through the
  // writable rearm machinery instead of failing the first write.
  test("send → EPROTOTYPE burst: bytes are retried and delivered intact", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    const fd = (p.client as any)._handle.fd as number;
    expect(fd).toBeGreaterThanOrEqual(0);
    fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", repeat: 8, fd });
    const payload = Buffer.alloc(256, "p");
    p.client.write(payload);
    p.client.end();
    await once(p.serverSock, "end");
    fault.clear();
    expect(received.equals(payload)).toBe(true);
  });

  // A sustained unclassified errno exhausts the bounded retry and must fail
  // like a dead transport: 'error' carrying the real errno on the write
  // syscall, then close. Before the fix the buffered bytes were silently
  // dropped, the write was acknowledged as flushed and the peer saw a clean
  // FIN terminating a truncated stream.
  test("send → sustained EPROTOTYPE surfaces as 'error' + close, not silent truncation", async () => {
    using p = await connectedPair();
    const fd = (p.client as any)._handle.fd as number;
    expect(fd).toBeGreaterThanOrEqual(0);
    fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", repeat: -1, fd });
    const errP = once(p.client, "error") as Promise<[NodeJS.ErrnoException]>;
    // Not events.once(): that helper rejects its promise when 'error' fires
    // first, and 'error' arriving before 'close' is exactly this contract.
    const closeP = new Promise<void>(resolve => p.client.once("close", () => resolve()));
    p.client.write(Buffer.alloc(64, "x"));
    const [err] = await errP;
    fault.clear();
    expect({ code: err.code, syscall: err.syscall }).toEqual({ code: "EPROTOTYPE", syscall: "write" });
    await closeP;
    expect(p.client.destroyed).toBe(true);
  });

  // Server-side twin of the above. On kqueue the fatal flush from on_writable
  // runs before the read dispatch (EV_EOF sets eof, not error), and its close
  // short-circuits the read-error path, so ServerHandlers.error is the only
  // place the errno is visible. With the plain-TCP delegation swallowing it,
  // the server socket's 'error' never fired and 'close' was stuck behind an
  // un-failed pending write (test-net-stream.js timeout on darwin).
  test("server: send → sustained fatal flush surfaces 'error' + 'close' on the accepted socket", async () => {
    using p = await connectedPair();
    const fd = (p.serverSock as any)._handle.fd as number;
    expect(fd).toBeGreaterThanOrEqual(0);
    fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", repeat: -1, fd });
    const errP = once(p.serverSock, "error") as Promise<[NodeJS.ErrnoException]>;
    const closeP = new Promise<void>(resolve => p.serverSock.once("close", () => resolve()));
    p.serverSock.write(Buffer.alloc(64, "s"));
    const [err] = await errP;
    fault.clear();
    expect({ code: err.code, syscall: err.syscall }).toEqual({ code: "EPROTOTYPE", syscall: "write" });
    await closeP;
    expect(p.serverSock.destroyed).toBe(true);
  });

  test("connect → ECONNREFUSED is reported on connecting socket", async () => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    try {
      fault.set({ syscall: "connect", action: "errno", errno: "ECONNREFUSED", repeat: 1 });
      const client = net.connect({ port, host: "127.0.0.1" });
      const [err] = (await once(client, "error")) as [NodeJS.ErrnoException];
      expect(err.code).toBe("ECONNREFUSED");
      expect(client.destroyed).toBe(true);
    } finally {
      server.close();
    }
  });

  test("fd targeting: rule on the server fd does not affect the client", async () => {
    using p = await connectedPair();
    // The server socket's recv should error; the client should still receive
    // data normally because the rule only matches the server fd.
    const serverFd = (p.serverSock as any)._handle.fd;
    expect(serverFd).toBeGreaterThanOrEqual(0);
    const serverErrP = once(p.serverSock, "error") as Promise<[NodeJS.ErrnoException]>;
    fault.set({
      syscall: "recv",
      action: "errno",
      errno: "ECONNRESET",
      repeat: -1,
      fd: serverFd,
    });
    const dataP = once(p.client, "data");
    p.serverSock.write("from-server");
    p.client.write("from-client");
    const [chunk] = (await dataP) as [Buffer];
    expect(chunk.toString()).toBe("from-server");
    const [serverErr] = await serverErrP;
    expect(serverErr.code).toBe("ECONNRESET");
  });

  test("accept → EMFILE-style failure: server keeps listening, client sees connect error", async () => {
    const server = net.createServer();
    server.on("error", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    try {
      // Block one accept (repeat:1 self-disarms). The first client's TCP
      // connect succeeds (kernel backlog) but the server-side accept fails;
      // await c1's 'connect' so the accept has definitively been attempted
      // before connecting c2.
      fault.set({ syscall: "accept", action: "errno", errno: "ENOMEM", repeat: 1 });
      const c1 = net.connect({ port, host: "127.0.0.1" });
      c1.on("error", () => {});
      await once(c1, "connect");
      c1.destroy();

      const okP = once(server, "connection") as Promise<[net.Socket]>;
      const c2 = net.connect({ port, host: "127.0.0.1" });
      const [[serverSock]] = await Promise.all([okP, once(c2, "connect")]);
      expect(c2.readyState).toBe("open");
      serverSock.destroy();
      c2.destroy();
    } finally {
      server.close();
    }
  });

  test("two rules can be armed simultaneously (recv short + send short)", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "recv", action: "short", bytes: 3, repeat: -1 });
    fault.set({ syscall: "send", action: "short", bytes: 3, repeat: -1 });
    const payload = Buffer.alloc(300, "k");
    p.client.write(payload);
    p.client.end();
    await once(p.serverSock, "end");
    expect(received.equals(payload)).toBe(true);
  });

  test("send → short writes deliver a payload larger than the kernel send buffer", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "send", action: "short", bytes: 1024, repeat: -1 });
    const payload = Buffer.alloc(128 * 1024, 0x41);
    p.client.write(payload);
    p.client.end();
    await once(p.serverSock, "end");
    expect(received.length).toBe(payload.length);
    expect(received.equals(payload)).toBe(true);
  });

  test("after: N skips the first N matching calls", async () => {
    using p = await connectedPair();
    // Skip the first recv (the readable notification arms one), fail the second.
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", after: 1, repeat: 1 });
    let firstChunk: Buffer | null = null;
    p.client.once("data", c => (firstChunk = c));
    const errP = once(p.client, "error");
    p.serverSock.write("first");
    await new Promise<void>(r => p.client.once("data", () => r()));
    p.serverSock.write("second");
    const [err] = (await errP) as [NodeJS.ErrnoException];
    expect(firstChunk!.toString()).toBe("first");
    expect(err.code).toBe("ECONNRESET");
  });
});

describe.skipIf(skip)("node:net torture loop (exhaustive Nth-call failure)", () => {
  // curl/SQLite torture pattern: for i in 1..N, clamp the i-th and later
  // recv()s to 1 byte and assert the full payload is always reassembled —
  // proves there is no position i at which a short read corrupts framing.
  test("recv → 1-byte short starting at every position i in 1..N delivers intact payload", async () => {
    const payload = Buffer.alloc(64, "T");
    for (let i = 0; i < 10; i++) {
      using p = await connectedPair(s => s.on("error", () => {}));
      let received = Buffer.alloc(0);
      p.client.on("data", c => (received = Buffer.concat([received, c])));
      fault.set({ syscall: "recv", action: "short", bytes: 1, after: i, repeat: -1 });
      p.serverSock.write(payload);
      p.serverSock.end();
      await once(p.client, "end");
      fault.clear();
      expect(received.equals(payload)).toBe(true);
    }
  });
});

describe.skipIf(skip)("node:net seeded syscall fuzz", () => {
  // Deterministic xorshift seeded from env so CI failures are reproducible.
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x2b1a) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  // The fuzz exercises chunking boundaries: every plan is a "short" clamp
  // that must still deliver the full payload. errno injection is covered by
  // the deterministic tests above; mixing it here would require per-fd
  // targeting (both client and server live in this process and share the
  // process-wide rule table).
  const PLANS = [
    { syscall: "recv", action: "short", bytes: 1 },
    { syscall: "recv", action: "short", bytes: 3 },
    { syscall: "recv", action: "short", bytes: 7 },
    { syscall: "recv", action: "short", bytes: 13 },
    { syscall: "send", action: "short", bytes: 1 },
    { syscall: "send", action: "short", bytes: 5 },
    { syscall: "send", action: "short", bytes: 11 },
  ] as const;

  test("randomized short-read/short-write echo round-trips deliver intact and never crash", async () => {
    const rand = makePrng(seed);
    for (let i = 0; i < 24; i++) {
      const plan = PLANS[Math.floor(rand() * PLANS.length)]!;
      const after = Math.floor(rand() * 3);

      let echoed = Buffer.alloc(0);
      using p = await connectedPair(s => {
        s.on("data", c => s.write(c));
        s.on("error", () => {});
      });
      p.client.on("error", () => {});
      p.client.on("data", c => (echoed = Buffer.concat([echoed, c])));

      fault.set({ ...plan, after, repeat: -1 } as any);

      const payload = Buffer.alloc(64, i & 0xff);
      p.client.write(payload);
      while (echoed.length < payload.length) {
        await once(p.client, "data");
      }
      fault.clear();
      expect(echoed.equals(payload)).toBe(true);
      p.client.destroy();
      await once(p.client, "close").catch(() => {});
      expect(p.client.destroyed).toBe(true);
    }
  });
});
