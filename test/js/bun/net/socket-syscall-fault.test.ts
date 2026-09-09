import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";

const skip = !fault.available() || isWindows;

// The two TLS fixtures below each run a server in a child Bun process and
// drive raw TLS clients from a grandchild; they print one JSON summary line
// on success (or on a step deadline, with `error` set). `stderrTail` is only
// populated when the fixture did not exit cleanly, so the abort/assertion
// message shows up in the failure diff next to whatever summary it managed to
// print. Only the low-prio fixture needs fault injection; the sibling fixture
// needs just `bun:internal-for-testing`, which `bunEnv` unlocks on every
// build, so it runs on every lane like it did before.
//
// The explicit timeout is required: a bare `bun bd test <file>` applies Bun's
// 5000ms default, and each fixture spawns two Bun processes and takes a few
// seconds on a debug+ASAN build.
async function runFixture(name: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, name)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let summary: unknown = stdout.trim();
  try {
    summary = JSON.parse(stdout.trim().split("\n").pop()!);
  } catch {}
  return {
    summary,
    signalCode: proc.signalCode,
    exitCode,
    stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
  };
}

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
// Per wave of 32 sockets the fixture reports how many closed in the loop
// iteration right after it made all 32 readable at once (`direct`: the
// 5-per-iteration handshake budget) and how many closed in a later iteration
// (`parked`: they sat in the queue and were re-enabled 5 per iteration, so
// the last one closes ceil(27 / 5) + 1 = 7 iterations after the burst). A
// fixture that stopped parking sockets would report direct: 32.
test.concurrent.skipIf(skip)(
  "TLS low-prio queue: a parked socket whose readable poll is re-enabled is not parked twice",
  async () => {
    const wave = { direct: 5, parked: 27, iterations: 7 };
    expect(await runFixture("tls-low-prio-queue-fixture.ts")).toEqual({
      summary: {
        rounds: 2,
        // 2 rounds x (1 primer + 2 waves x 32).
        opened: 130,
        closed: 130,
        // Every wave socket is closed mid-handshake by the unread-ciphertext
        // guard, which reports the handshake as failed; the primers are
        // closed by stop(true) and report nothing.
        handshakeFailed: 128,
        handshakeOk: 0,
        data: 0,
        errors: 0,
        waves: [wave, wave, wave, wave],
      },
      signalCode: null,
      exitCode: 0,
      stderrTail: "",
    });
  },
  60_000,
);

// us_socket_group_close_all_ex walks group->head_sockets during
// server.stop(true), closing each connection. Closing a socket dispatches its
// JS close/handshake handler; if that handler closes a *sibling* connection,
// the walk used to advance onto the freed sibling it had cached as `next` and
// dereference its vtable (`panic: us_socket_t with kind=invalid`, a
// use-after-free). The fixture's handlers close the sibling accepted right
// before the socket being closed, which in the `walk` scenario is exactly the
// walk's next entry, and in the `parked` scenario is one of the N - 5 sockets
// sitting in the low-priority queue while stop(true) drains it.
//
// 64 sockets per scenario; each handler pair removes the socket being closed
// plus two siblings, so 21 steps close 63 sockets and the last one has no
// sibling left: 42 sibling closes. `flightsReceived` is how many of the
// child's sockets received any bytes before the server closed them: none in
// `walk` (every socket is paused), exactly the 5-per-iteration budget in
// `parked`, which proves the other 59 were parked when stop(true) ran.
test.concurrent(
  "TLS server.stop(true): a close handler that closes a sibling does not crash the teardown walk",
  async () => {
    const scenario = (kind: string, flightsReceived: number) => ({
      kind,
      opened: 64,
      closed: 64,
      handshakeFailed: 64,
      handshakeOk: 0,
      data: 0,
      errors: 0,
      siblingCloses: 42,
      flightsReceived,
    });
    expect(await runFixture("tls-close-all-sibling-fixture.ts")).toEqual({
      summary: { scenarios: [scenario("walk", 0), scenario("parked", 5)] },
      signalCode: null,
      exitCode: 0,
      stderrTail: "",
    });
  },
  60_000,
);

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

