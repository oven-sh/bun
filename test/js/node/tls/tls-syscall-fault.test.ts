import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import { once } from "node:events";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// The OOM fixture is a separate bun process that aborts on purpose. It is
// started here, before the first test, so it runs alongside the serial
// in-process tests below and is only awaited by the last test of the file.
// It sets no fault in this process.
let oomChild: { proc: Bun.Subprocess; result: Promise<[string, string, number]> } | null = null;

// One TLS server for every in-process test: the faults are injected into the
// client side's syscalls, and each test drives exactly one connection at a
// time, so the listening socket is never affected. Each accepted socket
// swallows its own error: the process-wide faults hit the server side too.
let server: tls.Server;
let port: number;

beforeAll(async () => {
  if (fault.available()) {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        // Skip the debug build's symbolized backtrace: it costs seconds and the
        // assertion only needs the crash reason line.
        "--debug-crash-handler-use-trace-string",
        join(import.meta.dir, "tls-loop-buffer-oom-fixture.ts"),
      ],
      // BUN_CRASH_REPORT_URL="": this OOM is deliberate; uploading it to CI's
      // remap server would pin a spurious "crash reported" error on the next
      // unrelated failing test.
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    oomChild = { proc, result: Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]) };
  }
  if (skip) return;
  server = tls.createServer({ key: certs.key, cert: certs.cert });
  server.on("secureConnection", s => s.on("error", () => {}));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  oomChild?.proc.kill();
  server?.close();
});

function connect(options: tls.ConnectionOptions = {}) {
  return tls.connect({ port, host: "127.0.0.1", ca: certs.cert, rejectUnauthorized: true, ...options });
}

async function connectedTLSPair(onServerSocket?: (s: tls.TLSSocket) => void) {
  // Register the server-side listener before initiating connect so the
  // 'secureConnection' event cannot be missed.
  const serverSockP = (once(server, "secureConnection") as Promise<[tls.TLSSocket]>).then(([s]) => {
    onServerSocket?.(s);
    return s;
  });
  const client = connect();
  const [, serverSock] = await Promise.all([once(client, "secureConnect"), serverSockP]);

  return {
    client,
    serverSock,
    [Symbol.dispose]() {
      client.destroy();
      serverSock.destroy();
    },
  };
}

type ObservedError = { name: string; code?: string; syscall?: string; message: string };

// Records the lifecycle events of a socket in the order they fire. `closed`
// resolves on 'close' whether or not an 'error' came first (events.once would
// reject on the error).
function observe(socket: tls.TLSSocket) {
  const events: string[] = [];
  const errors: ObservedError[] = [];
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  socket.on("end", () => events.push("end"));
  socket.on("error", (e: NodeJS.ErrnoException) => {
    events.push("error");
    errors.push({ name: e.name, code: e.code, syscall: e.syscall, message: e.message });
  });
  socket.on("close", hadError => events.push(`close(hadError=${hadError})`));
  return { events, errors, closed };
}

const CLEAN_CLOSE = ["end", "close(hadError=false)"];
const RESET_CLOSE = {
  events: ["error", "close(hadError=true)"],
  errors: [{ name: "Error", code: "ECONNRESET", syscall: "read", message: "read ECONNRESET" }],
  destroyed: true,
};

function fdOf(socket: tls.TLSSocket): number {
  return (socket as any)._handle.fd;
}

function collect(socket: tls.TLSSocket) {
  const chunks: Buffer[] = [];
  socket.on("data", (c: Buffer) => chunks.push(c));
  return () => Buffer.concat(chunks);
}

