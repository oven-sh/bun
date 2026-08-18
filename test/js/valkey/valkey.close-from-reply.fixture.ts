// Closes a client from the continuation of one of its own replies, drops the
// last reference to it and collects, all before the socket read that delivered
// the reply has returned. The read then finishes up on a client whose JS
// wrapper is dead but not finalized yet. Prints one line per round that
// survives that.
import { RedisClient } from "bun";
import { fullGC } from "bun:jsc";

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

async function useAndCloseClient() {
  const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  await client.connect();
  await client.get("k");
  // Still inside the socket read that delivered the GET reply.
  client.close();
}

async function hop() {
  await null;
}

for (let round = 0; round < 3; round++) {
  await useAndCloseClient();
  // Resuming other async functions overwrites the stack slots that still point
  // at useAndCloseClient's frame; until then the collector still sees the client.
  await hop();
  await hop();
  await hop();
  const nextTick = new Promise<void>(resolve => setTimeout(resolve, 0));
  // Synchronous collection without a sweep: the wrapper is dead and not
  // finalized when this microtask drain returns into the socket read.
  fullGC();
  // Return into the socket read before anything else happens.
  await nextTick;
  console.log(`round ${round} survived`);
}

for (const client of lowerTier) client.close();
