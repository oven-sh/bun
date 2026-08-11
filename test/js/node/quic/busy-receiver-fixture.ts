// Receives a stream body on an event loop that is busy between turns and
// reports over IPC how many packets the endpoint read in each turn. Spawned by
// quic-endpoint.test.ts, which connects and sends the body.
//
// A turn is one setImmediate callback that blocks for BUSY_MS. The peer is
// idle, so whatever the acks sent during one turn let it send has been queued
// on this endpoint's socket well before the next turn polls: every turn starts
// with a backlog, and what one turn reads of it is what the test asserts on.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const TURNS = 12;
const BUSY_MS = 20;

const endpoint = await listen(
  session => {
    session.closed.catch(() => {});
    session.onstream = async stream => {
      stream.closed.catch(() => {});
      const packetsPerTurn: number[] = [];
      let seen = Number(endpoint.stats.packetsReceived);
      setImmediate(function turn() {
        const now = Number(endpoint.stats.packetsReceived);
        packetsPerTurn.push(now - seen);
        seen = now;
        if (packetsPerTurn.length === TURNS) {
          process.send!({ packetsPerTurn });
          return;
        }
        Bun.sleepSync(BUSY_MS);
        setImmediate(turn);
      });
      try {
        for await (const _ of stream);
      } catch {
        // The test destroys its session once it has the report.
      }
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["quic-test"] },
);
process.send!({ port: endpoint.address.port });
