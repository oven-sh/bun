// Spawned by socket.test.ts ("a socket closed by a nested event loop tick run
// from its own data callback is not freed under the outer dispatch").
//
// This runs under `bun test` because `expect(promise).resolves` is the easiest
// way to spin a nested event loop tick from inside a socket callback: the
// matcher waits for the promise synchronously, ticking the loop until it
// settles, while usockets is still in the middle of dispatching the callback's
// socket. Every socket closed during those nested ticks, including that one,
// has to stay allocated until the outer tick is done with it.
import { expect, test } from "bun:test";

test("socket closed inside a nested tick run from its own data callback", async () => {
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  const { promise: dispatched, resolve: onDispatched } = Promise.withResolvers<void>();
  // Resolved from the client's data callback once the nested tick is over, i.e.
  // after the client socket was closed inside it.
  const { promise: churned, resolve: onChurned } = Promise.withResolvers<void>();

  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write("ping");
      },
      data(socket) {
        socket.end();
      },
    },
  });

  async function churn() {
    // Runs inside the nested tick, after the client socket below was closed:
    // allocate and close a few more sockets so memory freed too early gets
    // reused before the outer dispatch gets back to it.
    for (let i = 0; i < 8; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          data(socket) {
            socket.end();
          },
          close() {
            resolve();
          },
        },
      });
      await promise;
    }
    onChurned();
  }

  await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data(socket) {
        // usockets is dispatching this socket's readable event right now.
        // Answer the server, which closes the connection in response, and
        // spin the event loop from inside the dispatch until that close has
        // been delivered and some more socket traffic has happened on top.
        socket.write("pong");
        closed.then(churn);
        expect(churned).resolves.toBeUndefined();
        // Returning from here resumes the outer dispatch on this socket.
        onDispatched();
      },
      close() {
        onClosed();
      },
    },
  });

  await dispatched;
  await churned;
  console.log("ok");
});
