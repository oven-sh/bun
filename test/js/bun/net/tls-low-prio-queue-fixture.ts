// Regression fixture for the TLS low-priority handshake queue.
//
// uSockets throttles concurrent TLS handshakes: when the per-iteration budget
// (5) is exhausted, the readable dispatch PARKS the socket in the loop-wide
// low-priority queue (loop->data.low_prio_head), unlinking it from
// group->head_sockets (the two lists share the prev/next fields) and
// disabling READABLE on its poll. Every later loop iteration re-enables 5
// parked sockets.
//
// A parked socket can still get a WRITABLE dispatch. If its handshake flight
// is backpressured, us_internal_ssl_on_writable retries the BIO write, and
// us_socket_raw_write re-issues us_poll_change(READABLE|WRITABLE); readable
// is now back on a socket that is still in the low-prio queue. The next
// readable dispatch with an exhausted budget used to park it a SECOND time:
// us_internal_socket_group_unlink_socket(g, s) ran on a socket whose
// prev/next are low-prio-queue links, cross-wiring group->head_sockets with
// loop->data.low_prio_head (heap-use-after-free once either list walks
// through a freed entry) and double-incrementing group->low_prio_count
// (aborting at the `low_prio_count == 0` group-deinit assertion in
// debug/ASAN builds when the Listener is finalized).
//
// This fixture is the server: it arms a process-wide `send -> 0` fault so
// every handshake flight is permanently backpressured, and drives N raw TLS
// clients from a CHILD process (the fault is process-global, and the clients'
// ClientHello delivery must not be affected). Server and child talk over the
// child's stdio, one line per step, so no step waits for a timer.
//
// One wave:
//   1. The child connects N sockets. The server pauses each accepted socket in
//      `open`, so the ClientHellos the child then writes stay unread in the
//      kernel buffers. The child reports `hellos` once every write callback
//      has fired.
//   2. The server resumes all N at once: N readables land in one loop
//      iteration, the budget processes 5 ClientHellos (flight -> send() -> 0
//      -> WANT_WRITE) and parks the rest at the ClientHello stage. Each later
//      iteration re-enables 5 more, so after ceil(N / 5) + 1 iterations every
//      socket has a backpressured flight. The server counts iterations
//      (getEventLoopStats().iteration is us_internal_loop_pre's counter) and
//      then pauses all N again.
//   3. The child writes one byte to each socket and reports `bursted`. The
//      server resumes all N at once: N readables in one iteration again. The
//      budget processes 5 (the byte is unread ciphertext after WANT_WRITE, so
//      on_data closes them in that same iteration) and parks N - 5 with their
//      flight still pending. Every iteration after that re-enables 5 parked
//      sockets (each then closes the same way), while the still-parked ones
//      get their WRITABLE retry, which re-enables READABLE, and then a
//      READABLE dispatch with the budget exhausted: the guarded path.
//
// The parked count is observable without a native counter: a socket that
// closes in the iteration right after the resume was processed directly; one
// that closes later was parked and re-enabled. The summary reports both per
// wave and the test asserts the exact split.
//
// One extra "primer" connection per round takes the first handshake flight:
// that flight is batched and its ciphertext occupies the loop's single spill
// slot (ssl_spill_owner), and a spill owner never hits the unread-ciphertext
// close in step 3. With the slot taken, all N wave sockets take the same
// per-record WANT_WRITE path and the per-wave numbers are exact.
import { socketFaultInjection as fault, getEventLoopStats } from "bun:internal-for-testing";
import net from "node:net";
import tls from "node:tls";
import { tls as certs, bunEnv, bunExe } from "harness";

if (!fault.available()) throw new Error("socket fault injection is not available in this build");

const N = 32;
const ROUNDS = 2;
const WAVES = 2;
// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
// Well inside the test's own timeout, so a stalled step still gets to print
// the summary with `error` set instead of being killed silently.
const STEP_DEADLINE_MS = 20_000;

type Wave = { direct: number; parked: number; iterations: number };
const summary = {
  rounds: 0,
  opened: 0,
  closed: 0,
  handshakeFailed: 0,
  handshakeOk: 0,
  data: 0,
  errors: 0,
  waves: [] as Wave[],
};

function report(extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ...summary, ...extra }));
  process.exit(extra.error ? 1 : 0);
}

// Rejects when the child exits (set once it is spawned): a step still waiting
// on it then fails at once with the exit status instead of at its deadline.
let childGone: Promise<never> | null = null;

