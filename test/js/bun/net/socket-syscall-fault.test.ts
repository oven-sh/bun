import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import nodeTls from "node:tls";

const skip = !fault.available() || isWindows;

// us_poll_start_rc wraps uv_poll_init_socket on Windows and EPOLL_CTL_ADD /
// kevent on posix. On Windows the return value was ignored, so an ioctlsocket
// FIONBIO failure left a never-initialized uv_poll_t that uv_unref/uv_poll_start
// then operated on (assertion failure at libuv win/poll.c:508 in debug,
// undefined behaviour in release). The fd is always fresh from the kernel at
// that point, so the failure path is unreachable without injection; each case
// runs in a subprocess so a crash surfaces as a non-zero exit rather than
// taking the test runner down.
describe.skipIf(!fault.available())("poll_start failure is reported, not a crash", () => {
  // WSAENOTSOCK is what ioctlsocket(FIONBIO) on a bad handle yields. ENOMEM is
  // one of the documented EPOLL_CTL_ADD failure modes.
  const errno = isWindows ? 10038 : "ENOMEM";
  const arm = `fault.set({ syscall: "poll_start", action: "errno", errno: ${JSON.stringify(errno)}, repeat: 1 })`;

  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { socketFaultInjection: fault } = require("bun:internal-for-testing");
         try { ${body} } finally { fault.clear(); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.trim(),
      signalCode: proc.signalCode,
      exitCode,
      stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
    }).toEqual({ stdout: "OK", signalCode: null, exitCode: 0, stderrTail: "" });
  }

  test.concurrent("Bun.listen", () =>
    run(`
      ${arm};
      let err;
      try {
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
        server.stop(true);
      } catch (e) { err = e; }
      if (!(err instanceof Error)) throw new Error("expected Bun.listen to throw, got: " + err);
      // A second listen after the one-shot fault disarms must succeed, proving
      // the failed attempt didn't corrupt loop state.
      const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      server.stop(true);
      console.log("OK");
    `),
  );

  test.concurrent("Bun.udpSocket", () =>
    run(`
      ${arm};
      let err;
      try {
        const s = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
        s.close();
      } catch (e) { err = e; }
      if (!(err instanceof Error)) throw new Error("expected Bun.udpSocket to reject, got: " + err);
      const s = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
      s.close();
      console.log("OK");
    `),
  );

  test.concurrent("Bun.connect", () =>
    run(`
      const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {}, close() {} } });
      try {
        ${arm};
        let err;
        try {
          const s = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } });
          s.end();
        } catch (e) { err = e; }
        if (!(err instanceof Error)) throw new Error("expected Bun.connect to reject, got: " + err);
        const s = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, open(s) { s.end(); } } });
        s.end();
        console.log("OK");
      } finally {
        server.stop(true);
      }
    `),
  );
});

// uSockets' TLS low-priority handshake queue (loop->data.low_prio_head)
// shares its prev/next links with group->head_sockets. A socket already
// parked in the queue used to be parked a SECOND time whenever a writable
// dispatch re-enabled its readable poll bit (a backpressured handshake
// flight retry does that), running us_internal_socket_group_unlink_socket on
// low-prio-queue links and cross-wiring the two lists. In debug/ASAN builds
// the double-incremented low_prio_count trips the group-deinit assertion; in
// release builds freed sockets stay reachable from both lists
// (heap-use-after-free in us_internal_socket_group_unlink_socket /
// us_internal_handle_low_priority_sockets).
//
// The explicit timeout is required: a bare `bun bd test <file>` applies Bun's
// 5000ms default, and this fixture spawns two Bun processes and has to hold
// 32 concurrent TLS handshakes across several event-loop ticks, which takes
// ~25s on a debug+ASAN build. 180s keeps comfortable headroom over the
// CI runner's ASAN per-test budget instead of capping below it.
test.skipIf(skip)(
  "TLS low-prio queue: a parked socket whose readable poll is re-enabled is not parked twice",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-low-prio-queue-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `stderrTail` is only populated when the fixture did not exit cleanly, so
    // the abort/assertion message shows up in the failure diff.
    expect({
      stdout: stdout.trim(),
      signalCode: proc.signalCode,
      exitCode,
      stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
    }).toEqual({ stdout: "OK", signalCode: null, exitCode: 0, stderrTail: "" });
  },
  180_000,
);

