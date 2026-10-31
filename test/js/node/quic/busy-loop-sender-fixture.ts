// Connects to 127.0.0.1:argv[2], streams 512 KiB chunks from a busy event loop,
// and prints the smallest congestion window of the second half as { minCwnd }.
import { connect, type SessionOptions } from "node:quic";

const ITERATIONS = 60;
const chunk = Buffer.alloc(512 * 1024, "cwnd");
let iterations = 0;
let minCwnd = Infinity;

// The Initial is on the wire when connect() returns. Blocking here makes the first RTT sample 30 ms.
const connecting = connect(`127.0.0.1:${process.argv[2]}`, { alpn: "quic-test", verifyPeer: "manual" } as SessionOptions);
Bun.sleepSync(30);
const session = await connecting;
session.closed.catch(() => {});
await session.opened;

// A few rounds of ACKs on a free loop, so the controller also sees the real loopback RTT.
function freeRun() {
  if (Number(session.stats.bytesSent) < 256 * 1024) setImmediate(freeRun);
  else busyLoop();
}

function busyLoop() {
  if (++iterations > ITERATIONS / 2) minCwnd = Math.min(minCwnd, Number(session.stats.cwnd));
  if (iterations === ITERATIONS) {
    console.log(JSON.stringify({ minCwnd }));
    session.close();
    return;
  }
  Bun.sleepSync(12);
  setImmediate(busyLoop);
}

const stream = await session.createBidirectionalStream();
stream.closed.catch(() => {});
stream.setBody(
  (async function* () {
    setImmediate(freeRun);
    while (iterations < ITERATIONS) yield chunk;
  })(),
);
