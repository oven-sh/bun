import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
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

function collect(socket: tls.TLSSocket) {
  const chunks: Buffer[] = [];
  socket.on("data", c => chunks.push(c));
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
    }).toEqual({ authorized: true, authorizationError: null, serverEncrypted: true });
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
    }).toEqual({ stdout: "ARMED\n", outOfMemory: true, stderr: "", signalCode: "SIGABRT" });
    expect(exitCode).not.toBe(0);
  },
  // The child has already run alongside the other tests; this is the budget
  // for whatever is left of an ASAN child's startup and crash under CI load.
  15_000,
);
