// Regression fixture: the timer of the timeout sweep while sockets wait in the low-priority handshake queue.
//
// tls-parked-handshake-timeout-fixture.ts explains the queue and how a round parks 15 of 20 server sockets. A sweep
// visits the parked sockets too, so each of them has to hold the sweep's timer like a socket that is linked in its
// group: the timer stays armed, and its deadline moves only when a sweep runs.
//
// The clients live in a Worker, which has a loop of its own, so this thread's loop has the server's sockets and
// nothing else. From the round that parks the sockets to the step that releases them nothing here waits for a loop
// iteration, because the start of an iteration takes sockets out of the queue.
import type { Socket } from "bun";
import { getEventLoopStats, sweepSocketTimers } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import net from "node:net";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { connect, listen } from "./tls-fixture-transport";

// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
const N = 4 * BUDGET;
const STEP_DEADLINE_MS = 20_000;
// A handshake record that announces 512 more bytes, and five bytes that fail a handshake at once.
const RECORD_HEAD = new Uint8Array([0x16, 0x03, 0x01, 0x02, 0x00]);
const NO_RECORD_HEAD = new TextEncoder().encode("GET /");

if (!isMainThread) {
  // Each message is a list of record heads: one connection for each, in that order.
  parentPort!.on("message", async (heads: Uint8Array[]) => {
    for (const head of heads) {
      await connect(workerData.address, {
        socket: {
          open(c) {
            c.write(head);
          },
          data() {},
          error() {},
        },
      });
    }
    parentPort!.postMessage("connected");
  });
} else {
  const summary = {
    // Sockets that hold the sweep's timer:
    idle: -1,
    accepted: -1,
    // 15 of the 20 are parked,
    parked: -1,
    notParked: -1,
    // the 5 others are closed, so every socket of the loop is parked,
    allParked: -1,
    // [a socket more is linked, it is unlinked again], three times,
    linked: [] as number[],
    // 5 of the 15 are closed in the queue,
    closedInQueue: -1,
    // the queue has let the other 10 go: the holders that aren't open sockets of the server, or the reverse,
    releasedDifference: -1,
    closed: -1,
    // 5 sockets use up the budget and close, and the sixth, the only one left, is parked.
    lastOneParked: -1,
    // Steps after which the deadline wasn't the one the last sweep set, or the first socket if there was no sweep.
    deadlineMoved: [] as string[],
    iterationsWhileParked: -1,
  };

  function report(extra: Record<string, unknown> = {}): never {
    console.log(JSON.stringify({ ...summary, ...extra }));
    process.exit(extra.error ? 1 : 0);
  }
  const iteration = () => getEventLoopStats().iteration;
  const holders = () => getEventLoopStats().sweepTimerCount;
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
  let expectedDeadline: number | undefined;
  function checkDeadline(step: string) {
    if (getEventLoopStats().sweepDeadline !== expectedDeadline) summary.deadlineMoved.push(step);
  }

  const open = new Set<Socket>();
  const timedOut: Socket[] = [];
  const { server, address } = listen("s", {
    tls: { key: certs.key, cert: certs.cert },
    socket: {
      open(s) {
        s.pause();
        open.add(s);
      },
      // With this handler, `open` runs when the connection opens and not when the handshake ends.
      handshake(s, success) {
        if (!success) s.terminate();
      },
      timeout(s) {
        timedOut.push(s);
      },
      close(s) {
        open.delete(s);
      },
      data() {},
      error() {},
    },
  });
  const worker = new Worker(import.meta.filename, { workerData: { address } });
  async function connectAll(heads: Uint8Array[]) {
    const connected = new Promise(resolve => worker.once("message", resolve));
    worker.postMessage(heads);
    await connected;
    await until(`${heads.length} connections`, () => open.size === heads.length);
  }

  try {
    summary.idle = holders();
    await connectAll(Array(N).fill(RECORD_HEAD));
    summary.accepted = holders();

    for (const s of open) s.resume();
    await afterIterations(1);
    const parkedAt = iteration();
    summary.parked = holders();

    // A parked socket's timeout waits, so the sockets whose timeout fires are the ones that aren't parked.
    sweepSocketTimers(1);
    for (const s of open) s.timeout(4);
    sweepSocketTimers(2);
    expectedDeadline = getEventLoopStats().sweepDeadline;
    summary.notParked = timedOut.length;
    for (const s of timedOut) s.terminate();
    summary.allParked = holders();
    checkDeadline("every socket is parked");

    for (let i = 0; i < 3; i++) {
      const before = holders();
      const socket = typeof address === "string" ? net.connect(address) : net.connect(address, "127.0.0.1");
      socket.on("error", () => {});
      // net.connect() dials from a tick, which is no loop iteration.
      for (let tick = 0; tick < 10 && holders() === before; tick++) await new Promise(r => process.nextTick(r));
      summary.linked.push(holders());
      checkDeadline("a socket is linked");
      socket.destroy();
      summary.linked.push(holders());
      checkDeadline("a socket is unlinked");
    }

    for (const s of [...open].slice(0, BUDGET)) s.terminate();
    summary.closedInQueue = holders();
    checkDeadline("sockets are closed in the queue");
    summary.iterationsWhileParked = iteration() - parkedAt;

    // From here the loop turns. A sweep of its own is a whole period away after this one.
    sweepSocketTimers(1);
    expectedDeadline = getEventLoopStats().sweepDeadline;
    for (const s of open) s.pause();
    await afterIterations(open.size / BUDGET + 2);
    // The server may have accepted the three connections that were dialed above.
    summary.releasedDifference = holders() - open.size;
    checkDeadline("the queue has let the sockets go");

    for (const s of open) s.terminate();
    summary.closed = holders();

    await connectAll([...Array(BUDGET).fill(NO_RECORD_HEAD), RECORD_HEAD]);
    sweepSocketTimers(1);
    expectedDeadline = getEventLoopStats().sweepDeadline;
    for (const s of open) s.resume();
    await afterIterations(1);
    summary.lastOneParked = holders();
    checkDeadline("the last linked socket is parked");
  } catch (e) {
    report({ error: String(e) });
  } finally {
    server.stop(true);
    await worker.terminate();
  }
  report();
}
