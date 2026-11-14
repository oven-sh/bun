// Regression fixture: a TLS socket parked in the low-priority handshake queue is given back
// without an event from outside.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration and parks the other sockets
// that became readable: their readable poll is switched off, and the start of every later
// iteration gives 5 of them back (see tls-pause-parked-handshake-fixture.ts). So a parked socket
// resumes only when the loop turns again, and what it has received cannot cause that turn. The
// loop used to wait for the next timer or the next event of some other socket.
//
// Server and clients share this process (see tls-fixture-transport.ts):
//   1. N clients connect. The server pauses each accepted socket in `open`, so every ClientHello
//      stays unread in the kernel.
//   2. The server resumes all N at once. The next iteration reads 5 ClientHellos and parks the
//      other N - 5.
//   3. An immediate of that same iteration pauses every socket but one: the first that was
//      parked, which the last-in-first-out queue gives back last. The queue gives a paused socket
//      back silent, so nothing that is ready leads the loop to the one that is left.
//   4. Nothing here turns the loop from now on. The handshake of that socket completes only if
//      the loop turns by itself while sockets are parked: ceil((N - 6) / 5) turns to reach it.
//   5. With the queue empty the loop must wait again. A short timer counts its turns meanwhile.
import type { Socket } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { connect, listen } from "./tls-fixture-transport";

const N = 64;
// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
// Well inside the timeout that CI gives a test, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;
// A loop that waits for its 4 s socket sweep to reach the socket needs 12 of them.
const PARKED_DEADLINE_MS = 3_000;
const QUIET_MS = 250;

const iteration = () => getEventLoopStats().iteration;

const summary = {
  opened: 0,
  // Clients whose handshake completed: the budget of step 2, and the socket that was left.
  clientHandshakes: -1,
  pickedHandshake: false,
  // Loop iterations from the pause of step 3 to the handshake of the socket that was left.
  turnsToPicked: -1,
  // Loop iterations during QUIET_MS after that.
  turnsWhileQuiet: -1,
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
let picked: Socket | undefined;
const pickedHandshake = Promise.withResolvers<void>();
let clientOpens = 0;
let clientHandshakes = 0;

const { server, address } = listen("s", {
  tls: { key: process.env.TLS_KEY!, cert: process.env.TLS_CERT! },
  socket: {
    open(s) {
      summary.opened++;
      s.pause();
      accepted.push(s);
    },
    handshake(s, success) {
      if (success && s === picked) pickedHandshake.resolve();
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
        tls: { rejectUnauthorized: false },
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
  // One more turn and every ClientHello is in the server's receive queue.
  await afterIterations(2);

  // Step 2.
  for (const s of accepted) s.resume();
  // Immediates run after an iteration's dispatch: the first one that sees the counter advance runs
  // with the budget spent and N - 5 sockets parked.
  await afterIterations(1);

  // Step 3.
  picked = accepted[BUDGET];
  for (const s of accepted) if (s !== picked) s.pause();

  // Step 4.
  const parkedAt = iteration();
  const stalled = setTimeout(
    () => report({ error: "the socket is still parked", turnsToPicked: iteration() - parkedAt }),
    PARKED_DEADLINE_MS,
  );
  await pickedHandshake.promise;
  clearTimeout(stalled);
  summary.pickedHandshake = true;
  summary.turnsToPicked = iteration() - parkedAt;

  // Step 5.
  const quietAt = iteration();
  await Bun.sleep(QUIET_MS);
  summary.turnsWhileQuiet = iteration() - quietAt;
  summary.clientHandshakes = clientHandshakes;
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  server.stop(true);
}
report();
