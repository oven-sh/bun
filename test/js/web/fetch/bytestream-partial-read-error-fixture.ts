// The same stale bookkeeping as bytestream-partial-read-fixture.ts, reached through the stream's
// own pull loop: a text-mode reader takes one pull view out of the buffered bytes, the connection
// resets, and the reader reads on. `append(Err)` dropped the buffer and kept the index, so the
// next pull's `drain()` aborted the process:
//
//   panic: range end index 262144 out of range for slice of length 0
//
// The failure comes from the HTTP thread, so the fixture stages the read, resets, and settles with
// a growing budget; it retries when a run does not reach the state and reports that it did not.
import { once } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";

const VIEW = 256 * 1024; // nativeSourceDefaultChunkSize (BunStreamSource.cpp)
const HEAD = 64 * 1024;
const notes: string[] = [];

for (let attempt = 1; attempt <= 5; attempt++) {
  const settle = 20 * attempt;
  const sockets: net.Socket[] = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.on("error", () => {});
    socket.once("data", async () => {
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 64000000\r\n\r\n");
      socket.write(Buffer.alloc(HEAD, "h"));
      // The head arrives before the reader exists, the rest while it is idle.
      await Bun.sleep(settle);
      socket.write(Buffer.alloc(1 << 20, "b"));
    });
  });
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", onListening);
  await listening;
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/`);
  const reader = res.textStream().getReader();
  await Bun.sleep(settle * 3);

  // Hands out the head and starts the pull that takes one view out of the buffered bytes,
  // leaving the rest behind the consumed-prefix index.
  const first = await reader.read();
  const cleanup = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  if (first.done || first.value.length !== HEAD) {
    notes.push(`attempt ${attempt}: first read ${first.done ? "done" : first.value.length}, want ${HEAD}`);
    cleanup();
    continue;
  }

  for (const socket of sockets) socket.resetAndDestroy();
  await once(sockets[0], "close");
  await Bun.sleep(settle);

  // The view the pull took is still queued on the stream. The bytes behind it went with the
  // failed body, so the read after it has to report the failure.
  let outcome: string | undefined;
  const second = await reader.read().catch((e: NodeJS.ErrnoException) => {
    outcome = `rejected ${e.code ?? e.name}`;
    return undefined;
  });
  if (!outcome) {
    if (second!.done || second!.value.length !== VIEW) {
      notes.push(`attempt ${attempt}: second read ${second!.done ? "done" : second!.value.length}, want ${VIEW}`);
      cleanup();
      continue;
    }
    outcome = await reader.read().then(
      r => `read returned ${r.done ? "done" : `${r.value.length} bytes`}`,
      (e: NodeJS.ErrnoException) => `rejected ${e.code ?? e.name}`,
    );
  }
  cleanup();
  console.log(outcome.startsWith("rejected ") ? "ok" : `BAD ${outcome}`);
  process.exit(0);
}

console.log(`BAD never staged: ${notes.join("; ")}`);