// A paused socket whose peer hung up is taken out of epoll by the dispatcher
// (EPOLLHUP is level-triggered and cannot be masked) and registered again by
// resume(), which is a fresh EPOLL_CTL_ADD and can fail the way the first one
// can. epoll only: kqueue and libuv never park the fd, so their resume is a
// plain filter/poll change with nothing for the hook to fail. onread mode, because
// like in node only that mode's pause() stops the handle (a plain pause() keeps
// reading into the stream's buffer, which would deliver the reply as data here).
test.concurrent.skipIf(!fault.available() || !isLinux)(
  "resume() of a parked socket that cannot be registered again fails the socket instead of leaving it deaf",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { socketFaultInjection: fault } = require("bun:internal-for-testing");
        const net = require("net");
        const { once } = require("events");
        let resolveClosed;
        const serverClosed = new Promise(r => (resolveClosed = r));
        const server = net.createServer({ allowHalfOpen: true }, s => {
          s.resume();
          s.on("end", () => s.write(Buffer.alloc(64 * 1024, 0x61), () => s.end()));
          s.on("close", resolveClosed);
        });
        server.listen(0, async () => {
          const onread = { buffer: Buffer.alloc(4096), callback: () => console.log("data") };
          const conn = net.connect({ port: server.address().port, allowHalfOpen: true, onread });
          await once(conn, "connect");
          conn.end();
          conn.pause();
          await serverClosed;
          server.close();
          // The peer's FIN reached our fd before its close event reached us, so
          // the next poll phase reports the hangup and parks the socket; an
          // immediate runs after that phase.
          await new Promise(r => setImmediate(r));
          conn.on("error", e => console.log("error", e.code, e.syscall));
          conn.on("end", () => console.log("end"));
          conn.on("close", hadError => console.log("close", hadError));
          fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
          try {
            conn.resume();
          } finally {
            fault.clear();
          }
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: ["error ENOMEM read", "close true"],
      stderr: "",
      exitCode: 0,
    });
  },
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
//
// These run in the test process itself, and the send rule slot is process
// global (one rule per syscall), so they must not overlap each other. They
// are still `concurrent` so they overlap the fixture tests above, which only
// wait on child processes; `serialized` chains them behind one another. The
// time a test spends waiting in that chain counts against its own timeout, so
// each one gets an explicit timeout instead of Bun's 5000ms default.
describe.skipIf(skip)("h2 client under injected unclassified send errno (EPROTOTYPE)", () => {
  const H2_TIMEOUT_MS = 30_000;
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(body: () => Promise<T>): Promise<T> {
    const run = chain.then(body, body);
    chain = run.catch(() => {});
    return run;
  }

  /** Raw TCP server speaking just enough h2: tapes every client frame as
   * "t<type><a if flag 0x1: ACK, or END_STREAM on HEADERS>#<streamId>" and
   * reports them via onFrame. */
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
   * as soon as the session is connected (before the SETTINGS ACK window).
   * Every session and stream lifecycle event is recorded in `events`. */
  async function connectAndJam(repeat: number) {
    const frames: string[] = [];
    const events: string[] = [];
    let onFrame: (f: string) => void = f => frames.push(f);
    const server = rawH2Server(f => onFrame(f));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", e => events.push(`session-error:${(e as any).code ?? e.message}`));
    client.on("close", () => events.push("session-close"));
    client.on("goaway", code => events.push(`session-goaway:${code}`));
    client.on("connect", () => {
      const fd = (client.socket as any)?._handle?.fd ?? -1;
      // Recorded rather than asserted here: a throw inside the listener would
      // not reach the test body, while an unexpected event fails its toEqual.
      if (fd < 0) events.push("connect:no-fd");
      fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE", after: 0, repeat, fd });
    });
    const req = client.request({ ":path": "/" });
    req.on("error", e => events.push(`stream-error:${(e as any).code ?? e.message}`));
    req.on("aborted", () => events.push("stream-aborted"));
    req.on("close", () => events.push(`stream-close:${req.rstCode}`));
    return {
      frames,
      events,
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

  test.concurrent(
    "transient burst (x8) recovers: HEADERS, SETTINGS ACK and PING ACK all reach the server",
    () =>
      serialized(async () => {
        using h = await connectAndJam(8);
        const pingAcked = new Promise<void>((resolve, reject) => {
          h.setOnFrame(f => f === "t6a#0" && resolve());
          h.client.on("close", () => reject(new Error(`session closed before PING ACK; tape: ${h.frames.join(",")}`)));
        });
        await pingAcked;
        // Client SETTINGS, the request HEADERS (END_STREAM: no body), the ACK of
        // the server's SETTINGS, then the PING ACK; nothing else, and no
        // session or stream event.
        expect({ frames: h.frames, events: h.events, destroyed: h.client.destroyed }).toEqual({
          frames: ["t4#0", "t1a#1", "t4a#0", "t6a#0"],
          events: [],
          destroyed: false,
        });
      }),
    H2_TIMEOUT_MS,
  );

  // A fatal-classified errno (EPIPE) latches transport_write_fatal, but the
  // same flush() cycle retries the buffered bytes (_generic_flush after the
  // failed uncork write) and can drain them - kernels return racy one-off
  // send errnos on healthy sockets (macOS EPROTOTYPE->EPIPE class). The
  // deferred close must re-verify instead of killing the recovered session.
  test.concurrent(
    "one-off fatal errno (EPIPE) whose bytes drain in the same flush cycle leaves the session alive",
    () =>
      serialized(async () => {
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
        const events: string[] = [];
        client.on("error", e => events.push(`session-error:${(e as any).code ?? e.message}`));
        client.on("close", () => events.push("session-close"));
        const req = client.request({ ":path": "/" });
        req.on("error", e => events.push(`stream-error:${(e as any).code ?? e.message}`));
        req.on("close", () => events.push(`stream-close:${req.rstCode}`));
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
          // The ACK reached the server, so the transport recovered. The
          // stale-latch deferred close runs from the deferred task queue, once
          // per loop iteration; give it several iterations to (wrongly) fire.
          for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
          expect(events).toEqual([]);
          // Second round-trip proves the session stayed fully alive.
          const acked2 = frameSeen("t6a#0", 2);
          rawSocket!.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 0, 0, 0, 0, 0]), Buffer.alloc(8, 6)]));
          await acked2;
          expect({ frames, events, destroyed: client.destroyed }).toEqual({
            frames: ["t4#0", "t1a#1", "t4a#0", "t6a#0", "t6a#0"],
            events: [],
            destroyed: false,
          });
        } finally {
          fault.clear();
          client.destroy();
          server.close();
        }
      }),
    H2_TIMEOUT_MS,
  );

  test.concurrent(
    "sustained errno (forever) surfaces as session + stream close, not a silent half-alive jam",
    () =>
      serialized(async () => {
        using h = await connectAndJam(-1);
        // No timers: the bounded retry exhausts within a handful of event-loop
        // turns of writable retries, then the transport is torn down. A
        // regression to the silent jam means these events never fire and the
        // test times out. Manual listeners, not events.once(): that helper
        // rejects when 'error' fires first, while here an unexpected 'error'
        // should show up in the recorded event sequence instead.
        await Promise.all([
          new Promise<void>(resolve => h.client.once("close", () => resolve())),
          new Promise<void>(resolve => h.req.once("close", () => resolve())),
        ]);
        // The session wrote its SETTINGS before 'connect' armed the rule, so that
        // is the only frame on the wire. The stream is cancelled (RST_STREAM
        // code 8) and the session destroyed without an 'error' event: the
        // deferred close of a dead transport takes the same path as a peer
        // disconnect.
        expect({ frames: h.frames, events: h.events, destroyed: h.client.destroyed }).toEqual({
          frames: ["t4#0"],
          events: ["stream-close:8", "session-close"],
          destroyed: true,
        });
      }),
    H2_TIMEOUT_MS,
  );
});