describe.skipIf(skip)("node:tls under injected syscall faults", () => {
  test("recv → ECONNRESET during established session surfaces as 'error'", async () => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
    p.serverSock.write("hello");
    await client.closed;
    expect({ events: client.events, errors: client.errors, destroyed: p.client.destroyed }).toEqual(RESET_CLOSE);
  });

  test.each(["client", "server"] as const)("send → ECONNRESET fails the %s's write", async side => {
    using p = await connectedTLSPair();
    const writer = side === "client" ? p.client : p.serverSock;
    const seen = observe(writer);
    const written = Promise.withResolvers<Error | null | undefined>();
    fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", repeat: -1, fd: fdOf(writer) });
    writer.write("hello", written.resolve);
    const WRITE_RESET = { name: "Error", code: "ECONNRESET", syscall: "write", message: "write ECONNRESET" };
    expect(await written.promise).toMatchObject(WRITE_RESET);
    await seen.closed;
    expect({ events: seen.events, errors: seen.errors }).toEqual({
      events: ["error", "close(hadError=true)"],
      errors: [WRITE_RESET],
    });
  });

  test("send → an errno that names no dead peer is retried 32 times in a row, then closes", async () => {
    let received!: () => Buffer;
    using p = await connectedTLSPair(s => (received = collect(s)));
    const client = observe(p.client);
    for (const round of ["a", "b"]) {
      // A send that goes through starts the count again, or round "b" would close.
      fault.set({ syscall: "send", action: "errno", errno: "EINVAL", repeat: 32, fd: fdOf(p.client) });
      p.client.write(round);
      await once(p.serverSock, "data");
    }
    fault.set({ syscall: "send", action: "errno", errno: "EINVAL", repeat: 33, fd: fdOf(p.client) });
    p.client.write("c");
    await client.closed;
    expect({ received: received().toString(), events: client.events, codes: client.errors.map(e => e.code) }).toEqual({
      received: "ab",
      events: ["error", "close(hadError=true)"],
      codes: ["EINVAL"],
    });
  });

  // The write was reported as done with its tail still in userspace, so only the close can carry the error.
  test.each([
    ["closes with the error", false],
    ["first delivers what the peer sent before", true],
  ])("send → EPIPE for ciphertext that waits for the writable event %s", async (_name, peerWroteFirst) => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    const received = collect(p.client);
    if (peerWroteFirst) {
      p.client.pause();
      await new Promise<void>(resolve => p.serverSock.write("late", () => resolve()));
    }
    fault.set({ syscall: "send", action: "short", bytes: 10, fd: fdOf(p.client) });
    p.client.write("hello");
    fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1, fd: fdOf(p.client) });
    p.client.resume();
    await client.closed;
    expect({ received: received().toString(), events: client.events, codes: client.errors.map(e => e.code) }).toEqual(
      peerWroteFirst
        ? { received: "late", events: CLEAN_CLOSE, codes: [] }
        : { received: "", events: ["error", "close(hadError=true)"], codes: ["EPIPE"] },
    );
  });

  test("send → EPIPE for the ClientHello fails connect with an error (no hang)", async () => {
    fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1 });
    const c = connect();
    const client = observe(c);
    await client.closed;
    fault.clear();
    expect({ events: client.events, errors: client.errors, destroyed: c.destroyed }).toEqual(RESET_CLOSE);
  });

  // https://github.com/oven-sh/bun/issues/24845: the kernel rejects every send() and reports nothing on the read side.
  describe("send → EPIPE while the peer stays silent", () => {
    let silent: tls.Server;
    let silentPort: number;
    beforeAll(async () => {
      silent = tls.createServer({ key: certs.key, cert: certs.cert, allowHalfOpen: true }, s =>
        s.on("error", () => {}),
      );
      await once(silent.listen(0, "127.0.0.1"), "listening");
      silentPort = (silent.address() as AddressInfo).port;
    });
    afterAll(() => silent.close());

    test("Bun.connect: write() returns -1 and the socket closes with an error", async () => {
      const closed = Promise.withResolvers<Error | undefined>();
      const writes: number[] = [];
      const accepted = once(silent, "secureConnection") as Promise<[tls.TLSSocket]>;
      await Bun.connect({
        hostname: "127.0.0.1",
        port: silentPort,
        tls: { ca: certs.cert },
        socket: {
          async handshake(socket) {
            await accepted;
            fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1 });
            writes.push(socket.write("ping"), socket.write("ping"));
          },
          data() {},
          close: (_socket, error) => closed.resolve(error),
          connectError: (_socket, error) => closed.reject(error),
        },
      });
      expect(await closed.promise).toMatchObject({ code: "ECONNRESET" });
      expect(writes).toEqual([-1, -1]);
      (await accepted)[0].destroy();
    });

    test("fetch rejects when a chunk of its request body cannot be sent", async () => {
      const accepted = once(silent, "secureConnection") as Promise<[tls.TLSSocket]>;
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const response = fetch(`https://127.0.0.1:${silentPort}/`, {
        method: "POST",
        body: new ReadableStream({ start: controller => void (body = controller) }),
        tls: { ca: certs.cert, checkServerIdentity: () => undefined },
      });
      const [serverSock] = await accepted;
      await once(serverSock, "data");
      fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1 });
      body.enqueue(Buffer.alloc(1024, "x"));
      expect(await response.catch(error => error.code)).toBe("ECONNRESET");
      serverSock.destroy();
    });

    // The failing send() of the outer socket runs inside the tunnel's own TLS pass.
    describe("fetch through a TLS proxy", () => {
      let proxy: tls.Server;
      let beforeEstablished: () => void = () => {};
      const sockets = new Set<net.Socket>();
      beforeAll(async () => {
        proxy = tls.createServer({ key: certs.key, cert: certs.cert, allowHalfOpen: true }, client => {
          client.once("data", head => {
            const [host, port] = head.toString().split(" ")[1].split(":");
            const upstream = net.connect({ host, port: Number(port), allowHalfOpen: true }, () => {
              beforeEstablished();
              client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
              client.pipe(upstream, { end: false });
              upstream.pipe(client, { end: false });
            });
            for (const socket of [client, upstream]) sockets.add(socket.on("error", () => {}));
          });
        });
        await once(proxy.listen(0, "127.0.0.1"), "listening");
      });
      afterEach(() => {
        beforeEstablished = () => {};
        for (const socket of sockets) socket.destroy();
        sockets.clear();
      });
      afterAll(() => proxy.close());
      const throughProxy = () => ({
        proxy: `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
        tls: { rejectUnauthorized: false },
      });

      test.each(["send", "ssl_write"] as const)("rejects when %s fails for the tunnel's ClientHello", async syscall => {
        // The one call that still goes through is for the proxy's own answer.
        beforeEstablished = () => fault.set({ syscall, action: "errno", errno: "EPIPE", after: 1, repeat: -1 });
        const response = fetch(`https://127.0.0.1:${silentPort}/`, throughProxy());
        expect(await response.catch(error => error.code)).toBe("ECONNRESET");
      });

      test.each(["send", "ssl_write"] as const)(
        "rejects when %s fails for a chunk of its request body",
        async syscall => {
          const firstChunk = Promise.withResolvers<void>();
          await using origin = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            tls: { key: certs.key, cert: certs.cert },
            async fetch(req) {
              await req.body!.getReader().read();
              firstChunk.resolve();
              await once(req.signal, "abort");
              return new Response();
            },
          });
          let body!: ReadableStreamDefaultController<Uint8Array>;
          const response = fetch(origin.url, {
            method: "POST",
            body: new ReadableStream({ start: controller => void (body = controller) }),
            ...throughProxy(),
          });
          body.enqueue(Buffer.from("first"));
          await firstChunk.promise;
          fault.set({ syscall, action: "errno", errno: "EPIPE", repeat: -1 });
          body.enqueue(Buffer.alloc(1024, "x"));
          expect(await response.catch(error => error.code)).toBe("ECONNRESET");
          fault.clear();
        },
      );
    });
  });

  test("recv → short reads (1 byte) still decrypt complete payload", async () => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    const received = collect(p.client);
    // The TLS record layer must reassemble across many tiny BIO reads.
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    const payload = Buffer.alloc(512, "Z");
    p.serverSock.end(payload);
    await client.closed;
    expect(received()).toEqual(payload);
    expect({ events: client.events, errors: client.errors }).toEqual({ events: CLEAN_CLOSE, errors: [] });
  });

  test("send → short writes (1 byte) still deliver complete encrypted payload", async () => {
    let received!: () => Buffer;
    let serverSide!: ReturnType<typeof observe>;
    using p = await connectedTLSPair(s => {
      received = collect(s);
      serverSide = observe(s);
    });
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    const payload = Buffer.alloc(512, "Y");
    p.client.end(payload);
    await serverSide.closed;
    fault.clear();
    expect(received()).toEqual(payload);
    expect({ events: serverSide.events, errors: serverSide.errors }).toEqual({ events: CLEAN_CLOSE, errors: [] });
  });

  test("recv → 0 (peer closed) on established session emits 'end' without 'error'", async () => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    const received = collect(p.client);
    fault.set({ syscall: "recv", action: "zero", repeat: -1 });
    p.serverSock.write("hello");
    await client.closed;
    // The injected EOF lands before the "hello" record is ever read.
    expect({ events: client.events, errors: client.errors, bytes: received().length }).toEqual({
      events: CLEAN_CLOSE,
      errors: [],
      bytes: 0,
    });
  });

  test("send → short writes during handshake still complete secureConnect", async () => {
    // Clamp every send to 3 bytes — the ClientHello/ServerHello/Finished
    // flights are split across hundreds of partial writes.
    fault.set({ syscall: "send", action: "short", bytes: 3, repeat: -1 });
    using p = await connectedTLSPair();
    fault.clear();
    expect({
      authorized: p.client.authorized,
      authorizationError: p.client.authorizationError,
      serverEncrypted: p.serverSock.encrypted,
    }).toEqual({ authorized: true, authorizationError: null as any, serverEncrypted: true });
  });

  test("recv → short reads at TLS record boundary (5 bytes = header only) still decrypt", async () => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    const received = collect(p.client);
    // 5 bytes is exactly the TLS record header — forces the BIO to assemble
    // header and ciphertext across separate recv calls.
    fault.set({ syscall: "recv", action: "short", bytes: 5, repeat: -1 });
    const payload = Buffer.alloc(256, "R");
    p.serverSock.end(payload);
    await client.closed;
    expect(received()).toEqual(payload);
    expect({ events: client.events, errors: client.errors }).toEqual({ events: CLEAN_CLOSE, errors: [] });
  });

  test("recv → ECONNRESET mid-handshake fails connect with an error (no hang)", async () => {
    // Reset the very first wire read of the ServerHello.
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
    const c = connect();
    const client = observe(c);
    let secureConnect = false;
    c.on("secureConnect", () => (secureConnect = true));
    await client.closed;
    fault.clear();
    expect({ events: client.events, errors: client.errors, destroyed: c.destroyed, secureConnect }).toEqual({
      ...RESET_CLOSE,
      secureConnect: false,
    });
  });
});

