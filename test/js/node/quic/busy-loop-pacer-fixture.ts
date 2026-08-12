// Sends on one stream from a process whose event loop is busy, and reports
// over IPC how much the session put on the wire during each loop iteration
// next to the congestion window it had at the time. Spawned by
// quic-endpoint.test.ts, which is the receiving end.
//
//   busy-loop-pacer-fixture.ts listen          send on the first stream the
//                                              peer opens
//   busy-loop-pacer-fixture.ts connect <port>  open a stream to the test's
//                                              server and send on it
//
// Each iteration blocks the thread for BUSY_MS, so the engine is ticked once
// per iteration, long after the pacer wanted it to be, and by then everything
// sent the previous iteration has been acknowledged. What such a tick is
// allowed to send is the pacer's decision; the window (Cubic, which only
// reacts to loss, so it is wide open here) is what it should be allowed.
//
// Running out of data legitimately ends an iteration early, so the chunks the
// body is made of are never less than several windows' worth, however large
// the window gets on the machine running this, which keeps the iterations
// spent running out and refilling a small minority. (The chunks are not simply
// huge because node:quic's outbound path copies what is left of a chunk on
// every write, so feeding it a very large one stalls the loop noticeably; the
// iteration that refills already runs long, and the test counts it as at most
// one window's worth.)
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const ITERATIONS = 40;
// Long enough that the receiving test process has acknowledged an entire
// window's worth well before the next tick even on a slow debug build, so
// what a tick sends is down to the pacer and not to ACKs still on their way.
const BUSY_MS = 20;
const CHUNK_WINDOWS = 8;
const MIN_CHUNK = 2 * 1024 * 1024;

const [mode, portArg] = process.argv.slice(2);
const cc = "cubic";

let session: Awaited<ReturnType<typeof connect>>;
let iterations = 0;
// One entry per iteration boundary: the session's cumulative bytes sent and
// its window at that moment. Consecutive entries bracket one busy iteration.
const samples: { sent: number; cwnd: number }[] = [];

function spin() {
  const stats = session.stats;
  samples.push({ sent: Number(stats.bytesSent), cwnd: Number(stats.cwnd) });
  if (iterations++ === ITERATIONS) {
    process.send!({ samples });
    // Graceful: chunks() returns on its next pull, the stream ends with a FIN
    // and the CONNECTION_CLOSE that follows lets the test's side finish too.
    session.close();
    return;
  }
  Bun.sleepSync(BUSY_MS);
  setImmediate(spin);
}

async function* chunks() {
  setImmediate(spin);
  while (iterations <= ITERATIONS) {
    yield Buffer.alloc(Math.max(MIN_CHUNK, CHUNK_WINDOWS * Number(session.stats.cwnd)), "pace");
  }
}

function sendOn(stream: Awaited<ReturnType<typeof session.createBidirectionalStream>>) {
  stream.closed.catch(() => {});
  stream.setBody(chunks());
}

if (mode === "listen") {
  const endpoint = await listen(
    s => {
      session = s;
      s.closed.catch(() => {});
      s.onstream = sendOn;
    },
    { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], cc },
  );
  process.send!({ port: endpoint.address.port });
} else {
  session = await connect(`127.0.0.1:${portArg}`, { alpn: "quic-test", verifyPeer: "manual", cc });
  session.closed.catch(() => {});
  await session.opened;
  sendOn(await session.createBidirectionalStream());
}
