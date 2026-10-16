// Both ends of one node:quic connection, in one process. The server answers
// every stream with stream.setBody(buffer). The client reads the answers.
// The process measures its own CPU time until <measured MiB> of answers have
// arrived, for two kinds of answer:
//
//   whole   one body of <body MiB>, handed to the stream in one piece
//   pieces  bodies of 64 KiB, one stream after another
//
// The client's stream window is 16 KiB. lsquic takes at most one window in a
// write, so the rest of the whole body stays queued for many writes. The
// stream of the whole body is destroyed when the measurement ends.
//
// The clock starts when the first answer is queued. The one copy of the whole
// body into the queue costs what the allocator charges for a large block, and
// that is not the cost of the writes.
//
// usage: bun outbound-body-cpu-fixture.ts <body MiB> <measured MiB>
//
// Prints one JSON line: { pieces, whole, blockedWrites }
//   pieces, whole   CPU time in microseconds, the lowest of three interleaved runs
//   blockedWrites   the writes of a whole body that lsquic took only a part of, all runs
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, type SessionOptions } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const WINDOW = 16 * 1024;
const PIECE = 64 * 1024;
const BODY = Number(process.argv[2]) * 1024 * 1024;
const MEASURED = Number(process.argv[3]) * 1024 * 1024;

const whole = Buffer.alloc(BODY, "whole");
const piece = Buffer.alloc(PIECE, "piece");
const request = Buffer.from("get");

let answer: Buffer = piece;
let answering: any;
let queued: NodeJS.CpuUsage | undefined;
let blockedWrites = 0;

const server = await listen(
  (session: any) => {
    session.closed.catch(() => {});
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      for await (const _ of stream);
      if (answer === whole) stream.onblocked = () => blockedWrites++;
      answering = stream;
      stream.setBody(answer);
      queued ??= process.cpuUsage();
    };
  },
  { sni: { "*": { keys: [key], certs: [cert] } }, alpn: ["body-cpu"] },
);

const client = await connect(server.address!, {
  alpn: "body-cpu",
  verifyPeer: "manual",
  transportParams: { initialMaxStreamDataBidiLocal: WINDOW },
} as SessionOptions);
client.closed.catch(() => {});
await client.opened;

async function cpuTimeUntilArrived(body: Buffer) {
  answer = body;
  queued = undefined;
  let arrived = 0;
  while (arrived < MEASURED) {
    const stream = await client.createBidirectionalStream({ body: request });
    stream.closed.catch(() => {});
    for await (const batch of stream) {
      for (const chunk of batch) arrived += chunk.byteLength;
      if (arrived >= MEASURED) break;
    }
  }
  const { user, system } = process.cpuUsage(queued);
  answering.destroy();
  return user + system;
}

// Not measured: the first streams of a connection pay for its setup.
await cpuTimeUntilArrived(piece);

// The lowest of three interleaved runs each, so that a busy machine does not decide the ratio.
let pieces = Infinity;
let wholeBody = Infinity;
for (let run = 0; run < 3; run++) {
  pieces = Math.min(pieces, await cpuTimeUntilArrived(piece));
  wholeBody = Math.min(wholeBody, await cpuTimeUntilArrived(whole));
}

console.log(JSON.stringify({ pieces, whole: wholeBody, blockedWrites }));
client.destroy();
server.destroy();