// "ssl_write" fails one SSL_write call the way a record-layer failure does (#38120).
describe.skipIf(skip)("fatal SSL_write after the handshake", () => {
  const WRITE_EPROTO = { name: "Error", code: "EPROTO", syscall: "write", message: "write EPROTO" };
  const EPROTO_CLOSE = { events: ["error", "close(hadError=true)"], errors: [WRITE_EPROTO] };

  test.each([
    ["the first record of a write", 5, 0, 0],
    ["a later record of a write", 3 * 16384, 1, 16384],
  ])("node:tls fails the write with EPROTO when %s fails", async (_name, size, after, delivered) => {
    using p = await connectedTLSPair();
    const client = observe(p.client);
    const received = collect(p.client);
    const serverSide = observe(p.serverSock);
    const written = Promise.withResolvers<Error | null | undefined>();
    fault.set({ syscall: "ssl_write", action: "errno", errno: "EINVAL", after, fd: fdOf(p.serverSock) });
    p.serverSock.write(Buffer.alloc(size, "w"), written.resolve);
    expect(await written.promise).toMatchObject(WRITE_EPROTO);
    await Promise.all([serverSide.closed, client.closed]);
    expect({ events: serverSide.events, errors: serverSide.errors, delivered: received().length }).toEqual({
      ...EPROTO_CLOSE,
      delivered,
    });
  });

  test("node:tls fails a write whose tail is retried from the writable event", async () => {
    using p = await connectedTLSPair();
    const serverSide = observe(p.serverSock);
    // The client does not read, so a write ends up partial and its tail is held natively.
    const chunk = Buffer.alloc(1024 * 1024, "z");
    let partialWrite: Promise<Error | null | undefined>;
    do {
      const { promise, resolve } = Promise.withResolvers<Error | null | undefined>();
      partialWrite = promise;
      p.serverSock.write(chunk, resolve);
      await new Promise(resolve => process.nextTick(resolve));
    } while (p.serverSock.writableLength === 0);
    fault.set({ syscall: "ssl_write", action: "errno", errno: "EINVAL", repeat: -1, fd: fdOf(p.serverSock) });
    p.client.resume();
    await serverSide.closed;
    expect(await partialWrite).toMatchObject({ code: "EPROTO", syscall: "write" });
    expect(serverSide.events).toEqual(EPROTO_CLOSE.events);
  });

  test("Bun.serve closes the connection instead of holding the response forever", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch(req) {
        // repeat: -1 also covers a client that retries on a fresh connection.
        if (req.url.endsWith("/fail"))
          fault.set({ syscall: "ssl_write", action: "errno", errno: "EINVAL", repeat: -1 });
        return new Response("hello");
      },
    });
    // The second request reuses the connection, which no longer polls for writable.
    expect(await (await fetch(server.url, { tls: { ca: certs.cert } })).text()).toBe("hello");
    await expect(fetch(`${server.url}fail`, { tls: { ca: certs.cert } })).rejects.toThrow();
  });

  test("Bun.serve closes the connection when its writable handler issues the failing write", async () => {
    const body = Buffer.alloc(16 * 1024 * 1024, "y");
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response(body),
    });
    const response = await fetch(server.url, { tls: { ca: certs.cert } });
    const reader = response.body!.getReader();
    let received = (await reader.read()).value!.byteLength;
    // The body is far larger than the socket buffers, so the writable handler writes the rest.
    fault.set({ syscall: "ssl_write", action: "errno", errno: "EINVAL", repeat: -1 });
    const outcome = await (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return "ended";
        received += value.byteLength;
      }
    })().catch(() => "errored");
    fault.clear();
    expect({ outcome, truncated: received < body.byteLength }).toEqual({ outcome: "errored", truncated: true });
  });

  test.each([
    ["flowing", false, false],
    ["paused", true, false],
    ["paused, then resumed", true, true],
  ])("Bun.connect: write() returns -1 and the socket closes (%s)", async (_name, paused, resumed) => {
    const closed = Promise.withResolvers<void>();
    const writes: number[] = [];
    const accepted = once(server, "secureConnection");
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { ca: certs.cert },
      socket: {
        async handshake(socket) {
          if (paused) socket.pause();
          // By then the socket no longer polls for writable.
          await accepted;
          fault.set({ syscall: "ssl_write", action: "errno", errno: "EINVAL" });
          writes.push(socket.write("ping"), socket.write("ping"));
          if (resumed) socket.resume();
        },
        data() {},
        close: () => closed.resolve(),
        connectError: (_socket, error) => closed.reject(error),
      },
    });
    await Promise.all([closed.promise, accepted]);
    expect(writes).toEqual([-1, -1]);
  });
});

