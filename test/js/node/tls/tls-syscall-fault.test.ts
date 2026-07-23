import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import { once } from "node:events";
import { join } from "node:path";
import tls from "node:tls";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// The loop's shared TLS plaintext buffer is one lazy 512 KiB malloc, and its
// NULL return used to be ignored: SSL_read then wrote to
// `NULL + LIBUS_RECV_BUFFER_PADDING`. Runs in a child because the allocation
// happens once per event loop, on its first TLS socket. No isWindows skip —
// the unchecked allocation is exactly the one that fails there.
//
// Every marker the fixture can print. A crashing debug build symbolizes its
// backtrace onto stdout, so match the fixture's lines rather than the whole
// stream; anything past "ARMED" means a TLS socket survived the failed
// allocation and reached its read loop.
const OOM_FIXTURE_MARKERS = ["ARMED", "READ DATA", "CLOSED", "CLIENT ERROR"];
test.skipIf(!fault.available())(
  "a failed per-loop TLS buffer allocation reports out of memory instead of faulting inside SSL_read",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-loop-buffer-oom-fixture.ts")],
      // BUN_CRASH_REPORT_URL="": this OOM is deliberate; uploading it to CI's
      // remap server would pin a spurious "crash reported" error on the next
      // unrelated failing test.
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `CrashReason::OutOfMemory` phrasing varies with SHOW_CRASH_TRACE, so
    // match the shared substring (see run-crash-handler.test.ts).
    const outOfMemory = stderr.toLowerCase().includes("out of memory");
    expect({
      markers: stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => OOM_FIXTURE_MARKERS.includes(line)),
      outOfMemory,
      // Only populated when the assertion is about to fail, so the diff shows why.
      stderrTail: outOfMemory ? "" : stderr.slice(-2000),
    }).toEqual({ markers: ["ARMED"], outOfMemory: true, stderrTail: "" });
  },
  // Symbolizing the crash backtrace of a debug/ASAN binary takes several
  // seconds on its own, well past the default per-test budget.
  60_000,
);