// An injected send() errno that is neither would-block/transient
// (EAGAIN/ENOBUFS/ENOMEM) nor a known peer-gone error (EPIPE/ECONNRESET/...)
// exercises the bounded unclassified-errno retry in
// us_socket_write_check_error. EPROTOTYPE is the canonical member of that
// class: macOS returns it racily from send() on healthy sockets. The
// contract, observed broken in darwin CI wire tapes before the fix (h2
// client writes the connection preface, then never writes again - no
// SETTINGS ACK, no error, no close):
//   - a transient burst must recover through the writable rearm/retry
//     machinery with no observable hiccup, and
//   - a sustained errno must surface as session teardown, never a silent
//     half-alive jam with the bytes parked forever.
describe.skipIf(skip)("h2 client under injected unclassified send errno (EPROTOTYPE)", () => {
  afterEach(() => fault.clear());

  /** Raw TCP server speaking just enough h2: tapes every client frame as
   * "t<type><a if ACK flag>#<streamId>" and reports them via onFrame. */
  function rawH2Server(
    onFrame: (frame: string) => void,
    opts: { sendPing?: boolean; onSocket?: (socket: net.Socket) => void } = {},
  ) {
    const { sendPing = true, onSocket } = opts;
    return net.createServer(socket => {
      socket.on("error", () => {});
      let buf = Buffer.alloc(0);
      let sawPreface = false;
      socket.on("data", d => {
        buf = Buffer.concat([buf, d]);
        if (!sawPreface && buf.length >= 24) {
          buf = buf.subarray(24);
          sawPreface = true;
        }
        while (sawPreface && buf.length >= 9) {
          const len = buf.readUIntBE(0, 3);
          if (buf.length < 9 + len) break;
          const ack = buf.readUInt8(4) & 1 ? "a" : "";
          onFrame(`t${buf.readUInt8(3)}${ack}#${buf.readUInt32BE(5) & 0x7fffffff}`);
          buf = buf.subarray(9 + len);
        }
      });
      // Server SETTINGS + ACK of the client's SETTINGS, then (by default) a
      // PING the client must ACK - the ACK proves the client write path is
      // alive end-to-end after the injected failures.
      socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
      socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
      if (sendPing) {
        socket.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0]), Buffer.alloc(8, 3)]));
      }
      onSocket?.(socket);
    });
  }

  /** Connects an http2 client and arms the send-errno rule on its socket fd
   * as soon as the session is connected (before the SETTINGS ACK window). */
  async function connectAndJam(repeat: number) {
    const frames: string[] = [];
    let onFrame: (f: string) => void = f => frames.push(f);
    const server = rawH2Server(f => onFrame(f));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", () => {});
    client.on("connect", () => {
      const fd = (client.socket as any)?._handle?.fd ?? -1;
      expect(fd).toBeGreaterThanOrEqual(0);
      fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", after: 0, repeat, fd });
    });
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    return {
      frames,
      setOnFrame(f: (frame: string) => void) {
        onFrame = frame => {
          frames.push(frame);
          f(frame);
        };
      },
      client,
      req,
      server,
      [Symbol.dispose]() {
        fault.clear();
        client.destroy();
        server.close();
      },
    };
  }

  test("transient burst (x8) recovers: HEADERS, SETTINGS ACK and PING ACK all reach the server", async () => {
    using h = await connectAndJam(8);
    const pingAcked = new Promise<void>((resolve, reject) => {
      h.setOnFrame(f => f === "t6a#0" && resolve());
      h.client.on("close", () => reject(new Error(`session closed before PING ACK; tape: ${h.frames.join(",")}`)));
    });
    await pingAcked;
    // type 1 = HEADERS (the request), t4a = client's SETTINGS ACK.
    expect(h.frames.some(f => f.startsWith("t1"))).toBe(true);
    expect(h.frames).toContain("t4a#0");
  });

  // A fatal-classified errno (EPIPE) latches transport_write_fatal, but the
  // same flush() cycle retries the buffered bytes (_generic_flush after the
  // failed uncork write) and can drain them - kernels return racy one-off
  // send errnos on healthy sockets (macOS EPROTOTYPE->EPIPE class). The
  // deferred close must re-verify instead of killing the recovered session.
  test("one-off fatal errno (EPIPE) whose bytes drain in the same flush cycle leaves the session alive", async () => {
    const frames: string[] = [];
    const waiters: Array<{ want: string; count: number; resolve: () => void }> = [];
    const seen = (want: string) => frames.filter(f => f === want).length;
    function frameSeen(want: string, count = 1) {
      return new Promise<void>(resolve => {
        if (seen(want) >= count) return resolve();
        waiters.push({ want, count, resolve });
      });
    }
    let rawSocket: net.Socket | undefined;
    const server = rawH2Server(
      f => {
        frames.push(f);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (seen(waiters[i].want) >= waiters[i].count) waiters.splice(i, 1)[0].resolve();
        }
      },
      { sendPing: false, onSocket: s => (rawSocket = s) },
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    let terminal: string | null = null;
    client.on("error", e => (terminal ??= `session-error:${(e as any).code ?? (e as Error).message}`));
    client.on("close", () => (terminal ??= "session-close"));
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    try {
      // The client's SETTINGS ACK on the wire means its write path is idle:
      // the next client send is the PING ACK triggered below.
      await frameSeen("t4a#0");
      const fd = (client.socket as any)?._handle?.fd ?? -1;
      expect(fd).toBeGreaterThanOrEqual(0);
      fault.set({ syscall: "send", action: "errno", errno: "EPIPE", after: 0, repeat: 1, fd });
      const acked = frameSeen("t6a#0");
      rawSocket!.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0]), Buffer.alloc(8, 5)]));
      await acked;
      // The ACK reached the server, so the transport recovered. Bounded window
      // for the stale-latch deferred close to fire (it runs from the deferred
      // task queue within a few macrotask turns).
      for (let i = 0; i < 20 && terminal === null; i++) {
        await new Promise(r => setTimeout(r, 10));
      }
      expect(terminal).toBeNull();
      // Second round-trip proves the session stayed fully alive.
      const acked2 = frameSeen("t6a#0", 2);
      rawSocket!.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0]), Buffer.alloc(8, 6)]));
      await acked2;
      expect({ terminal, destroyed: client.destroyed }).toEqual({ terminal: null, destroyed: false });
    } finally {
      fault.clear();
      client.destroy();
      server.close();
    }
  });

  test("sustained errno (forever) surfaces as session + stream close, not a silent half-alive jam", async () => {
    using h = await connectAndJam(-1);
    // No timers: the bounded retry exhausts within a handful of event-loop
    // turns of writable retries, then the transport is torn down. A
    // regression to the silent jam means these events never fire and the
    // test times out. Manual listeners, not events.once(): that helper
    // rejects when 'error' fires first, and an 'error' preceding 'close' is
    // an acceptable teardown ordering here.
    await Promise.all([
      new Promise<void>(resolve => h.client.once("close", () => resolve())),
      new Promise<void>(resolve => h.req.once("close", () => resolve())),
    ]);
    expect(h.client.closed || h.client.destroyed).toBe(true);
  });
});