function withDeadline<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${step}`)), STEP_DEADLINE_MS);
  });
  return Promise.race(childGone ? [promise, deadline, childGone] : [promise, deadline]).finally(() =>
    clearTimeout(timer),
  );
}

const iteration = () => getEventLoopStats().iteration;

// Each setImmediate turn is one us_internal_loop_pre, but count the loop's own
// iterations rather than the turns so the wait is exact.
async function afterIterations(n: number) {
  const target = iteration() + n;
  while (iteration() < target) await new Promise(r => setImmediate(r));
}

// Capture one real TLS 1.2 ClientHello record so raw net clients can replay
// it. TLS 1.2 keeps the server waiting for the client's second flight after
// it sends its own, so SSL_in_init() stays true for the whole window.
async function captureClientHello(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const srv = net.createServer(sock => {
    // A `data` event delivers a TCP chunk, not a TLS record, so buffer until
    // the first record is complete (5-byte header + the length it declares)
    // and resolve with exactly that record.
    const chunks: Buffer[] = [];
    let total = 0;
    sock.on("error", reject);
    sock.on("close", () => reject(new Error("socket closed before a full ClientHello record arrived")));
    sock.on("data", d => {
      chunks.push(d);
      total += d.length;
      const buf = Buffer.concat(chunks, total);
      if (buf.length < 5) return;
      const recordLength = 5 + buf.readUInt16BE(3);
      if (buf.length < recordLength) return;
      sock.removeAllListeners("close");
      sock.destroy();
      resolve(buf.subarray(0, recordLength));
    });
  });
  srv.on("error", reject);
  await new Promise<void>((r, rej) => {
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", r);
  });
  const port = (srv.address() as net.AddressInfo).port;
  let c: tls.TLSSocket | undefined;
  try {
    c = tls.connect({
      port,
      host: "127.0.0.1",
      maxVersion: "TLSv1.2",
      minVersion: "TLSv1.2",
      rejectUnauthorized: false,
    });
    // The raw server never replies, so the client errors or closes once the
    // ClientHello has been captured and `sock` is destroyed; by then `promise`
    // is settled and these rejections are no-ops. Before that point they turn
    // a setup failure into a real error instead of a hang.
    c.on("error", reject);
    c.on("close", () => reject(new Error("tls.connect closed before the ClientHello was captured")));
    return await promise;
  } finally {
    c?.destroy();
    await new Promise<void>(r => srv.close(() => r()));
  }
}

const clientHello = await captureClientHello();

// The child reads one command per line on stdin and answers one line on
// stdout once the command's effect has reached the kernel (write callbacks)
// or the sockets are gone (close events).
//   connect <n> <port> -> connects n sockets and writes ONLY the ClientHello
//                         to each (trailing bytes in the same segment would
//                         trip the unread-ciphertext close in on_data before
//                         the socket can be parked); answers `hellos <n>`
//   burst              -> writes one byte to each socket of the last batch;
//                         answers `bursted <n>`
//   reset              -> destroys every socket; answers `reset` once all of
//                         them have closed
//   exit               -> exits 0
const clientSrc = `
const net = require("node:net");
const readline = require("node:readline");
const hello = Buffer.from(process.env.REPRO_HELLO, "hex");
const say = line => process.stdout.write(line + "\\n");
let all = [];
let batch = [];
function writeAll(socks, data, done) {
  let pending = socks.length;
  if (!pending) return done();
  for (const c of socks) c.write(data, () => { if (--pending === 0) done(); });
}
readline.createInterface({ input: process.stdin }).on("line", line => {
  const [cmd, arg, arg2] = line.split(" ");
  if (cmd === "connect") {
    const n = Number(arg);
    batch = [];
    let connected = 0;
    for (let i = 0; i < n; i++) {
      const c = net.connect(Number(arg2), "127.0.0.1");
      c.setNoDelay(true);
      c.on("error", () => {});
      batch.push(c);
      all.push(c);
      c.on("connect", () => {
        if (++connected === n) writeAll(batch, hello, () => say("hellos " + n));
      });
    }
  } else if (cmd === "burst") {
    const live = batch.filter(c => !c.destroyed);
    writeAll(live, Buffer.from([0]), () => say("bursted " + live.length));
  } else if (cmd === "reset") {
    const open = all.filter(c => !c.closed);
    all = [];
    batch = [];
    let pending = open.length;
    if (!pending) return say("reset");
    for (const c of open) {
      c.once("close", () => { if (--pending === 0) say("reset"); });
      c.destroy();
    }
  } else if (cmd === "exit") {
    process.exit(0);
  }
});
`;

const child = Bun.spawn({
  cmd: [bunExe(), "-e", clientSrc],
  env: { ...bunEnv, REPRO_HELLO: clientHello.toString("hex") },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
childGone = child.exited.then(code => {
  throw new Error(`child exited (code ${code}, signal ${child.signalCode}) before the fixture finished`);
});
// Only the races in withDeadline consume the rejection.
childGone.catch(() => {});
const lines: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
(async () => {
  let rest = "";
  for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
    rest += chunk;
    let nl;
    while ((nl = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      const waiter = lineWaiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  }
})().catch(e => report({ error: `child stdout reader failed: ${e}` }));
function send(cmd: string) {
  child.stdin.write(cmd + "\n");
  child.stdin.flush();
}
async function expectLine(want: string) {
  const got = await withDeadline(
    lines.length ? Promise.resolve(lines.shift()!) : new Promise<string>(r => lineWaiters.push(r)),
    `child to answer "${want}"`,
  );
  if (got !== want) report({ error: `child answered "${got}", expected "${want}"` });
}

type Batch = {
  socks: Bun.Socket<undefined>[];
  allOpen: PromiseWithResolvers<void>;
  allClosed: PromiseWithResolvers<void>;
  expected: number;
  burstIteration: number;
  direct: number;
  late: number;
  lastCloseIteration: number;
};

function newBatch(expected: number): Batch {
  return {
    socks: [],
    allOpen: Promise.withResolvers<void>(),
    allClosed: Promise.withResolvers<void>(),
    expected,
    burstIteration: -1,
    direct: 0,
    late: 0,
    lastCloseIteration: -1,
  };
}

let current: Batch | null = null;

async function round() {
  // Bun.listen({tls}) is the native SSL listen path: us_internal_ssl_attach()
  // runs inside the accept loop and the accepted socket hits the low-prio
  // gate on its very first readable dispatch. `server` is local so each
  // round's Listener can be finalized (which is where the group deinit
  // asserts low_prio_count == 0).
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key: certs.key, cert: certs.cert },
    socket: {
      open(s) {
        summary.opened++;
        // Reads stay off until the server resumes the whole batch at once.
        s.pause();
        const batch = current!;
        batch.socks.push(s);
        if (batch.socks.length === batch.expected) batch.allOpen.resolve();
      },
      close(s) {
        summary.closed++;
        const batch = current;
        // Only the current wave's sockets count toward its split; the primer
        // and any other socket just land in the total above.
        if (!batch || batch.burstIteration < 0 || !batch.socks.includes(s)) return;
        const it = iteration();
        batch.lastCloseIteration = it;
        if (it === batch.burstIteration + 1) batch.direct++;
        else batch.late++;
        if (batch.direct + batch.late === batch.expected) batch.allClosed.resolve();
      },
      data() {
        summary.data++;
      },
      error() {
        summary.errors++;
      },
      // A socket closed mid-handshake reports the handshake as failed.
      handshake(_s, success) {
        if (success) summary.handshakeOk++;
        else summary.handshakeFailed++;
      },
    },
  });

  // Every send from THIS process returns 0 (backpressure): the server flights
  // stay WANT_WRITE forever and every writable retry re-issues
  // us_poll_change(READABLE|WRITABLE), including on already-parked sockets.
  // The faults are process-wide, so clear them even if the child fails.
  // fault.set returns false if the rule could not be armed; without the
  // forced backpressure nothing ever parks, so that must fail the fixture.
  if (!fault.set({ syscall: "send", action: "zero", repeat: -1 })) {
    report({ error: "failed to arm the send socket fault" });
  }
  if (!fault.set({ syscall: "writev", action: "zero", repeat: -1 })) {
    report({ error: "failed to arm the writev socket fault" });
  }

  try {
    // Primer: see the header comment. Its ClientHello is processed alone and
    // its flight becomes the spill owner.
    current = newBatch(1);
    send(`connect 1 ${server.port}`);
    await withDeadline(current.allOpen.promise, "primer open");
    await expectLine("hellos 1");
    for (const s of current.socks) s.resume();
    await afterIterations(2);

    for (let w = 0; w < WAVES; w++) {
      const batch = (current = newBatch(N));
      send(`connect ${N} ${server.port}`);
      await withDeadline(batch.allOpen.promise, `${N} opens`);
      await expectLine(`hellos ${N}`);
      // Step 2: every ClientHello becomes readable in the next iteration.
      for (const s of batch.socks) s.resume();
      await afterIterations(Math.ceil(N / BUDGET) + 2);
      for (const s of batch.socks) s.pause();
      // Step 3.
      send("burst");
      await expectLine(`bursted ${N}`);
      batch.burstIteration = iteration();
      for (const s of batch.socks) s.resume();
      await withDeadline(batch.allClosed.promise, `${N} closes after the burst`);
      summary.waves.push({
        direct: batch.direct,
        parked: batch.late,
        iterations: batch.lastCloseIteration - batch.burstIteration,
      });
    }
    current = null;
    send("reset");
    await expectLine("reset");
  } catch (e) {
    report({ error: String(e) });
  } finally {
    fault.clear();
    server.stop(true);
  }
  summary.rounds++;
}

try {
  for (let i = 0; i < ROUNDS; i++) {
    await round();
    // Finalize the round's Listener so its socket group deinits.
    Bun.gc(true);
    await afterIterations(2);
    Bun.gc(true);
  }
  send("exit");
  const exitCode = await withDeadline(child.exited, "child exit");
  if (exitCode !== 0) report({ error: `child exited with ${exitCode}` });
} catch (e) {
  report({ error: String(e) });
} finally {
  child.kill();
}
report();
