// Spawned by socket.test.ts as `bun test <this file>`: it has to run under the
// test runner because expect(promise).resolves waits by driving the event loop
// synchronously, which is what nests event-loop ticks inside the socket's data
// callback while the dispatch for that socket is still on the stack.
import { expect, test } from "bun:test";

test("a socket closed inside its data callback survives nested event-loop ticks until the dispatch returns", async () => {
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write("x");
      },
      data() {},
    },
  });

  for (let i = 0; i < 8; i++) {
    const returned = Promise.withResolvers<void>();
    const churn: Promise<void>[] = [];
    await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(socket) {
          // Closing moves the socket to the loop's closed list; it may only be
          // freed once this callback (and the dispatch that called it) is done.
          socket.terminate();
          // Nested ticks: timers, I/O and the loop's post phase all run here.
          expect(new Promise<void>(resolve => setTimeout(resolve, 5))).resolves.toBeUndefined();
          // Allocations of the same size class as the closed socket, so a
          // prematurely freed block is likely to be handed out again before
          // the outer dispatch looks at it.
          for (let j = 0; j < 16; j++) {
            churn.push(
              Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } }).then(s => s.terminate()),
            );
          }
          returned.resolve();
        },
      },
    });
    await returned.promise;
    await Promise.all(churn);
    // Let the outer dispatch unwind and the loop reach its post phase.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});
