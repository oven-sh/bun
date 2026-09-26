import { socketFaultInjection as fault } from "bun:internal-for-testing";
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

let round = 0;
let checkpointPending = false;
const closed: string[] = [];
const finished = Promise.withResolvers<{ closed: string[]; replyBeforeCheckpoint: boolean }>();
const connect = (socket: Bun.SocketHandler) => Bun.connect({ hostname: "127.0.0.1", port, socket });

const probe = await connect({
  // The answer to what the refused socket's handler wrote.
  data: () => finished.resolve({ closed, replyBeforeCheckpoint: checkpointPending }),
  error: (_, error) => finished.reject(error),
});
const refused = await connect({
  data() {},
  close() {
    closed.push("refused");
    checkpointPending = true;
    queueMicrotask(() => (checkpointPending = false));
    probe.write("x");
    // Long enough for the echo to be waiting before this handler returns.
    const until = performance.now() + 10;
    while (performance.now() < until);
  },
  error() {},
});
const clock = await connect({
  // One round per tick.
  data(socket) {
    round++;
    if (round === 1) {
      refused.pause();
    } else if (round === 4) {
      // The kernel is asked about the socket again, and that request is refused.
      fault.set({ syscall: "poll_start", action: "errno", errno: 10055, fd: refused.fd, repeat: -1 });
      refused.resume();
    }
    if (closed.length === 0) socket.write("tick");
  },
  error: (_, error) => finished.reject(error),
});
clock.write("tick");

// `.resolves` blocks until the promise settles by ticking the event loop from inside this call:
// the callbacks of one such tick share a single microtask checkpoint, after the tick.
let result: unknown;
expect(finished.promise.then(value => (result = value))).resolves.toBeDefined();
fault.clear();
console.log(JSON.stringify(result));
probe.end();
clock.end();
