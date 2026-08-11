// Sends a stream of large chunks from a process whose event loop is busy and
// reports, over IPC, the smallest congestion window the sending session used
// during the second half of that. Spawned by quic-endpoint.test.ts, which is
// the receiving end.
//
//   busy-loop-sender-fixture.ts listen [cc]          send on the first stream
//                                                    the peer opens
//   busy-loop-sender-fixture.ts connect <port> [cc]  open a stream to the
//                                                    test's server and send
//
// Both modes block the thread for SETUP_BLOCK_MS while the session's first
// round trip is in flight (a server doing work in its session callback, a
// client doing work right after connect()), so the first RTT sample lsquic
// takes on the connection is that long. An engine left in lsquic's "adaptive"
// mode makes its Cubic-or-BBRv1 choice from that sample (threshold 1.5 ms), so
// this makes it pick BBRv1 every time; with plain loopback samples the pick
// would depend on what else the loop happened to be doing.
//
// Once the transfer starts the loop is left idle for a moment, so the
// controller sees the real loopback RTT at least once, then paced with
// Bun.sleepSync for ITERATIONS iterations of BUSY_MS. BBRv1 is down to its
// 4-packet floor (5840 bytes) within 20 to 30 iterations of that and returns
// to it within a few rounds after every bump ACK bunching gives it, so the
// minimum over the second half is the floor; Cubic, which only reacts to
// loss, stays at 100 KiB or more throughout (bounded by the receiver's UDP
// buffer).
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const SETUP_BLOCK_MS = 30;
const IDLE_BEFORE_WINDOW_MS = 20;
const ITERATIONS = 60;
const BUSY_MS = 12;
// Larger than any window either controller reaches here, so every tick is
// limited by the congestion window rather than by what the application had
// queued (application-limited rounds never let BBRv1 leave startup).
const CHUNK = Buffer.alloc(512 * 1024, "cwnd");

const [mode, ...rest] = process.argv.slice(2);
const port = mode === "connect" ? Number(rest.shift()) : undefined;
const cc = rest.shift() as "reno" | "cubic" | "bbr" | undefined;

let session: Awaited<ReturnType<typeof connect>>;
let iterations = 0;
let minCwnd = Infinity;

function spin() {
  iterations++;
  if (iterations > ITERATIONS / 2) {
    minCwnd = Math.min(minCwnd, Number(session.stats.cwnd));
  }
  if (iterations === ITERATIONS) {
    process.send!({ minCwnd });
    // Graceful: chunks() stops on its next pull, the stream ends with a FIN
    // and the CONNECTION_CLOSE that follows lets the test's side close too.
    session.close();
    return;
  }
  Bun.sleepSync(BUSY_MS);
  setImmediate(spin);
}

async function* chunks() {
  setTimeout(spin, IDLE_BEFORE_WINDOW_MS);
  while (iterations < ITERATIONS) yield CHUNK;
}

if (mode === "listen") {
  const endpoint = await listen(
    s => {
      session = s;
      s.closed.catch(() => {});
      Bun.sleepSync(SETUP_BLOCK_MS);
      s.onstream = stream => {
        stream.closed.catch(() => {});
        stream.setBody(chunks());
      };
    },
    { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"], cc },
  );
  process.send!({ port: endpoint.address.port });
} else {
  // connect() has put the Initial on the wire by the time it returns.
  const connecting = connect(`127.0.0.1:${port}`, { alpn: "quic-test", verifyPeer: "manual", cc });
  Bun.sleepSync(SETUP_BLOCK_MS);
  session = await connecting;
  session.closed.catch(() => {});
  await session.opened;
  const stream = await session.createBidirectionalStream();
  stream.closed.catch(() => {});
  stream.setBody(chunks());
}
