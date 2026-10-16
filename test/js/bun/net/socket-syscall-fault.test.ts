import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isLinux, isMacOS, isWindows, tempDir } from "harness";
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
//
// On macOS the fixtures get a directory for unix sockets, because TCP loopback
// does not deliver inside write() there (see tls-fixture-transport.ts). The
// low-prio fixture does not use it. It needs fault injection, so on macOS only
// a local debug build runs it and no CI lane does: a change of its transport
// could not be checked there.
async function runFixture(name: string) {
  using unixDir = isMacOS ? tempDir("tlsq", {}) : undefined;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, name)],
    env: { ...bunEnv, TLS_FIXTURE_UNIX_DIR: unixDir && String(unixDir) },
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

// us_socket_pause on a socket that is parked in the low-priority handshake
// queue only sets is_paused (parking switched its reads off already), and the
// queue drain used to switch the reads back on without looking at the flag:
// the handshake ran, and `handshake` and `data` reached a socket whose pause()
// had returned. This fixture keeps its clients in its own process, so it needs
// no grandchild. It parks 27 of 32 accepted sockets, pauses all 32, and turns
// the loop until the queue has drained several times over.
// `clientHandshakesWhilePaused` counts the clients that completed their
// handshake in that time: exactly the 5-per-iteration budget, read before the
// pause, which also proves that the other 27 were parked. resume() then brings
// all 32 back.
test.concurrent(
  "TLS low-prio queue: the drain does not resume a socket that was paused while parked",
  async () => {
    expect(await runFixture("tls-pause-parked-handshake-fixture.ts")).toEqual({
      summary: {
        opened: 32,
        whilePaused: { handshake: 0, data: 0 },
        clientHandshakesWhilePaused: 5,
        serverHandshakes: 32,
        serverData: 32,
        pongs: 32,
        errors: 0,
      },
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

// accept() can fail and leave its connection in the listen backlog (EMFILE at
// the descriptor limit). The listener is level-triggered, so it used to be
// reported readable again at once and the loop retried the failing accept()
// with no delay. It now leaves the poll set. A close on the loop, or a 5 ms
// deadline, registers it again.
async function runAcceptFixture(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: any = stdout.trim();
  try {
    result = JSON.parse(result);
  } catch {}
  return { result, signalCode: proc.signalCode, exitCode, stderrTail: exitCode === 0 ? "" : stderr.slice(-2000) };
}

// Two listeners fail in the same window (a descriptor limit is process-wide;
// ENOBUFS stands for it, because it repeats on every platform) and a third
// one has no client. The retries borrow the deadline of the sweep that expires
// idle sockets, and the sweep keeps its own deadline meanwhile: a 1 s timeout
// fires at the first sweep, 4 s after the loop got its first socket, and the
// longer ones do not fire. The explicit timeout is required: the sweep ticks
// every 4 s, and the Bun child takes more than a second to start on a
// debug+ASAN build.
test.concurrent.skipIf(skip)(
  "Bun.listen: two backed-off listeners retry without a spin, idle timeouts keep their 4 s cadence, both accept afterwards",
  async () => {
    using dir = tempDir("accept-backoff", {});
    const { result, ...exit } = await runAcceptFixture([
      bunExe(),
      "-e",
      /* js */ `
        import { socketFaultInjection as fault, getEventLoopStats } from "bun:internal-for-testing";
        import os from "node:os";

        // Event loop iterations for each of 10 timers of 10 ms: about one when
        // idle, a few while a listener is backed off, hundreds when accept()
        // is retried with no delay.
        async function iterationsPerTimer() {
          const before = getEventLoopStats().iteration;
          for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 10));
          return (getEventLoopStats().iteration - before) / 10;
        }
        // Who holds the loop's sweep timer: one for each linked socket, and one
        // for the time that a listener is backed off.
        function sweepState() {
          const { acceptBackoffPending, sweepTimerCount } = getEventLoopStats();
          return { backedOff: acceptBackoffPending, sweepTimerCount };
        }

        const unixPath = ${JSON.stringify(join(String(dir), "listen.sock"))};
        const accepted = { tcp: 0, unix: 0, spare: 0 };
        const closed = { tcp: 0, unix: 0, spare: 0 };
        const opened = { tcp: Promise.withResolvers(), unix: Promise.withResolvers() };
        const handlers = name => ({
          socket: {
            open() {
              accepted[name]++;
              opened[name]?.resolve();
            },
            close() {
              closed[name]++;
            },
            data() {},
          },
        });
        const tcp = Bun.listen({ hostname: "127.0.0.1", port: 0, ...handlers("tcp") });
        const unix = Bun.listen({ unix: unixPath, ...handlers("unix") });
        // No client connects to this one while accept() fails: it stays in the poll set.
        const spare = Bun.listen({ hostname: "127.0.0.1", port: 0, ...handlers("spare") });

        const fired = { oneSecond: Promise.withResolvers(), eightSeconds: false, sixtySeconds: false };
        const idleSocket = async (seconds, timeout) => {
          const socket = await Bun.connect({ hostname: "127.0.0.1", port: spare.port, socket: { data() {}, timeout } });
          socket.timeout(seconds);
          return socket;
        };
        const start = performance.now();
        const sockets = [
          await idleSocket(1, () => fired.oneSecond.resolve(performance.now() - start)),
          await idleSocket(8, () => (fired.eightSeconds = true)),
          await idleSocket(60, () => (fired.sixtySeconds = true)),
        ];
        const idle = await iterationsPerTimer();
        const before = sweepState();

        fault.set({ syscall: "accept", action: "errno", errno: os.constants.errno.ENOBUFS, repeat: -1 });
        // Each connect resolves when the kernel queued the connection: accept() did not take it.
        sockets.push(await Bun.connect({ hostname: "127.0.0.1", port: tcp.port, socket: { data() {} } }));
        sockets.push(await Bun.connect({ unix: unixPath, socket: { data() {} } }));
        const failing = await iterationsPerTimer();
        // A retry puts the listeners back into the poll set for one iteration:
        // wait for an iteration that is not that one.
        for (let i = 0; i < 1000 && !getEventLoopStats().acceptBackoffPending; i++) {
          await new Promise(resolve => setImmediate(resolve));
        }
        const during = sweepState();
        const firedAfterMs = await fired.oneSecond.promise;
        const { eightSeconds, sixtySeconds } = fired;

        // Each close on the loop gives one backed-off listener a retry, in
        // turn. accept() still fails, so the listener backs off again.
        const turn = () => new Promise(resolve => setImmediate(resolve));
        const turns = [];
        for (const socket of sockets.slice(0, 3)) {
          socket.terminate();
          for (let i = 0; i < 20; i++) {
            await turn();
            const { acceptBackoffTurn } = getEventLoopStats();
            if (turns.at(-1) !== acceptBackoffTurn) turns.push(acceptBackoffTurn);
          }
        }
        for (let i = 0; i < 5000 && closed.spare < 3; i++) await turn();
        const acceptedWhileFailing = accepted.tcp + accepted.unix;

        fault.clear();
        await Promise.all([opened.tcp.promise, opened.unix.promise]);
        console.log(
          JSON.stringify({
            idle,
            failing,
            before,
            during,
            after: sweepState(),
            oneSecondNotEarly: firedAfterMs >= 2000,
            eightSeconds,
            sixtySeconds,
            turns,
            acceptedWhileFailing,
            accepted,
          }),
        );
        for (const socket of sockets.slice(3)) socket.terminate();
        for (const listener of [tcp, unix, spare]) listener.stop(true);
      `,
    ]);
    const { idle, failing, before, during, after, turns, ...rest } = result ?? {};
    expect({
      rates: { idle, failing },
      backsOff: failing <= idle + 8,
      // Two client sockets, and one holder for the episode.
      during: { backedOff: during?.backedOff, holders: during?.sweepTimerCount - before?.sweepTimerCount },
      // The three idle sockets and their peers are gone. Two client sockets
      // and the two sockets that the listeners accepted are new.
      after: { backedOff: after?.backedOff, holders: after?.sweepTimerCount - before?.sweepTimerCount },
      turns,
      // The positions of the two backed-off listeners, one after the other (0: no turn yet).
      takesTurns: new Set(turns?.filter((position: number) => position !== 0)).size === 2,
      ...rest,
      ...exit,
    }).toEqual({
      rates: expect.anything(),
      backsOff: true,
      during: { backedOff: true, holders: 3 },
      after: { backedOff: false, holders: -2 },
      turns: expect.anything(),
      takesTurns: true,
      oneSecondNotEarly: true,
      eightSeconds: false,
      sixtySeconds: false,
      acceptedWhileFailing: 0,
      accepted: { tcp: 1, unix: 1, spare: 3 },
      signalCode: null,
      exitCode: 0,
      stderrTail: "",
    });
  },
  30_000,
);

// No injector, so it runs on every Linux build. A is accepted, the process
// runs out of descriptors, B waits in the backlog, and the listener backs off.
// Then the server closes A. The loop closed that descriptor itself, so B gets
// its turn at once and not at the 5 ms deadline: with setImmediate keeping the
// loop busy, the deadline is many iterations away. Not for macOS: there the
// kernel drops B when accept() cannot get a descriptor.
test.concurrent.skipIf(!isLinux && !isFreeBSD)(
  "Bun.listen at the descriptor limit: a close on the loop gives the queued client its turn at once",
  async () => {
    const { result, ...exit } = await runAcceptFixture([
      "/bin/sh",
      "-c",
      `ulimit -n 256 && exec "$1" --no-install -e "$2"`,
      "sh",
      bunExe(),
      /* js */ `
        import { getEventLoopStats } from "bun:internal-for-testing";
        import { closeSync, openSync } from "node:fs";

        let opened = Promise.withResolvers();
        let openedAt = 0;
        const listener = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(socket) {
              openedAt = getEventLoopStats().iteration;
              opened.resolve(socket);
            },
            data() {},
          },
        });
        const connect = () => Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { data() {} } });
        const turn = () => new Promise(resolve => setImmediate(resolve));
        let busy = true;
        (function spin() {
          if (busy) setImmediate(spin);
        })();

        const iterationsToAccept = [];
        for (let round = 0; round < 12; round++) {
          opened = Promise.withResolvers();
          const clientA = await connect();
          const serverA = await opened.promise;
          opened = Promise.withResolvers();
          const held = [];
          for (;;) {
            try {
              held.push(openSync("/dev/null", "r"));
            } catch (e) {
              if (e.code !== "EMFILE") throw e;
              break;
            }
          }
          // B's own socket takes the one descriptor that is free.
          closeSync(held.pop());
          const clientB = await connect();
          for (let i = 0; !getEventLoopStats().acceptBackoffPending; i++) {
            if (i === 5000) throw new Error("the listener did not back off");
            await turn();
          }
          // A different phase of the retry deadline in each round.
          for (let i = 0; i < round * 4; i++) await turn();
          const closedAt = getEventLoopStats().iteration;
          serverA.terminate();
          const serverB = await opened.promise;
          iterationsToAccept.push(openedAt - closedAt);
          for (const fd of held) closeSync(fd);
          for (const socket of [clientA, clientB, serverB]) socket.terminate();
        }
        busy = false;
        console.log(JSON.stringify({ iterationsToAccept }));
        listener.stop(true);
      `,
    ]);
    expect({
      iterationsToAccept: result?.iterationsToAccept,
      atOnce: result?.iterationsToAccept?.length === 12 && result.iterationsToAccept.every((n: number) => n <= 8),
      ...exit,
    }).toEqual({ iterationsToAccept: expect.anything(), atOnce: true, signalCode: null, exitCode: 0, stderrTail: "" });
  },
);

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
      socket.on("data", (d: Buffer) => {
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
      fault.set({ syscall: "send", action: "errno", errno: "EPROTOTYPE" as any, after: 0, repeat, fd });
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
