// Regression fixture: the loop releases TLS sockets parked in the low-priority handshake queue
// without waiting for an unrelated timer or event.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration and parks the other handshaking
// sockets that became readable, with their readable poll off. The start of each later iteration
// releases 5 of them (see tls-pause-parked-handshake-fixture.ts). A parked socket's input can't
// wake the loop, so the loop must not block while the queue has sockets in it.
//
// Server and clients share this process (see tls-fixture-transport.ts):
//   1. N clients connect. The server pauses each accepted socket in `open`, so every ClientHello
//      stays unread in the kernel.
//   2. The server resumes all N at once. The next iteration reads 5 ClientHellos and parks the
//      other N - 5.
//   3. An immediate of that same iteration pauses every socket except the first one parked. The
//      queue is last-in-first-out, so that socket is released last. A paused socket is released
//      with its reads still off, so no readable event leads the loop to the next iteration.
//   4. The fixture schedules nothing else. That socket's handshake completes only if the loop
//      keeps iterating on its own: ceil((N - 6) / 5) iterations to reach it.
import type { Socket } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import { connect, listen } from "./tls-fixture-transport";

const N = 64;
// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
// Well inside the test's own timeout, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;
// A loop that only wakes for its 4 s timeout sweep needs 12 sweeps to reach the socket.
const PARKED_DEADLINE_MS = 3_000;

const iteration = () => getEventLoopStats().iteration;

const summary = {
  opened: 0,
  // The 5 clients read in step 2, plus the one socket left unpaused.
  clientHandshakes: -1,
  // Loop iterations from the pause in step 3 to the unpaused socket's handshake.
  iterationsToHandshake: -1,
  errors: 0,
};

function report(extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ...summary, ...extra }));
  process.exit(extra.error ? 1 : 0);
}

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
let unpaused: Socket | undefined;
const handshakeDone = Promise.withResolvers<void>();
let clientOpens = 0;
let clientHandshakes = 0;

const { server, address } = listen("s", {
  tls: { key: certs.key, cert: certs.cert },
  socket: {
    open(s) {
      summary.opened++;
      s.pause();
      accepted.push(s);
    },
    handshake(s, success) {
      if (success && s === unpaused) handshakeDone.resolve();
    },
    data() {},
    error() {
      summary.errors++;
    },
  },
});

const clients: Socket[] = [];
try {
  for (let i = 0; i < N; i++) {
    clients.push(
      await connect(address, {
        tls: { ca: certs.cert },
        socket: {
          // The ClientHello goes out as soon as this returns.
          open() {
            clientOpens++;
          },
          handshake(_, success) {
            if (success) clientHandshakes++;
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
  // One more iteration and every ClientHello is in the server's receive queue.
  await afterIterations(2);

  // Step 2.
  for (const s of accepted) s.resume();
  // Immediates run after an iteration's dispatch, so the first one that sees the counter advance
  // runs with the budget spent and N - 5 sockets parked.
  await afterIterations(1);

  // Step 3.
  unpaused = accepted[BUDGET];
  for (const s of accepted) if (s !== unpaused) s.pause();

  // Step 4.
  const parkedAt = iteration();
  const stalled = setTimeout(
    () => report({ error: "the socket is still parked", iterationsToHandshake: iteration() - parkedAt }),
    PARKED_DEADLINE_MS,
  );
  await handshakeDone.promise;
  clearTimeout(stalled);
  summary.iterationsToHandshake = iteration() - parkedAt;
  summary.clientHandshakes = clientHandshakes;
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  server.stop(true);
}
report();
