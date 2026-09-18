// Regression fixture for the TLS `server.stop(true)` sibling-close
// use-after-free (issue #36459).
//
// us_socket_group_close_all_ex walks group->head_sockets to close every
// connection during teardown. It used to cache `next = s->next` and then call
// us_socket_close(s), which dispatches the JS handshake/close handlers. If a
// handler closes a *sibling* connection (the one cached as `next`), the walk
// then advanced onto freed memory: the event loop dispatched through a freed
// socket's vtable and aborted with `panic: us_socket_t with kind=invalid`.
// Sockets parked in the loop-wide low-priority handshake queue are not in
// head_sockets at all; close_all drains those separately and a handler may
// close another parked socket while that drain runs.
//
// This fixture is the server. Its handshake and close handlers each close one
// more live connection while the teardown runs, and a CHILD process supplies
// the connections (raw TLS 1.2 ClientHellos, so every socket is mid-handshake
// and a close dispatches handshake(false) and then close). Two scenarios, each
// on a fresh listener:
//
//   walk:   every accepted socket is paused in `open`, so nothing is read and
//           head_sockets keeps its link order (newest first). stop(true) then
//           walks that list. The handlers close the live socket that was
//           accepted right before the one being closed, which is exactly the
//           walk's next entry, so every step of the walk lands on the path the
//           fix guards.
//   parked: the server resumes all N paused sockets at once. In the next loop
//           iteration the 5-per-iteration handshake budget processes 5
//           ClientHellos (their flights reach the child) and parks the rest in
//           the low-priority queue. stop(true) runs in that same iteration, so
//           it walks 5 sockets and then drains N - 5 parked ones while the
//           handlers close parked siblings.
//
// The child reports how many of its sockets received any bytes before the
// server closed them: 0 in `walk` and exactly 5 (the budget) in `parked`,
// which is the proof that N - 5 sockets were parked when stop(true) ran.
import { getEventLoopStats } from "bun:internal-for-testing";
import net from "node:net";
import tls from "node:tls";
import { tls as certs, bunEnv, bunExe } from "harness";

const N = 64;
// Well inside the test's own timeout, so a stalled step still gets to print
// the summary with `error` set instead of being killed silently.
const STEP_DEADLINE_MS = 20_000;

type Scenario = {
  kind: "walk" | "parked";
  opened: number;
  closed: number;
  handshakeFailed: number;
  handshakeOk: number;
  data: number;
  errors: number;
  siblingCloses: number;
  flightsReceived: number;
};
const summary = { scenarios: [] as Scenario[] };

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