describe.skipIf(skip)("node:tls close_notify / shutdown under faults", () => {
  test("paused client resumed after the peer's end()+destroySoon() receives every byte", async () => {
    // The peer's data AND its FIN are already queued when the client resumes
    // (kqueue flags EV_EOF on the same readable event), and the paused-mode
    // consumer makes the stream's backpressure pause the socket mid-burst.
    // No byte may be lost, and 'end' must come only after all of them.
    const BIG = 192 * 1024;
    const serverClosed = Promise.withResolvers<void>();
    using p = await connectedTLSPair(s => {
      s.on("close", () => serverClosed.resolve());
      s.end(Buffer.alloc(BIG, "Y"));
      s.destroySoon();
    });
    const client = observe(p.client);
    p.client.pause();
    await serverClosed.promise;
    fault.set({ syscall: "recv", action: "short", bytes: 65536, repeat: -1 });
    let bytes = 0;
    let bytesAtEnd = -1;
    p.client.on("readable", () => {
      let chunk;
      while ((chunk = p.client.read()) !== null) bytes += chunk.length;
    });
    p.client.on("end", () => (bytesAtEnd = bytes));
    p.client.resume();
    await client.closed;
    fault.clear();
    expect({ bytes, bytesAtEnd, events: client.events, errors: client.errors }).toEqual({
      bytes: BIG,
      bytesAtEnd: BIG,
      events: CLEAN_CLOSE,
      errors: [],
    });
  });

  test("destroy() from the write callback does not cut off ciphertext the kernel has yet to take", async () => {
    let received!: () => Buffer;
    let serverSide!: ReturnType<typeof observe>;
    using p = await connectedTLSPair(s => {
      received = collect(s);
      serverSide = observe(s);
    });
    fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1, fd: fdOf(p.client) });
    const payload = Buffer.alloc(256 * 1024, "d");
    p.client.write(payload, () => p.client.destroy());
    await serverSide.closed;
    expect(received().length).toBe(payload.length);
  });

  test("client.end() under 1-byte sends still delivers close_notify and peer sees clean 'end'", async () => {
    let serverSide!: ReturnType<typeof observe>;
    using p = await connectedTLSPair(s => (serverSide = observe(s)));
    const client = observe(p.client);
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    p.client.end();
    await Promise.all([serverSide.closed, client.closed]);
    fault.clear();
    expect({
      server: { events: serverSide.events, errors: serverSide.errors },
      client: { events: client.events, errors: client.errors },
    }).toEqual({
      server: { events: CLEAN_CLOSE, errors: [] },
      client: { events: CLEAN_CLOSE, errors: [] },
    });
  });

  test("server.end() with recv → 0 immediately after (FIN before close_notify drained) reaches 'close'", async () => {
    // Exercises openssl.c on_end (TCP FIN under TLS): close_notify may not
    // have been read yet when the transport reports EOF.
    using p = await connectedTLSPair();
    const client = observe(p.client);
    // The client must consume its readable side for the allowHalfOpen:false
    // teardown to run: with "bye" left unread, Node never emits 'end' and never
    // destroys (stream_base_commons.js defers kMaybeDestroy until 'end').
    const received = collect(p.client);
    fault.set({ syscall: "recv", action: "zero", after: 1, repeat: -1 });
    p.serverSock.end("bye");
    await client.closed;
    fault.clear();
    // close_notify was truncated by the injected EOF, but the data read before
    // it must be delivered and the socket must still reach 'close'.
    expect({
      received: received().toString(),
      events: client.events,
      errors: client.errors,
      destroyed: p.client.destroyed,
    }).toEqual({ received: "bye", events: CLEAN_CLOSE, errors: [], destroyed: true });
  });
});

