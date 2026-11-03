// Regression fixture: the timeouts of a TLS socket that waits in the low-priority handshake queue.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration. A handshaking socket that
// becomes readable after the budget is spent is PARKED: unlinked from its group, linked into
// loop->data.low_prio_head, and its readable poll is switched off. The start of every later
// iteration takes 5 sockets out of the queue.
//
// The loop holds back the reads of a parked socket, so the socket's timeouts must not run there:
// the owner would act on a peer whose bytes nobody read. They have to run again once the queue
// releases the socket, and after 30 sweep ticks (120 s) in the queue at the latest.
//
// Server and clients share this process, so a loop iteration is one step for both sides (see
// tls-fixture-transport.ts). A client is a plain socket that sends a TLS record one piece at a
// time, so its server socket stays in the handshake and each piece is one more handshake read.
// A round parks 15 of the 20 server sockets: all 20 are paused with an unread piece, all 20
// resume, and the next iteration reads 5 and parks the rest. The sweep is run by hand, which
// turns no loop iteration, so the queue keeps those 15 for as many ticks as a step needs.
//
// With the argument "again" the fixture runs only the step whose sockets are parked four times.
import type { Socket } from "bun";
import { getEventLoopStats, sweepSocketTimers } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import { connect, listen } from "./tls-fixture-transport";

// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
const N = 4 * BUDGET;
// MAX_LOW_PRIO_TICKS in packages/bun-usockets/src/loop.c.
const MAX_PARKED_TICKS = 30;
// A sweep runs every 4 seconds, so 4 seconds set a moment after one are due at the second sweep.
const TIMEOUT_SECONDS = 4;
const TIMEOUT_TICKS = 2;
// Well inside the test's own timeout, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;
// A handshake record that announces 512 more bytes.
const RECORD_HEAD = new Uint8Array([0x16, 0x03, 0x01, 0x02, 0x00]);

const iteration = () => getEventLoopStats().iteration;

// Each entry counts the `timeout` handlers that ran at one point of a step.
const summary = {
  opened: 0,
  // [while 15 sockets were parked, one sweep early after the queue let them go, when due].
  shortest: [] as number[],
  // No timeout armed: [while parked, after].
  unarmed: [] as number[],
  // The sockets stay parked: [before their 30th tick in the queue, after it].
  parkedTooLong: [] as number[],
  // One timeout, four stays of 10 ticks in the queue: [in the first two, in the last two].
  parkedAgain: [] as number[],
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

const accepted: Socket[] = [];
let clientOpens = 0;
let timeouts = 0;
function takeTimeouts() {
  const n = timeouts;
  timeouts = 0;
  return n;
}

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

// Every server socket is paused with an unread piece. Parks N - BUDGET of them and arms `seconds` on all N, if given.
async function park(seconds?: number) {
  for (const s of accepted) s.resume();
  await afterIterations(1);
  if (seconds === undefined) return;
  sweepSocketTimers(1);
  for (const s of accepted) s.timeout(seconds);
  takeTimeouts();
}
// Empties the queue and leaves every server socket paused with one more unread piece.
async function release() {
  for (const s of accepted) s.pause();
  await afterIterations((N - BUDGET) / BUDGET + 2);
  for (const c of clients) c.write(RECORD_HEAD.subarray(0, 1));
  await afterIterations(2);
}

try {
  // One at a time, so that every record head is written before the next step.
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

  if (process.argv[2] === "again") {
    await park(TIMEOUT_SECONDS);
    for (let stay = 0; stay < 4; stay++) {
      if (stay > 0) {
        await release();
        await park();
      }
      sweepSocketTimers(10);
      if (stay % 2) summary.parkedAgain.push(takeTimeouts());
    }
    report();
  }

  await park(TIMEOUT_SECONDS);
  sweepSocketTimers(20);
  summary.shortest.push(takeTimeouts());
  await release();
  sweepSocketTimers(TIMEOUT_TICKS - 1);
  summary.shortest.push(takeTimeouts());
  sweepSocketTimers(1);
  summary.shortest.push(takeTimeouts());

  await park(0);
  sweepSocketTimers(20);
  summary.unarmed.push(takeTimeouts());
  await release();
  sweepSocketTimers(20);
  summary.unarmed.push(takeTimeouts());

  await park(TIMEOUT_SECONDS);
  sweepSocketTimers(MAX_PARKED_TICKS - 5);
  summary.parkedTooLong.push(takeTimeouts());
  sweepSocketTimers(10);
  summary.parkedTooLong.push(takeTimeouts());
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  server.stop(true);
}
report();