// Capture one real TLS 1.2 ClientHello record so raw net clients can replay it
// without doing a full handshake. TLS 1.2 keeps the server waiting for the
// client's second flight, so the accepted socket stays mid-handshake.
async function captureClientHello(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const srv = net.createServer(sock => {
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
    c.on("error", reject);
    c.on("close", () => reject(new Error("tls.connect closed before the ClientHello was captured")));
    return await promise;
  } finally {
    c?.destroy();
    await new Promise<void>(r => srv.close(() => r()));
  }
}

const clientHello = await captureClientHello();

// The child reads one command per line on stdin:
//   connect <n> <port> -> connects n sockets, writes ONLY the ClientHello to
//                         each, answers `hellos <n>` once every write callback
//                         has fired, and later `closed <n> <flights>` once all
//                         n sockets have closed, where <flights> is how many
//                         of them received any bytes first
//   exit               -> exits 0
const clientSrc = `
const net = require("node:net");
const readline = require("node:readline");
const hello = Buffer.from(process.env.REPRO_HELLO, "hex");
const say = line => process.stdout.write(line + "\\n");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const [cmd, arg, arg2] = line.split(" ");
  if (cmd === "connect") {
    const n = Number(arg);
    let connected = 0;
    let written = 0;
    let closed = 0;
    let flights = 0;
    const socks = [];
    for (let i = 0; i < n; i++) {
      const c = net.connect(Number(arg2), "127.0.0.1");
      c.setNoDelay(true);
      let gotData = false;
      c.on("error", () => {});
      c.on("data", () => { gotData = true; });
      c.on("close", () => {
        if (gotData) flights++;
        if (++closed === n) say("closed " + n + " " + flights);
      });
      socks.push(c);
      c.on("connect", () => {
        if (++connected < n) return;
        for (const s of socks) s.write(hello, () => { if (++written === n) say("hellos " + n); });
      });
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
async function nextLine(step: string): Promise<string> {
  return withDeadline(
    lines.length ? Promise.resolve(lines.shift()!) : new Promise<string>(r => lineWaiters.push(r)),
    step,
  );
}
async function expectLine(want: string) {
  const got = await nextLine(`child to answer "${want}"`);
  if (got !== want) report({ error: `child answered "${got}", expected "${want}"` });
}

async function scenario(kind: Scenario["kind"]) {
  const stats: Scenario = {
    kind,
    opened: 0,
    closed: 0,
    handshakeFailed: 0,
    handshakeOk: 0,
    data: 0,
    errors: 0,
    siblingCloses: 0,
    flightsReceived: -1,
  };
  const socks: Bun.Socket<undefined>[] = [];
  const live = new Set<Bun.Socket<undefined>>();
  const allOpen = Promise.withResolvers<void>();
  let tearing = false;
  // Only a handler running for the socket that close_all itself is closing
  // picks a sibling; the sibling's own handlers (depth 2) do not, so the
  // teardown never recurses more than one level.
  let depth = 0;

  // The live socket accepted right before `self`, or the one accepted right
  // after it when `self` is the oldest one left. In `walk` the former is the
  // entry close_all visits next.
  function closeSibling(self: Bun.Socket<undefined>) {
    if (!tearing || depth !== 1) return;
    const i = socks.indexOf(self);
    let other: Bun.Socket<undefined> | undefined;
    for (let j = i - 1; j >= 0 && !other; j--) if (live.has(socks[j])) other = socks[j];
    for (let j = i + 1; j < socks.length && !other; j++) if (live.has(socks[j])) other = socks[j];
    if (!other) return;
    stats.siblingCloses++;
    other.end();
  }

  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key: certs.key, cert: certs.cert },
    socket: {
      open(s) {
        stats.opened++;
        s.pause();
        socks.push(s);
        live.add(s);
        if (socks.length === N) allOpen.resolve();
      },
      handshake(s, success) {
        if (success) stats.handshakeOk++;
        else stats.handshakeFailed++;
        depth++;
        try {
          closeSibling(s);
        } finally {
          depth--;
        }
      },
      data() {
        stats.data++;
      },
      close(s) {
        stats.closed++;
        live.delete(s);
        depth++;
        try {
          closeSibling(s);
        } finally {
          depth--;
        }
      },
      error() {
        stats.errors++;
      },
    },
  });

  try {
    send(`connect ${N} ${server.port}`);
    await withDeadline(allOpen.promise, `${N} opens`);
    await expectLine(`hellos ${N}`);
    if (kind === "parked") {
      for (const s of socks) s.resume();
      // The resumed sockets are dispatched in the next loop iteration.
      // Immediates run after an iteration's dispatch, so the first one that
      // sees the counter advance runs with the budget spent and N - 5 sockets
      // parked. (getEventLoopStats().iteration is us_internal_loop_pre's
      // counter.)
      const target = iteration() + 1;
      while (iteration() < target) await new Promise(r => setImmediate(r));
    }
    // The stop must land HERE, while every connection is mid-handshake, or the
    // scenario does not exercise the teardown walk.
    tearing = true;
    server.stop(true);
    tearing = false;
    const closedLine = await nextLine("child to report its closes");
    const m = /^closed (\d+) (\d+)$/.exec(closedLine);
    if (!m || Number(m[1]) !== N) report({ error: `child answered "${closedLine}", expected "closed ${N} <flights>"` });
    stats.flightsReceived = Number(m![2]);
  } finally {
    server.stop(true);
  }
  summary.scenarios.push(stats);
}

try {
  await scenario("walk");
  await scenario("parked");
  // Finalize both Listeners while the process is still alive so their socket
  // groups deinit (and assert that nothing is left parked).
  Bun.gc(true);
  send("exit");
  const exitCode = await withDeadline(child.exited, "child exit");
  if (exitCode !== 0) report({ error: `client exited with ${exitCode}` });
} catch (e) {
  report({ error: String(e) });
} finally {
  child.kill();
}
report();
