import { expect } from "bun:test";

// In its own process, so that it answers while this thread is busy.
await using echo = Bun.spawn({
  cmd: [
    process.execPath,
    "-e",
    `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(socket, chunk) { socket.write(chunk); } } });
     console.log(server.port);`,
  ],
  env: process.env,
  stdout: "pipe",
  stderr: "inherit",
});
const reader = echo.stdout.getReader();
const port = Number(new TextDecoder().decode((await reader.read()).value).trim());
reader.releaseLock();

const rounds = 40;
let round = 0;
let repliesBeforeCheckpoint = 0;
let checkpointPending = false;
const finished = Promise.withResolvers<{ rounds: number; repliesBeforeCheckpoint: number }>();

const toggled = await Bun.connect({
  hostname: "127.0.0.1",
  port,
  socket: { data() {}, error: (_, error) => finished.reject(error) },
});
const pinged = await Bun.connect({
  hostname: "127.0.0.1",
  port,
  socket: {
    data(socket) {
      if (checkpointPending) repliesBeforeCheckpoint++;
      if (++round === rounds) return finished.resolve({ rounds: round, repliesBeforeCheckpoint });
      checkpointPending = true;
      queueMicrotask(() => (checkpointPending = false));
      socket.write("ping");
      // What the Windows loop has asked the kernel about a socket is replaced only when the socket
      // wants more than that. Paused with data on its way: the request comes back and, a tick
      // later, is made again without read interest. Resumed once that one is in flight: it has to
      // be withdrawn, and its withdrawal arrives together with the next reply.
      if (round % 4 === 1) {
        toggled.pause();
        toggled.write("x");
      } else if (round % 4 === 3) {
        toggled.resume();
      }
      // Long enough for the echo of the ping to be waiting before this tick is over.
      const until = performance.now() + 10;
      while (performance.now() < until);
    },
    error: (_, error) => finished.reject(error),
  },
});
pinged.write("ping");

// `.resolves` blocks until the promise settles by ticking the event loop from inside this call:
// the callbacks of one such tick share a single microtask checkpoint, after the tick.
let result: unknown;
expect(finished.promise.then(value => (result = value))).resolves.toBeDefined();
console.log(JSON.stringify(result));
pinged.end();
toggled.end();