// The TLS write path routes ciphertext through us_socket_raw_write (via
// ssl_flush_write_batch / ssl_drain_spill), which had no errno classification:
// any send() -1 set last_write_failed and re-armed the writable poll. A
// persistent non-EAGAIN errno (macOS content filter, a racy EPROTOTYPE that
// never resolved, a peer-gone errno on a socket the kernel still reports
// writable) therefore looped the writable dispatch at full speed - observed as
// 100% CPU in us_internal_ssl_on_writable -> __sendto on idle long-lived
// processes holding a TLS keepalive. The tests assert the two halves of the
// fix: a peer-gone errno closes immediately, and an unclassified errno closes
// after the bounded retry window instead of burning through the fault budget.
describe.skipIf(skip)("TLS client under injected fatal send errno (us_socket_raw_write path)", () => {
  afterEach(() => fault.clear());

  async function tlsPair() {
    let serverReceived = 0;
    const server = nodeTls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, s => {
      s.on("error", () => {});
      s.on("data", d => (serverReceived += d.length));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const sock = nodeTls.connect({
      port: (server.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    sock.on("error", () => {});
    await once(sock, "secureConnect");
    const fd = (sock as any)._handle?.fd ?? -1;
    expect(fd).toBeGreaterThanOrEqual(0);

    return {
      sock,
      fd,
      serverReceived: () => serverReceived,
      [Symbol.dispose]() {
        fault.clear();
        sock.destroy();
        server.close();
      },
    };
  }

  test("sustained EPIPE closes the TLS socket instead of spinning the writable dispatch", async () => {
    using pair = await tlsPair();
    fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: -1, fd: pair.fd });

    let errorCode: string | undefined;
    pair.sock.on("error", (e: NodeJS.ErrnoException) => (errorCode = e.code ?? e.message));
    // Not events.once(): that rejects on 'error', and error-before-close is
    // the expected teardown ordering here.
    const closed = new Promise<void>(r => pair.sock.once("close", () => r()));
    pair.sock.write(Buffer.alloc(100, 0x78));

    // On main the socket never closed: the spill path re-armed writable every
    // tick and the test timed out. With the fix, the first writable dispatch
    // after the spill latches a pending close and the socket closes with the
    // send errno.
    await closed;
    expect({
      closed: (pair.sock as any).destroyed,
      errorCode,
      serverReceived: pair.serverReceived(),
    }).toEqual({ closed: true, errorCode: "EPIPE", serverReceived: 0 });
  });

  test("unclassified errno is retried through the bounded window then closes", async () => {
    using pair = await tlsPair();
    // Budget well above the retry ceiling (32) so a regression to the unbounded
    // re-arm drains the rule and delivers the bytes instead of closing.
    fault.set({ syscall: "send", action: "errno", errno: "EINVAL", repeat: 200, fd: pair.fd });
    const closed = new Promise<void>(r => pair.sock.once("close", () => r()));
    pair.sock.write(Buffer.alloc(100, 0x78));

    await closed;
    expect({
      closed: (pair.sock as any).destroyed,
      serverReceived: pair.serverReceived(),
    }).toEqual({ closed: true, serverReceived: 0 });
  });

  test("sporadic unclassified errnos that recover do not accumulate into a lifetime close", async () => {
    using pair = await tlsPair();
    // 50 rounds of [one EPROTOTYPE, then a real send that drains the spill].
    // A successful send must reset unclassified_send_failures, so the counter
    // never reaches the 32-cap and the socket stays open throughout. If the
    // reset is missing, round 33's errno latches a pending close and the
    // socket closes with EPROTOTYPE instead.
    let sawClose = false;
    pair.sock.on("close", () => (sawClose = true));
    for (let i = 0; i < 50; i++) {
      fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", repeat: 1, fd: pair.fd });
      pair.sock.write(Buffer.alloc(8, 0x61 + (i % 26)));
      // wait until the server has received this round's bytes (spill drained
      // after the one-off errno), so each round is: errno -> full success.
      while (pair.serverReceived() < 8 * (i + 1) && !sawClose) {
        await new Promise(r => setImmediate(r));
      }
      if (sawClose) break;
    }
    expect({ sawClose, serverReceived: pair.serverReceived() }).toEqual({
      sawClose: false,
      serverReceived: 400,
    });
  });
});
