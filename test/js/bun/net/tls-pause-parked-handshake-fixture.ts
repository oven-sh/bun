// Regression fixture: pause() on a TLS socket that is parked in the low-priority handshake queue.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration. A handshaking socket that
// becomes readable after the budget is spent is PARKED: unlinked from its group, linked into
// loop->data.low_prio_head, and its readable poll is switched off. The start of every later
// iteration takes 5 sockets out of the queue and switches their readable poll back on.
//
// us_socket_pause on a parked socket finds the reads off already and only sets is_paused. The
// queue drain did not look at is_paused, so it switched the reads of a paused socket back on: its
// handshake ran, and `handshake` and `data` were delivered to a socket whose pause() had returned.
//
// Server and clients share this process, so a loop iteration is one step for both sides. The
// steps run on two clocks:
//   - The iteration counter is exact for what the loop does with bytes that a socket already
//     holds: which sockets it reads, parks, and takes out of the queue.
//   - The iteration counter says nothing about bytes in transit. The clock for those is a
//     loopback round trip (loopback-round-trip.ts): when it completes, everything that was sent
//     before it started has arrived.
//   1. N clients connect. The server pauses each accepted socket in `open`, so every ClientHello
//      stays unread in the kernel.
//   2. The server resumes all N at once. The next iteration reads 5 ClientHellos (their clients
//      complete the TLS 1.3 handshake on the flight they get back) and parks the other N - 5.
//   3. An immediate of that same iteration pauses all N again. From here on no server handler may
//      run, and no other client may complete its handshake.
//   4. The 5 clients complete. Then the loop drains the queue several times over, with a round
//      trip after each pass for the bytes that a wrongly resumed socket puts in transit.
//   5. The server resumes all N. Every handshake completes and every ping is answered, so a socket
//      that the drain left paused comes back.
import type { Socket } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import { loopbackRoundTrip } from "./loopback-round-trip";

const N = 32;
// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
// Empties the queue several times over. The queue holds the N - 5 parked server sockets and, for
// an iteration each, the clients that got a flight back. It drains 5 per iteration.
const DRAIN_ITERATIONS = 4 * Math.ceil(N / BUDGET) + 8;
// Well inside the test's own timeout, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;

const iteration = () => getEventLoopStats().iteration;

const summary = {
  opened: 0,
  // Server handlers that ran between the pause of step 3 and the resume of step 5.
  whilePaused: { handshake: 0, data: 0 },
  // Clients whose handshake completed before the resume of step 5.
  clientHandshakesWhilePaused: -1,
  serverHandshakes: 0,
  serverData: 0,
  pongs: 0,
  errors: 0,
};

function report(extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ...summary, ...extra }));
  process.exit(extra.error ? 1 : 0);
}

// One turn of the immediate queue is one loop iteration. The turns also keep the low-priority
// queue moving, which drains only when the loop iterates.
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

type State = { paused: boolean };
const accepted: Socket<State>[] = [];
let clientOpens = 0;
let clientHandshakes = 0;

const server = Bun.listen<State>({
  hostname: "127.0.0.1",
  port: 0,
  tls: { key: certs.key, cert: certs.cert },
  socket: {
    open(s) {
      summary.opened++;
      s.data = { paused: true };
      s.pause();
      accepted.push(s);
    },
    handshake(s, success) {
      if (s.data.paused) summary.whilePaused.handshake++;
      if (success) summary.serverHandshakes++;
    },
    data(s) {
      if (s.data.paused) summary.whilePaused.data++;
      summary.serverData++;
      s.write("pong");
    },
    error() {
      summary.errors++;
    },
  },
});

// Every wait goes through until(): it has the deadline, and its turns keep the queue moving.
async function roundTrip() {
  let back = false;
  loopbackRoundTrip().then(
    () => (back = true),
    e => report({ error: `loopback round trip: ${e}` }),
  );
  await until("a loopback round trip", () => back);
}

const clients: Socket[] = [];
try {
  for (let i = 0; i < N; i++) {
    clients.push(
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { rejectUnauthorized: false },
        socket: {
          // The ClientHello goes out as soon as this returns.
          open() {
            clientOpens++;
          },
          handshake(c, success) {
            if (!success) return;
            clientHandshakes++;
            c.write("ping");
          },
          data() {
            summary.pongs++;
          },
          error() {
            summary.errors++;
          },
        },
      }),
    );
  }
  await until(`${N} connections`, () => accepted.length === N && clientOpens === N);
  // Every ClientHello is in the server's receive queue.
  await roundTrip();

  // Step 2.
  for (const s of accepted) {
    s.data.paused = false;
    s.resume();
  }
  // Immediates run after an iteration's dispatch: the first one that sees the counter advance runs
  // with the budget spent and N - 5 sockets parked.
  await afterIterations(1);

  // Step 3.
  for (const s of accepted) {
    s.pause();
    s.data.paused = true;
  }

  // Step 4. The 5 clients complete when the flights of step 2 arrive.
  await until(`${BUDGET} client handshakes`, () => clientHandshakes >= BUDGET);
  // Nothing else may happen. To show that takes a bound on how far a socket gets when the drain
  // wrongly resumes it. One pass over the queue: it reads its ClientHello and sends its flight.
  await afterIterations(DRAIN_ITERATIONS);
  // One round trip: the flight is at its client. One pass: the client completes the handshake and
  // writes its ping.
  await roundTrip();
  await afterIterations(DRAIN_ITERATIONS);
  // One round trip: the ping is at the server. One pass: the server runs `handshake` and `data`.
  await roundTrip();
  await afterIterations(DRAIN_ITERATIONS);
  summary.clientHandshakesWhilePaused = clientHandshakes;

  // Step 5.
  for (const s of accepted) {
    s.data.paused = false;
    s.resume();
  }
  await until(`${N} pongs`, () => summary.pongs === N);
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  server.stop(true);
}
report();