async function connectedTLSPair(onServerSocket?: (s: tls.TLSSocket) => void) {
  const server = tls.createServer({ key: certs.key, cert: certs.cert });
  server.on("secureConnection", s => {
    s.on("error", () => {});
    onServerSocket?.(s);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;

  // Register the server-side listener before initiating connect so the
  // 'secureConnection' event cannot be missed.
  const serverSockP = once(server, "secureConnection") as Promise<[tls.TLSSocket]>;
  const client = tls.connect({ port, host: "127.0.0.1", ca: certs.cert, rejectUnauthorized: true });
  const [, [serverSock]] = await Promise.all([once(client, "secureConnect"), serverSockP]);

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

describe.skipIf(skip)("node:tls under injected syscall faults", () => {
  test("recv → ECONNRESET during established session surfaces as 'error'", async () => {
    using p = await connectedTLSPair();
    fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
    const errP = once(p.client, "error");
    p.serverSock.write("hello");
    const [err] = (await errP) as [NodeJS.ErrnoException];
    // BoringSSL may map a transport reset to ECONNRESET or to an SSL read error;
    // either is acceptable, but the socket must be destroyed and not hang.
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(p.client.destroyed).toBe(true);
  });

  test("recv → short reads (1 byte) still decrypt complete payload", async () => {
    using p = await connectedTLSPair();
    // The TLS record layer must reassemble across many tiny BIO reads.
    fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    const chunks: Buffer[] = [];
    p.client.on("data", c => chunks.push(c));
    const payload = Buffer.alloc(512, "Z");
    p.serverSock.write(payload);
    p.serverSock.end();
    await once(p.client, "end");
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  test("send → short writes (1 byte) still deliver complete encrypted payload", async () => {
    let received = Buffer.alloc(0);
    using p = await connectedTLSPair(s => {
      s.on("data", c => (received = Buffer.concat([received, c])));
    });
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    const payload = Buffer.alloc(512, "Y");
    p.client.write(payload);
    p.client.end();
    await once(p.serverSock, "end");
    fault.clear();
    expect(received.equals(payload)).toBe(true);
  });

  test("recv → 0 (peer closed) on established session emits 'end' without 'error'", async () => {
    using p = await connectedTLSPair();
    let gotError: unknown = null;
    p.client.on("error", e => (gotError = e));
    fault.set({ syscall: "recv", action: "zero", repeat: -1 });
    const endP = once(p.client, "end");
    p.serverSock.write("hello");
    await endP;
    expect(gotError).toBeNull();
  });

  test("send → short writes during handshake still complete secureConnect", async () => {
    const server = tls.createServer({ key: certs.key, cert: certs.cert });
    server.on("secureConnection", s => s.on("error", () => {}));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      // Clamp every send to 3 bytes — the ClientHello/ServerHello/Finished
      // flights are split across hundreds of partial writes.
      fault.set({ syscall: "send", action: "short", bytes: 3, repeat: -1 });
      const serverSockP = once(server, "secureConnection") as Promise<[tls.TLSSocket]>;
      const client = tls.connect({ port, host: "127.0.0.1", ca: certs.cert });
      const [, [serverSock]] = await Promise.all([once(client, "secureConnect"), serverSockP]);
      expect(client.authorized).toBe(true);
      client.destroy();
      serverSock.destroy();
    } finally {
      fault.clear();
      server.close();
    }
  });

  test("recv → short reads at TLS record boundary (5 bytes = header only) still decrypt", async () => {
    using p = await connectedTLSPair();
    // 5 bytes is exactly the TLS record header — forces the BIO to assemble
    // header and ciphertext across separate recv calls.
    fault.set({ syscall: "recv", action: "short", bytes: 5, repeat: -1 });
    const chunks: Buffer[] = [];
    p.client.on("data", c => chunks.push(c));
    const payload = Buffer.alloc(256, "R");
    p.serverSock.write(payload);
    p.serverSock.end();
    await once(p.client, "end");
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  test("recv → ECONNRESET mid-handshake fails connect with an error (no hang)", async () => {
    const server = tls.createServer({ key: certs.key, cert: certs.cert }, s => s.on("error", () => {}));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      // Reset the very first wire read of the ServerHello.
      fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
      const client = tls.connect({ port, host: "127.0.0.1", ca: certs.cert });
      const [err] = (await once(client, "error")) as [Error];
      expect(err).toBeTruthy();
      client.destroy();
    } finally {
      fault.clear();
      server.close();
    }
  });
});

describe.skipIf(skip)("node:tls close_notify / shutdown under faults", () => {
  test("paused client resumed after the peer's end()+destroySoon() receives every byte", async () => {
    // The peer's data AND its FIN are already queued when the client resumes
    // (kqueue flags EV_EOF on the same readable event), and the paused-mode
    // consumer makes the stream's backpressure pause the socket mid-burst.
    // No byte may be lost, and 'end' must come only after all of them.
    const BIG = 192 * 1024;
    const server = tls.createServer({ key: certs.key, cert: certs.cert });
    const serverClosed = Promise.withResolvers<void>();
    server.on("secureConnection", s => {
      s.on("error", () => {});
      s.on("close", () => serverClosed.resolve());
      s.end(Buffer.alloc(BIG, "Y"));
      s.destroySoon();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = tls.connect({ port, host: "127.0.0.1", ca: certs.cert, rejectUnauthorized: true });
    client.on("error", () => {});
    try {
      await once(client, "secureConnect");
      client.pause();
      await serverClosed.promise;
      fault.set({ syscall: "recv", action: "short", bytes: 65536, repeat: -1 });
      let bytes = 0;
      client.on("readable", () => {
        let chunk;
        while ((chunk = client.read()) !== null) bytes += chunk.length;
      });
      const ended = once(client, "end");
      client.resume();
      await ended;
      fault.clear();
      expect(bytes).toBe(BIG);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("client.end() under 1-byte sends still delivers close_notify and peer sees clean 'end'", async () => {
    using p = await connectedTLSPair();
    let serverGotEnd = false;
    p.serverSock.on("end", () => (serverGotEnd = true));
    fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
    p.client.end();
    await once(p.serverSock, "close");
    fault.clear();
    expect(serverGotEnd).toBe(true);
  });

  test("server.end() with recv → 0 immediately after (FIN before close_notify drained) reaches 'close'", async () => {
    // Exercises openssl.c on_end (TCP FIN under TLS): close_notify may not
    // have been read yet when the transport reports EOF.
    using p = await connectedTLSPair();
    p.client.on("error", () => {});
    // The client must consume its readable side for the allowHalfOpen:false
    // teardown to run: with "bye" left unread, Node never emits 'end' and never
    // destroys (stream_base_commons.js defers kMaybeDestroy until 'end').
    p.client.resume();
    fault.set({ syscall: "recv", action: "zero", after: 1, repeat: -1 });
    p.serverSock.end("bye");
    await once(p.client, "close");
    fault.clear();
    // close_notify was truncated by the injected EOF, but the socket must
    // still reach 'close' without hanging.
    expect(p.client.destroyed).toBe(true);
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
      let echoed = Buffer.alloc(0);
      using p = await connectedTLSPair(s => {
        s.on("data", c => s.write(c));
      });
      p.client.on("error", () => {});
      p.client.on("data", c => (echoed = Buffer.concat([echoed, c])));

      const plan = PLANS[Math.floor(rand() * PLANS.length)]!;
      fault.set({ ...plan, after: Math.floor(rand() * 2), repeat: -1 } as any);

      const payload = Buffer.alloc(128, i & 0xff);
      p.client.write(payload);
      while (echoed.length < payload.length) {
        await once(p.client, "data");
      }
      fault.clear();
      expect(echoed.subarray(0, payload.length).equals(payload)).toBe(true);
      p.client.destroy();
      await once(p.client, "close").catch(() => {});
      expect(p.client.destroyed).toBe(true);
    }
  });
});