describe.skipIf(skip)("node:https server under injected syscall faults", () => {
  // Every send() takes at most 16 KB, so the flush of a ciphertext batch
  // (128 KB) is partial: its tail waits in the loop's spill slot while the
  // plaintext already counts as written, and the send buffer is empty before
  // the response is out. The handler takes the end() callback as "response
  // sent" and exits, which is the one thing that discards the spill slot.
  test.concurrent.each([
    ["the batch tail is all that end() leaves behind", 64 * 1024],
    ["the last flush of the send buffer leaves the batch tail", 256 * 1024],
  ])(
    "the end() callback waits for the batch tail in userspace: %s",
    async (_name, size) => {
      const fixture = /* js */ `
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        const options = { key: process.env.KEY, cert: process.env.CERT };
        const server = require("node:https").createServer(options, (req, res) => {
          fault.set({ syscall: "send", action: "short", bytes: 16384, repeat: -1 });
          res.end(Buffer.alloc(${size}, "a"), () => process.exit(0));
        });
        server.listen(0, "127.0.0.1", () => console.log(server.address().port));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, KEY: certs.key, CERT: certs.cert },
        stderr: "inherit",
        stdout: "pipe",
      });
      let portLine = "";
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        portLine += chunk;
        if (portLine.includes("\n")) break;
      }

      const received = Promise.withResolvers<number>();
      let bytes = 0;
      https
        .get({ port: Number(portLine), host: "127.0.0.1", ca: certs.cert, agent: false }, res => {
          res.on("data", chunk => (bytes += chunk.length));
          res.on("close", () => received.resolve(bytes));
        })
        .on("error", () => received.resolve(bytes));
      expect(await received.promise).toBe(size);
      expect(await proc.exited).toBe(0);
    },
    // Only fault-injection (debug/ASAN) builds run this, and there the child took 3.3 to 6.5 s to load node:https and answer.
    30_000,
  );
});

describe.skipIf(skip)("the final handshake flight and the first write leave in one send()", () => {
  // While a connection on the loop holds ciphertext the kernel refused, writes leave record by record. Not the
  // one that a held flight waits for: as a second segment it is https://github.com/oven-sh/bun/issues/40653.
  // The client may send twice, its ClientHello and that flight. A write that needs a send() of its own fails.
  test.concurrent.each([
    ["before the handshake", `socket.write("HELLO");`],
    ["in 'secureConnect'", `socket.on("secureConnect", () => socket.write("HELLO"));`],
  ])("a write %s, beside a stalled TLS socket", async (_name, write) => {
    const received: string[] = [];
    const options = { key: certs.key, cert: certs.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" } as const;
    const peer = tls.createServer(options, socket => {
      socket.on("error", () => {}).once("data", chunk => (received.push(chunk.toString()), socket.end()));
    });
    await once(peer.listen(0, "127.0.0.1"), "listening");
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const { stalledConnection } = require(${JSON.stringify(join(import.meta.dir, "tls-client-close-fixture.mjs"))});
      const tls = require("node:tls");
      (async () => {
        const stalled = await stalledConnection();
        for (let left = 3; left > 0; left--) {
          const events = [];
          const socket = tls.connect({ host: "127.0.0.1", port: ${(peer.address() as AddressInfo).port}, rejectUnauthorized: false });
          // The ClientHello leaves after 'connect'.
          socket.on("connect", () => fault.set({ syscall: "send", action: "errno", errno: "ECONNRESET", fd: socket._handle.fd, after: 2, repeat: -1 }));
          ${write}
          socket.on("error", error => events.push("error:" + error.code));
          socket.on("end", () => events.push("end"));
          await new Promise(resolve => socket.on("close", resolve));
          fault.clear();
          events.push(stalled.socket.writableNeedDrain && !stalled.socket.destroyed ? "stalled" : "not stalled");
          console.log(events.join());
        }
        process.exit(0);
      })();
    `;
    try {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "inherit", stdout: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ client: stdout.trim().split("\n"), received, exitCode }).toEqual({
        client: ["end,stalled", "end,stalled", "end,stalled"],
        received: ["HELLO", "HELLO", "HELLO"],
        exitCode: 0,
      });
    } finally {
      peer.close();
    }
  });
});

