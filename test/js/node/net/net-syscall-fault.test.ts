import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { bytesWrittenUntil, patterned, receive } from "./unsent-bytes-helpers";

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
    p.client.on("data", (c: Buffer) => chunks.push(c));
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i & 0xff));
    p.serverSock.write(payload);
    p.serverSock.end();
    await once(p.client, "end");
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  test("send → EAGAIN forever: data is buffered, then flushed after disarm", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "send", action: "errno", errno: "EAGAIN", repeat: -1 });
    p.client.write(Buffer.alloc(256, "x"));
    fault.clear();
    p.client.end();
    await once(p.serverSock, "end");
    expect(received.length).toBe(256);
  });

  test("send → short writes still deliver complete payload to peer", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
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
        reader.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));

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

  // Calls `write` from the 'connection' (server) or 'connect' (client) listener. Resolves once both sockets closed.
  async function writeInOpenListener(
    side: "client" | "server",
    write: (s: net.Socket, fd: number, written: (err?: Error | null) => void) => void,
  ) {
    let writeError: NodeJS.ErrnoException | null | undefined;
    let socketError: NodeJS.ErrnoException | undefined;
    let received = Buffer.alloc(0);
    const sockets: net.Socket[] = [];
    const closed: Promise<unknown>[] = [];
    function track(s: net.Socket) {
      sockets.push(s);
      // Not events.once(), which rejects on 'error'.
      closed.push(new Promise(resolve => s.once("close", resolve)));
    }
    function writer(s: net.Socket) {
      s.on("error", err => (socketError = err));
      write(s, (s as any)._handle.fd, err => (writeError = err ?? null));
    }
    function reader(s: net.Socket) {
      s.on("error", () => {});
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
    }

    const server = net.createServer(s => {
      track(s);
      if (side === "server") writer(s);
      else reader(s);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    track(client);
    if (side === "client") client.once("connect", () => writer(client));
    else reader(client);

    try {
      await Promise.all([once(client, "connect"), once(server, "connection")]);
      await Promise.all(closed);
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }

    const shape = (err: NodeJS.ErrnoException | null | undefined) => err && { code: err.code, syscall: err.syscall };
    return { writeError: shape(writeError), socketError: shape(socketError), received: received.length };
  }

  describe.each(["client", "server"] as const)("write in the %s's open listener", side => {
    test("send → EPIPE on the flush after the listener fails the write", async () => {
      const result = await writeInOpenListener(side, (s, fd, written) => {
        // The first send is short, so 199 bytes stay buffered until the listener returns.
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: 1, fd });
        s.write(Buffer.alloc(200, "h"), written);
        fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: 1, fd });
        s.write(Buffer.alloc(4096, "b"));
        s.end();
      });
      expect(result).toEqual({
        writeError: { code: "EPIPE", syscall: "write" },
        socketError: { code: "EPIPE", syscall: "write" },
        received: 1,
      });
    });

    test("send → ECONNRESET doesn't send the failed write again", async () => {
      const result = await writeInOpenListener(side, (s, fd, written) => {
        // Fails once: a second send of the same bytes would succeed.
        fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: 1, fd });
        s.write(Buffer.alloc(200, "h"), written);
      });
      expect(result).toEqual({
        writeError: { code: "ECONNRESET", syscall: "write" },
        socketError: { code: "ECONNRESET", syscall: "write" },
        received: 0,
      });
    });
  });

  // us_socket_write_check_error gives send() errnos that are neither
  // would-block/transient nor known peer-gone (EPROTOTYPE: macOS returns it
  // racily from send() on healthy sockets) a bounded retry through the
  // writable rearm machinery instead of failing the first write.
  test("send → EPROTOTYPE burst: bytes are retried and delivered intact", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedPair(s => {
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
    });
    const fd = (p.client as any)._handle.fd as number;
    expect(fd).toBeGreaterThanOrEqual(0);
    fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE" as any, repeat: 8, fd });
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
  test.each(["EPROTOTYPE", "EPERM"])(
    "send → sustained %s surfaces as 'error' + close, not silent truncation",
    async errno => {
      using p = await connectedPair();
      const fd = (p.client as any)._handle.fd as number;
      expect(fd).toBeGreaterThanOrEqual(0);
      fault.set({ syscall: "send", action: "errno", errno: errno as any, repeat: -1, fd });
      const errP = once(p.client, "error") as Promise<[NodeJS.ErrnoException]>;
      // Not events.once(): that helper rejects its promise when 'error' fires
      // first, and 'error' arriving before 'close' is exactly this contract.
      const closeP = new Promise<void>(resolve => p.client.once("close", () => resolve()));
      p.client.write(Buffer.alloc(64, "x"));
      const [err] = await errP;
      fault.clear();
      expect({ code: err.code, syscall: err.syscall }).toEqual({ code: errno, syscall: "write" });
      await closeP;
      expect(p.client.destroyed).toBe(true);
    },
  );

  // Server-side twin of the above. On kqueue the failed flush from the writable event
  // runs before the read dispatch (EV_EOF sets eof, not error), so the pending
  // write's completion is the only place the errno is visible (test-net-stream.js on darwin).
  test("server: send → sustained fatal flush surfaces 'error' + 'close' on the accepted socket", async () => {
    using p = await connectedPair();
    const fd = (p.serverSock as any)._handle.fd as number;
    expect(fd).toBeGreaterThanOrEqual(0);
    fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE" as any, repeat: -1, fd });
    const errP = once(p.serverSock, "error") as Promise<[NodeJS.ErrnoException]>;
    const closeP = new Promise<void>(resolve => p.serverSock.once("close", () => resolve()));
    p.serverSock.write(Buffer.alloc(64, "s"));
    const [err] = await errP;
    fault.clear();
    expect({ code: err.code, syscall: err.syscall }).toEqual({ code: "EPROTOTYPE", syscall: "write" });
    await closeP;
    expect(p.serverSock.destroyed).toBe(true);
  });

  // Node hands a send the kernel rejects at once to the stream inside write()
  // itself, so write() returns false and the socket is errored in the same
  // call. The stream runs the write callbacks and destroys it on the next tick.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L158-L159
  for (const side of ["client", "server"] as const) {
    test.each([
      { result: "ECONNRESET", rule: { action: "errno", errno: "ECONNRESET" }, code: "ECONNRESET" },
      { result: "EPIPE", rule: { action: "errno", errno: "EPIPE" }, code: "EPIPE" },
      { result: "more bytes than it was given", rule: { action: "excess" }, code: "ECONNABORTED" },
    ] as const)(
      `send → $result on the first attempt: write() returns false and the socket is errored in the same call (${side} writer)`,
      async ({ rule, code }) => {
        using p = await connectedPair();
        const writer = side === "client" ? p.client : p.serverSock;
        const fd = (writer as any)._handle.fd as number;
        expect(fd).toBeGreaterThanOrEqual(0);
        fault.set({ syscall: "send", ...rule, repeat: 1, fd });

        const events: string[] = [];
        writer.on("error", (e: NodeJS.ErrnoException) => events.push(`error ${e.code} ${e.syscall}`));
        const closed = new Promise<void>(resolve => {
          writer.on("close", hadError => {
            events.push(`close ${hadError}`);
            resolve();
          });
        });
        const first = writer.write("x", e => events.push(`write#1 ${(e as NodeJS.ErrnoException)?.code}`));
        const afterFirst = {
          destroyed: writer.destroyed,
          errored: (writer.errored as NodeJS.ErrnoException | null)?.code,
          writable: writer.writable,
          writableLength: writer.writableLength,
        };
        // The stream is errored, so this write never reaches send().
        const second = writer.write("y", e => events.push(`write#2 ${(e as NodeJS.ErrnoException)?.code}`));
        await closed;

        expect({ first, afterFirst, second, events }).toEqual({
          first: false,
          afterFirst: { destroyed: false, errored: code, writable: false, writableLength: 0 },
          second: false,
          events: [`write#1 ${code}`, `write#2 ${code}`, `error ${code} write`, "close true"],
        });
      },
    );
  }

  // A cluster worker adopts each accepted connection with socket.connect({ fd }).
  test("send → fatal flush of a buffered write emits 'error' once in a cluster worker", async () => {
    using dir = tempDir("net-fault-cluster", {
      "fixture.js": `
        const cluster = require("node:cluster");
        const net = require("node:net");

        if (cluster.isPrimary) {
          const worker = cluster.fork();
          worker.on("message", msg => {
            if (msg.port) {
              const peer = net.connect(msg.port, "127.0.0.1");
              peer.on("error", () => {});
              peer.resume();
            } else {
              console.log(JSON.stringify(msg.events));
              worker.kill();
              process.exit(0);
            }
          });
        } else {
          const { socketFaultInjection: fault } = require("bun:internal-for-testing");
          const events = [];
          const server = net.createServer(c => {
            const fd = c._handle.fd;
            c.on("error", e => events.push("error:" + e.code));
            c.on("close", hadError => {
              events.push("close:" + hadError);
              setImmediate(() => process.send({ events }));
            });
            // The first send is short, so 199 bytes stay buffered and the write callback waits.
            fault.set({ syscall: "send", action: "short", bytes: 1, repeat: 1, fd });
            c.write(Buffer.alloc(200, "h"), err => events.push("write:" + (err ? err.code : "ok")));
            // The second send is the flush on the writable event.
            fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: 1, fd });
          });
          server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["write:EPIPE", "error:EPIPE", "close:true"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("poll_start → a cluster worker drops a connection that it can't adopt and serves the next", async () => {
    using dir = tempDir("net-fault-cluster-adopt", {
      "fixture.js": `
        const cluster = require("node:cluster");
        const net = require("node:net");

        if (cluster.isPrimary) {
          const worker = cluster.fork();
          const dial = (port, next) =>
            net.connect(port, "127.0.0.1").on("data", chunk => console.log(String(chunk))).on("close", next);
          worker.on("message", port => dial(port, () => (console.log("dropped"), dial(port, () => worker.disconnect()))));
          worker.on("exit", code => console.log("exit", code));
        } else {
          const { socketFaultInjection: fault } = require("bun:internal-for-testing");
          const server = net.createServer(c => c.end("served"));
          server.listen(0, "127.0.0.1", () => {
            fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
            process.send(server.address().port);
          });
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "dropped\nserved\nexit 0\n", stderr: "", exitCode: 0 });
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

  test.each(["ENETUNREACH", "EHOSTUNREACH", "EPERM", "ENOBUFS", "EMFILE"])(
    "connect → %s keeps its code",
    async errno => {
      fault.set({ syscall: "connect", action: "errno", errno, repeat: 1 });
      const client = net.connect({ port: 1, host: "127.0.0.1" });
      const [err] = (await once(client, "error")) as [NodeJS.ErrnoException];
      expect({ code: err.code, syscall: err.syscall }).toEqual({ code: errno, syscall: "connect" });
    },
  );

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
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
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
      s.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
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
    p.client.once("data", (c: Buffer) => (firstChunk = c));
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
      p.client.on("data", (c: Buffer) => (received = Buffer.concat([received, c])));
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
      p.client.on("data", (c: Buffer) => (echoed = Buffer.concat([echoed, c])));

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

// A short send leaves the rest of the chunk in the native queue, and each writable event sends more of it.
describe.skipIf(skip)("node:net pending-write queue under short sends", () => {
  test.each([
    // 64 sends of 16,384 bytes, so the last one empties the queue exactly.
    ["client", 16384],
    ["server", 16384],
    ["client", 10000],
  ] as const)(
    "a write drained by writable events arrives intact (%s writer, %d bytes per send)",
    async (side, bytes) => {
      using p = await connectedPair();
      const [writer, reader] = side === "client" ? [p.client, p.serverSock] : [p.serverSock, p.client];
      const handle = (writer as any)._handle;
      const payload = patterned(1024 * 1024);
      const state = receive(reader, payload);
      const idle = estimateShallowMemoryUsageOf(handle);

      fault.set({ syscall: "send", action: "short", bytes, repeat: -1, fd: handle.fd });
      const { promise: written, resolve, reject } = Promise.withResolvers<void>();
      writer.write(payload, err => (err ? reject(err) : resolve()));
      const queued = estimateShallowMemoryUsageOf(handle) - idle;
      const bytesWritten = await bytesWrittenUntil(written, writer);
      const heldAfter = estimateShallowMemoryUsageOf(handle) - idle;
      writer.end();
      await once(reader, "end");

      expect({ queued, bytesWritten, heldAfter, ...state }).toEqual({
        queued: payload.length - bytes,
        bytesWritten: [payload.length],
        heldAfter: 0,
        received: payload.length,
        intact: true,
      });
    },
  );

  // Socket.prototype._write reaches the native write while a tail is queued, as the inspector's socket transport does.
  test("a write behind a queued tail arrives in order", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const first = patterned(16384);
    const second = patterned(65536, 0x85ebca6b);
    const expected = Buffer.concat([first, second]);
    const state = receive(p.serverSock, expected);

    fault.set({ syscall: "send", action: "short", bytes: 1024, repeat: -1, fd: handle.fd });
    (p.client as any)._write(first, "buffer", () => {});
    const { promise: written, resolve, reject } = Promise.withResolvers<void>();
    (p.client as any)._write(second, "buffer", (err?: Error | null) => (err ? reject(err) : resolve()));
    const bytesWritten = await bytesWrittenUntil(written, p.client);
    p.client.end();
    await once(p.serverSock, "end");

    expect({ bytesWritten, ...state }).toEqual({
      bytesWritten: [expected.length],
      received: expected.length,
      intact: true,
    });
  });

  // Writable events send from the tail before the second write arrives, so the
  // second chunk goes behind a tail whose front the socket already took.
  test("a write behind a tail that writable events partly sent arrives in order", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const first = patterned(256 * 1024);
    const second = patterned(1024 * 1024, 0x85ebca6b);
    const expected = Buffer.concat([first, second]);
    const state = receive(p.serverSock, expected);
    const idle = estimateShallowMemoryUsageOf(handle);

    fault.set({ syscall: "send", action: "short", bytes: 1024, repeat: -1, fd: handle.fd });
    (p.client as any)._write(first, "buffer", () => {});
    // The write itself sent 1,024 bytes. What arrives beyond them left in a writable event.
    while (state.received <= 1024) await once(p.serverSock, "data");
    const { promise: written, resolve, reject } = Promise.withResolvers<void>();
    (p.client as any)._write(second, "buffer", (err?: Error | null) => (err ? reject(err) : resolve()));
    fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: handle.fd });
    const bytesWritten = await bytesWrittenUntil(written, handle);
    const allocatedAfterDrain = estimateShallowMemoryUsageOf(handle) - idle;
    p.client.end();
    await once(p.serverSock, "end");

    expect({ bytesWritten, allocatedAfterDrain, ...state }).toEqual({
      bytesWritten: [expected.length],
      allocatedAfterDrain: 0,
      received: expected.length,
      intact: true,
    });
  });

  // A write that brings no bytes still sends from the front of a queued tail.
  test("an empty write behind a queued tail sends from the front of the tail", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const payload = patterned(41 * 1024);
    const state = receive(p.serverSock, payload);
    const idle = estimateShallowMemoryUsageOf(handle);

    fault.set({ syscall: "send", action: "short", bytes: 1024, repeat: -1, fd: handle.fd });
    (p.client as any)._write(payload, "buffer", () => {});
    const queuedTail = estimateShallowMemoryUsageOf(handle) - idle;
    const errors: Error[] = [];
    // Each of these sends 1,024 bytes more of the tail. The queue frees its
    // allocation when the last one takes the last byte, and not before.
    let allocatedBeforeLastWrite = 0;
    for (let i = 0; i < 40; i++) {
      if (i === 39) allocatedBeforeLastWrite = estimateShallowMemoryUsageOf(handle) - idle;
      (p.client as any)._write(Buffer.alloc(0), "buffer", (err?: Error | null) => {
        if (err) errors.push(err);
      });
    }
    expect({
      queuedTail,
      allocatedBeforeLastWrite,
      allocatedAfterWrites: estimateShallowMemoryUsageOf(handle) - idle,
      bytesWritten: handle.bytesWritten,
      errors,
    }).toEqual({
      queuedTail: payload.length - 1024,
      allocatedBeforeLastWrite: payload.length - 1024,
      allocatedAfterWrites: 0,
      bytesWritten: payload.length,
      errors: [],
    });

    p.client.end();
    await once(p.serverSock, "end");
    expect({ errors, ...state }).toEqual({ errors: [], received: payload.length, intact: true });
  });

  // The queue drops its sent prefix when a chunk arrives behind a tail that is
  // more than half sent. The chunk then fits in the allocation of the tail.
  test("a write behind a tail that is mostly sent does not grow the allocation", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const first = patterned(256 * 1024);
    const second = patterned(65536, 0x85ebca6b);
    const expected = Buffer.concat([first, second]);
    const state = receive(p.serverSock, expected);
    const idle = estimateShallowMemoryUsageOf(handle);

    fault.set({ syscall: "send", action: "short", bytes: 4096, repeat: -1, fd: handle.fd });
    (p.client as any)._write(first, "buffer", () => {});
    while (state.received <= (first.length * 3) / 4) await once(p.serverSock, "data");
    const allocatedBefore = estimateShallowMemoryUsageOf(handle) - idle;
    const { promise: written, resolve, reject } = Promise.withResolvers<void>();
    (p.client as any)._write(second, "buffer", (err?: Error | null) => (err ? reject(err) : resolve()));
    const allocatedAfter = estimateShallowMemoryUsageOf(handle) - idle;
    const bytesWritten = await bytesWrittenUntil(written, handle);
    p.client.end();
    await once(p.serverSock, "end");

    expect({ allocatedBefore, allocatedAfter, bytesWritten, ...state }).toEqual({
      allocatedBefore: first.length - 4096,
      allocatedAfter: first.length - 4096,
      bytesWritten: [expected.length],
      received: expected.length,
      intact: true,
    });
  });

  // 64 chunks of 64 KiB go behind a tail that never empties. About 4 chunks
  // wait in the queue at a time, so the allocation does not follow the total.
  test("writes behind a tail that never empties keep the allocation near the unsent bytes", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const chunk = 65536;
    const count = 64;
    const expected = patterned(count * chunk);
    const state = receive(p.serverSock, expected);
    const idle = estimateShallowMemoryUsageOf(handle);

    fault.set({ syscall: "send", action: "short", bytes: 8192, repeat: -1, fd: handle.fd });
    let peak = 0;
    let emptied = 0;
    const { promise: written, resolve, reject } = Promise.withResolvers<void>();
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      // An empty queue holds no allocation.
      if (i > 0 && estimateShallowMemoryUsageOf(handle) === idle) emptied++;
      (p.client as any)._write(expected.subarray(i * chunk, (i + 1) * chunk), "buffer", (err?: Error | null) =>
        err ? reject(err) : last && resolve(),
      );
      peak = Math.max(peak, estimateShallowMemoryUsageOf(handle) - idle);
      while ((i + 1) * chunk - state.received > 4 * chunk) await once(p.serverSock, "data");
    }
    await written;
    p.client.end();
    await once(p.serverSock, "end");

    expect({ emptied, ...state }).toEqual({ emptied: 0, received: expected.length, intact: true });
    expect(peak).toBeLessThan(16 * chunk);
  });

  // Each run sends 1,024 times, 1 KiB per send. The second queue holds 16 times
  // the bytes of the first. A queue that moves its unsent bytes to the front
  // after each send takes many times the CPU time for the second run.
  test("the CPU time of a send does not follow the bytes still queued", async () => {
    const sends = 1024;
    const bytesPerSend = 1024;

    // The CPU time from the return of write() until the peer has what `sends` sends carry.
    async function cpuTimeOfSends(queued: number) {
      using p = await connectedPair();
      const handle = (p.client as any)._handle;
      const { promise: sent, resolve } = Promise.withResolvers<void>();
      let received = 0;
      p.serverSock.on("data", chunk => {
        received += chunk.length;
        if (received >= sends * bytesPerSend) resolve();
      });

      fault.set({ syscall: "send", action: "short", bytes: bytesPerSend, repeat: -1, fd: handle.fd });
      p.client.write(Buffer.alloc(queued, 0x61));
      const before = process.cpuUsage();
      await sent;
      const { user, system } = process.cpuUsage(before);
      fault.clear();
      return user + system;
    }

    const small = sends * bytesPerSend;
    const large = 16 * small;
    // The first run pays for what the later runs find warm.
    await cpuTimeOfSends(small);
    const smallTimes: number[] = [];
    const largeTimes: number[] = [];
    for (let i = 0; i < 3; i++) {
      smallTimes.push(await cpuTimeOfSends(small));
      largeTimes.push(await cpuTimeOfSends(large));
    }
    expect(Math.min(...largeTimes) / Math.min(...smallTimes)).toBeLessThan(5);
  });

  test("a write made from the 'drain' listener queues behind nothing and arrives in order", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const first = patterned(512 * 1024);
    const second = patterned(512 * 1024, 0x85ebca6b);
    const expected = Buffer.concat([first, second]);
    const state = receive(p.serverSock, expected);
    const callbacks: string[] = [];

    fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: handle.fd });
    const { promise: written, resolve, reject } = Promise.withResolvers<void>();
    p.client.once("drain", () => {
      callbacks.push(`drain at ${p.client.bytesWritten}`);
      p.client.write(second, err => {
        callbacks.push("second");
        err ? reject(err) : resolve();
      });
    });
    const flushed = p.client.write(first, err => {
      callbacks.push("first");
      if (err) reject(err);
    });
    await written;
    const bytesWritten = p.client.bytesWritten;
    p.client.end();
    await once(p.serverSock, "end");

    expect({ flushed, callbacks, bytesWritten, ...state }).toEqual({
      flushed: false,
      // Like Node, 'drain' comes before the callback of the write that drained.
      callbacks: [`drain at ${first.length}`, "first", "second"],
      bytesWritten: expected.length,
      received: expected.length,
      intact: true,
    });
  });

  test("a reset by the peer halfway through the queue fails the write once, frees the queue and keeps bytesWritten", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const payload = patterned(1024 * 1024);
    const state = receive(p.serverSock, payload);
    const idle = estimateShallowMemoryUsageOf(handle);
    const callbacks: (string | undefined)[] = [];
    const closed = Promise.withResolvers<void>();
    p.client.on("error", () => {});
    p.client.on("close", () => closed.resolve());

    fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: handle.fd });
    p.client.write(payload, err => callbacks.push((err as NodeJS.ErrnoException | undefined)?.code));
    while (state.received < 128 * 1024) await once(p.serverSock, "data");
    p.serverSock.resetAndDestroy();
    await closed.promise;

    expect(callbacks).toHaveLength(1);
    // ECANCELED if the loop reads the reset first, the send's errno if the writable event comes first.
    expect(["ECANCELED", "ECONNRESET", "EPIPE"]).toContain<string | undefined>(callbacks[0]);
    expect(estimateShallowMemoryUsageOf(handle) - idle).toBeLessThan(1024);
    expect({ bytesWritten: p.client.bytesWritten, intact: state.intact }).toEqual({
      bytesWritten: payload.length,
      intact: true,
    });
  });

  test("a send that fails halfway through the queue fails the write once, frees the queue and keeps bytesWritten", async () => {
    using p = await connectedPair();
    const handle = (p.client as any)._handle;
    const payload = patterned(1024 * 1024);
    const state = receive(p.serverSock, payload);
    const idle = estimateShallowMemoryUsageOf(handle);
    const callbacks: (string | undefined)[] = [];
    const closed = Promise.withResolvers<void>();
    p.client.on("error", () => {});
    p.client.on("close", () => closed.resolve());

    fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: handle.fd });
    p.client.write(payload, err => callbacks.push((err as NodeJS.ErrnoException | undefined)?.code));
    while (state.received < 128 * 1024) await once(p.serverSock, "data");
    fault.clear();
    fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1, fd: handle.fd });
    await closed.promise;

    expect(estimateShallowMemoryUsageOf(handle) - idle).toBeLessThan(1024);
    expect({ callbacks, bytesWritten: p.client.bytesWritten, intact: state.intact }).toEqual({
      callbacks: ["EPIPE"],
      bytesWritten: payload.length,
      intact: true,
    });
  });

  // The TLS queue holds plaintext, and TLS has no writev path.
  test("tls: writes drained by writable events arrive in order", async () => {
    const server = tls.createServer({ key: certs.key, cert: certs.cert });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const connection = once(server, "secureConnection") as Promise<[tls.TLSSocket]>;
    const client = tls.connect({
      port: (server.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      ca: certs.cert,
      rejectUnauthorized: true,
    });
    try {
      const [[serverSock]] = await Promise.all([connection, once(client, "secureConnect")]);
      const handle = (client as any)._handle;
      const first = patterned(1024 * 1024);
      const second = patterned(256 * 1024, 0x85ebca6b);
      const expected = Buffer.concat([first, second]);
      const state = receive(serverSock, expected);
      const idle = estimateShallowMemoryUsageOf(handle);
      const callbacks: string[] = [];

      fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: handle.fd });
      const { promise: written, resolve, reject } = Promise.withResolvers<void>();
      client.write(first, err => (err ? reject(err) : callbacks.push("first")));
      client.write(second, err => (err ? reject(err) : (callbacks.push("second"), resolve())));
      const bytesWritten = await bytesWrittenUntil(written, client);
      const heldAfter = estimateShallowMemoryUsageOf(handle) - idle;
      client.end();
      await once(serverSock, "end");

      expect({ callbacks, bytesWritten, heldAfter, ...state }).toEqual({
        callbacks: ["first", "second"],
        bytesWritten: [expected.length],
        heldAfter: 0,
        received: expected.length,
        intact: true,
      });
    } finally {
      client.destroy();
      server.close();
    }
  });
});
