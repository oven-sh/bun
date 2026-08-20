// Closes a client from the continuation of one of its own replies, drops the
// last reference to it and collects, all before the socket read that delivered
// the reply has returned. The read then finishes up on a client whose JS
// wrapper is dead but not finalized yet.
//
// The collector scans the native stack conservatively, so a stale copy of the
// wrapper's address anywhere between the collector's frame and the stack base
// keeps it alive. Every native call that receives the wrapper (constructor,
// connect, get, close) can spill it into its frame. scrub() overwrites the
// stack below the calling frame right after each of those calls. Without it,
// release builds only reached the window on the first round.
//
// A round can still miss the window: a live frame above the scrub can hold the
// address (one Linux aarch64 CI lane missed round 2 every time). So a round
// that misses is reported and skipped. The run passes if at least one of the
// ten rounds reached the window and came back from the read, and fails
// otherwise. The last line prints how many rounds reached it.
import { RedisClient } from "bun";
import { jscInternals } from "bun:internal-for-testing";

const CRLF = "\r\n";
const bulk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;
const HELLO_REPLY = `%2${CRLF}` + bulk("server") + bulk("redis") + bulk("proto") + `:3${CRLF}`;

// Commands are sent one at a time, so a chunk is either the HELLO handshake or
// a single command.
using server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, chunk) {
      socket.write(chunk.includes("HELLO") ? HELLO_REPLY : `:0${CRLF}`);
    },
    error() {},
    close() {},
  },
});

// JSC serves the first 8 instances of a class from cells that it finalizes at
// the end of every collection. Keeping 8 alive puts the clients below in
// ordinary blocks, whose dead cells are only finalized when the block is swept
// some time after the collection.
const lowerTier = Array.from({ length: 8 }, () => new RedisClient("redis://127.0.0.1:1", { autoReconnect: false }));

// Runs a recursion whose frames initialise all their locals, so the stack below
// the caller holds no stale copy of the wrapper. A fresh function each time:
// JSC would otherwise tier the recursion up to the optimising JIT after a few
// thousand calls, and that tier keeps the locals in registers and writes
// nothing to the stack. Not a tail call, so the recursion is not collapsed
// into one frame.
function scrub(depth: number): number {
  const fresh = new Function(
    "depth",
    `const self = n => {
       let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0;
       let a8 = 0, a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0;
       if (n === 0) return a0;
       const below = self(n - 1);
       return below + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 + a13 + a14 + a15;
     };
     return self(depth);`,
  );
  return fresh(depth);
}

let address: bigint;

async function useAndCloseClient() {
  let client: RedisClient | undefined = new RedisClient(`redis://127.0.0.1:${server.port}`, {
    autoReconnect: false,
  });
  address = jscInternals.rawCellAddress(client);
  const connected = client.connect();
  scrub(256);
  await connected;
  const reply = client.get("k");
  scrub(256);
  await reply;
  // Still inside the socket read that delivered the GET reply.
  client.close();
  scrub(256);
  // A suspended async function keeps its locals in a heap frame that is only
  // rewritten for variables still live at the next await, so clear the
  // variable and keep it live across one more suspension.
  client = undefined;
  await null;
  return client;
}

async function hop() {
  await null;
}

// The conservative stack scan can keep the wrapper alive by chance (a stale
// slot in a live native frame), and which round that hits differs per build
// and platform. A round that misses the window is reported and skipped; the
// run fails only if no round reached it, so a pass always means the socket
// read ran against a dead wrapper at least once.
let reached = 0;
for (let round = 0; round < 10; round++) {
  const done = useAndCloseClient();
  scrub(256);
  await done;
  // Resuming other async functions overwrites the stack slots that still point
  // at useAndCloseClient's frame; until then the collector still sees the client.
  await hop();
  await hop();
  await hop();
  scrub(256);
  const nextTick = new Promise<void>(resolve => setTimeout(resolve, 0));
  // Synchronous collection without a sweep: the wrapper is dead and not
  // finalized when this microtask drain returns into the socket read.
  jscInternals.collectSyncWithoutSweep();
  const dead = !jscInternals.isLiveCellAtRawAddress(address!);
  // Return into the socket read before anything else happens.
  await nextTick;
  if (dead) {
    reached++;
    console.log(`round ${round} survived`);
  } else {
    console.log(`round ${round} skipped: the wrapper survived the collection`);
  }
}
if (reached === 0) {
  throw new Error("no round reached the dead-but-unswept window");
}
console.log(`${reached} rounds reached the window`);

for (const client of lowerTier) client.close();