describe.skipIf(skip)("node:tls seeded syscall fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x7a1c) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }
  const PLANS = [
    { syscall: "recv", action: "short", bytes: 1 },
    { syscall: "recv", action: "short", bytes: 7 },
    { syscall: "recv", action: "short", bytes: 17 },
    { syscall: "send", action: "short", bytes: 1 },
    { syscall: "send", action: "short", bytes: 11 },
  ] as const;

  test("randomized short-I/O during established echo delivers intact and never crashes", async () => {
    const rand = makePrng(seed);
    for (let i = 0; i < 12; i++) {
      using p = await connectedTLSPair(s => {
        s.on("data", c => s.write(c));
      });
      const client = observe(p.client);
      const echoed = collect(p.client);

      const plan = PLANS[Math.floor(rand() * PLANS.length)]!;
      fault.set({ ...plan, after: Math.floor(rand() * 2), repeat: -1 } as any);

      const payload = Buffer.alloc(128, i & 0xff);
      p.client.write(payload);
      while (echoed().length < payload.length) {
        await once(p.client, "data");
      }
      fault.clear();
      expect(echoed()).toEqual(payload);
      p.client.destroy();
      await client.closed;
      expect({ lastEvent: client.events.at(-1), errors: client.errors, destroyed: p.client.destroyed }).toEqual({
        lastEvent: "close(hadError=false)",
        errors: [],
        destroyed: true,
      });
    }
  });
});

