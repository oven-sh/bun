// Receives stream bodies and reports over IPC the largest number of packets
// the endpoint read in one iteration of the event loop. Spawned by
// quic-endpoint.test.ts, which connects and sends the bodies.
//
// A sender only gets ahead of a receiver that is busy, so the receiver stalls
// once while the body arrives: the sender fills its window in that time, and
// the iteration after the stall starts with a backlog on the socket.
import { getEventLoopStats } from "bun:internal-for-testing";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const STALL_AFTER_PACKETS = 200;
const STALL_MS = 50;

const endpoint = await listen(
  session => {
    session.closed.catch(() => {});
    session.onstream = async stream => {
      stream.closed.catch(() => {});
      const first = Number(endpoint.stats.packetsReceived);
      let seen = first;
      let iteration = getEventLoopStats().iteration;
      let max = 0;
      let stalled = false;
      let sampling = true;
      setImmediate(function sample() {
        if (!sampling) return;
        const packets = Number(endpoint.stats.packetsReceived);
        const now = getEventLoopStats().iteration;
        // An immediate runs once per iteration, so this is what one iteration read.
        if (now - iteration === 1) max = Math.max(max, packets - seen);
        seen = packets;
        iteration = now;
        if (!stalled && packets - first >= STALL_AFTER_PACKETS) {
          stalled = true;
          Bun.sleepSync(STALL_MS);
        }
        setImmediate(sample);
      });
      try {
        for await (const _ of stream);
      } catch {
        // The test destroys its session once it has the report.
      }
      sampling = false;
      process.send!({ max, stalled, packets: Number(endpoint.stats.packetsReceived) - first });
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
);
process.send!({ port: endpoint.address.port });
