// Regression fixture: the `timeout` of a TLS socket that waits in the low-priority handshake queue.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration. A handshaking socket that
// becomes readable after the budget is spent is PARKED: unlinked from its group, linked into
// loop->data.low_prio_head, and its readable poll is switched off. The start of every later
// iteration takes 5 sockets out of the queue, newest first, and that spends the iteration's budget.
//
// The loop holds back the reads of a parked socket, so the socket's timeout must not run: its
// owner would act on a peer whose bytes nobody read. The timeout has to come back when the queue
// releases the socket, or a peer that goes silent after its first bytes would never time out.
//
// Server and clients share this process, so a loop iteration is one step for both sides (see
// tls-fixture-transport.ts). A client is a plain socket that sends the head of a TLS record, so
// its server socket stays in the handshake and every read of it is a handshake read:
//   1. The server pauses each accepted socket in `open`: every record head stays in the kernel.
//   2. 10 decoys resume. The next iteration reads 5 of them and parks the other 5.
//   3. The subjects resume. The next iteration first takes the 5 decoys out of the queue, which
//      spends its budget, so it parks every subject.
//   4. 5 more decoys resume. The next iteration takes 5 subjects out of the queue and parks these
//      decoys on top of the others.
//   5. Every subject gets timeout(1), which is one sweep tick: 5 subjects are linked, 15 are parked.
//   6. The loop stops for one tick and then turns once. The 5 linked subjects get `timeout`. The
//      15 parked ones must not. epoll and kqueue drain the queue before the sweep and libuv after
//      it: the decoys on top are what that drain takes, so the count is the same everywhere.
//   7. The loop turns until the queue is empty, stops for one more tick and turns once: the other
//      15 subjects get `timeout` now.
import type { Socket } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import { connect, listen } from "./tls-fixture-transport";

// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
const DECOYS_FIRST = 2 * BUDGET;
const SUBJECTS = 4 * BUDGET;
const DECOYS_ON_TOP = BUDGET;
const N = DECOYS_FIRST + SUBJECTS + DECOYS_ON_TOP;
// LIBUS_TIMEOUT_GRANULARITY (packages/bun-usockets/src/libusockets.h) plus a margin.
const TICK_MS = 4100;
// Well inside the test's own timeout, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;
// A handshake record that announces 512 more bytes.
const RECORD_HEAD = new Uint8Array([0x16, 0x03, 0x01, 0x02, 0x00]);

const iteration = () => getEventLoopStats().iteration;

const summary = {
  opened: 0,
  // `timeout` handlers that ran at the tick of step 6, and at the tick of step 7.
  timeouts: [] as number[],
  errors: 0,
};

function report(extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ...summary, ...extra }));
  process.exit(extra.error ? 1 : 0);
}

// One turn of the immediate queue is one loop iteration.
async function until(step: string, done: () => boolean) {
  const deadline = Date.now() + STEP_DEADLINE_MS;
  while (!done()) {
    if (Date.now() > deadline) report({ error: `timed out waiting for ${step}` });
    await new Promise(r => setImmediate(r));
  }
}
function afterIterations(n: number) {
  const target = iteration() + n;
  return until(`${n} loop iterations`, () => iteration() >= target);
}
// No signal says that a sweep tick is due: the tick is a clock, and this fixture is about that clock.
async function afterOneTick() {
  Bun.sleepSync(TICK_MS);
  await afterIterations(1);
}

const accepted: Socket[] = [];
let timeouts = 0;
let clientOpens = 0;

const { server, address } = listen("s", {
  tls: { key: certs.key, cert: certs.cert },
  socket: {
    open(s) {
      summary.opened++;
      s.pause();
      accepted.push(s);
    },
    // With this handler, `open` runs when the connection opens and not when the handshake ends.
    handshake() {},
    timeout() {
      timeouts++;
    },
    data() {},
    error() {
      summary.errors++;
    },
  },
});

const clients: Socket[] = [];
try {
  // One at a time, so that the server accepts them in this order.
  for (let i = 0; i < N; i++) {
    clients.push(
      await connect(address, {
        socket: {
          open(c) {
            clientOpens++;
            c.write(RECORD_HEAD);
          },
          data() {},
          error() {
            summary.errors++;
          },
        },
      }),
    );
  }
  await until(`${N} connections`, () => accepted.length === N && clientOpens === N);
  // One more turn and every record head is in the server's receive queue.
  await afterIterations(2);

  const decoysFirst = accepted.slice(0, DECOYS_FIRST);
  const subjects = accepted.slice(DECOYS_FIRST, DECOYS_FIRST + SUBJECTS);
  const decoysOnTop = accepted.slice(DECOYS_FIRST + SUBJECTS);

  // Step 2.
  for (const s of decoysFirst) s.resume();
  await afterIterations(1);
  // Step 3.
  for (const s of subjects) s.resume();
  await afterIterations(1);
  // Step 4.
  for (const s of decoysOnTop) s.resume();
  await afterIterations(1);
  // Step 5.
  for (const s of subjects) s.timeout(1);
  // Step 6.
  await afterOneTick();
  summary.timeouts.push(timeouts);
  // Step 7.
  await afterIterations(SUBJECTS / BUDGET + 2);
  await afterOneTick();
  summary.timeouts.push(timeouts - summary.timeouts[0]);
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  server.stop(true);
}
report();