// The loop's shared TLS plaintext buffer is one lazy 512 KiB malloc, and its
// NULL return used to be ignored: SSL_read then wrote to
// `NULL + LIBUS_RECV_BUFFER_PADDING`. Runs in a child because the allocation
// happens once per event loop, on its first TLS socket. No isWindows skip —
// the unchecked allocation is exactly the one that fails there.
//
// Last in the file: the child was started in beforeAll, so by now it has had
// the whole run of in-process tests to finish.
test.skipIf(!fault.available())(
  "a failed per-loop TLS buffer allocation reports out of memory instead of faulting inside SSL_read",
  async () => {
    const { proc, result } = oomChild!;
    const [stdout, stderr, exitCode] = await result;
    // Anything past "ARMED" on stdout means a TLS socket survived the failed
    // allocation and reached its read loop (see the fixture's markers).
    const outOfMemory = stderr.includes("Bun has run out of memory.");
    expect({
      stdout,
      outOfMemory,
      // Only populated when the assertion is about to fail, so the diff shows why.
      stderr: outOfMemory ? "" : stderr,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: "ARMED\n",
      outOfMemory: true,
      stderr: "",
      // The crash handler ends in abort() on POSIX and in ExitProcess(3) on Windows.
      signalCode: isWindows ? null : "SIGABRT",
    });
    expect(exitCode).not.toBe(0);
  },
  // The child has already run alongside the other tests; this is the budget
  // for whatever is left of an ASAN child's startup and crash under CI load.
  15_000,
);
