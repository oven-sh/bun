// Regression fixture: socket.reload() / listener.reload() must preserve
// Handlers.active_connections.
//
// Previously reload() overwrote the live counter with 0 via struct assignment.
//  - Calling reload() inside a data handler meant the enclosing callback
//    scope's exit() hit `0 - 1` on a u32 → panic in safe builds.
//  - Calling reload() outside any handler dropped the count to 0; the next
//    callback's enter/exit cycle then freed the heap-allocated client
//    Handlers while the socket still pointed at it → heap-use-after-free
//    on the following callback under ASAN.
//  - Listener.reload() with live accepted sockets zeroed the count so
//    closing any of them underflowed.
//
// This fixture drives all three sequences and exits 0 with "OK" on stdout.

import type { Socket } from "bun";

// ---------------------------------------------------------------------------
// 1) socket.reload() from inside a data handler
{
  let serverSocket!: Socket;
  const opened = Promise.withResolvers<void>();
  const gotData = Promise.withResolvers<string>();
  const closed = Promise.withResolvers<void>();

  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        serverSocket = s;
        opened.resolve();
      },
      data() {},
    },
  });

  await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data(socket, buf) {
        // reload while a Handlers.Scope is live on the stack
        socket.reload({
          socket: {
            data() {},
            drain() {},
            close() {
              closed.resolve();
            },
          },
        });
        gotData.resolve(buf.toString());
      },
      drain() {},
      close() {
        closed.resolve();
      },
    },
  });

  await opened.promise;
  serverSocket.write("hello");
  serverSocket.flush();
  const got = await gotData.promise;
  if (!got.startsWith("hello")) throw new Error("bad data: " + got);
  serverSocket.end();
  await closed.promise;
}

// ---------------------------------------------------------------------------
// 2) socket.reload() from outside a handler, then two separate onData events
{
  let serverSocket!: Socket;
  const opened = Promise.withResolvers<void>();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let chunks = "";

  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        serverSocket = s;
        opened.resolve();
      },
      data() {},
    },
  });

  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data() {},
      drain() {},
    },
  });

  await opened.promise;

  // reload with no callback scope on the stack
  client.reload({
    socket: {
      data(_s, buf) {
        chunks += buf.toString();
        if (chunks.length >= 3 && chunks.length < 6) first.resolve();
        if (chunks.length >= 6) second.resolve();
      },
      drain() {},
      close() {
        closed.resolve();
      },
    },
  });

  // First onData: before the fix, enter/exit here frees the client Handlers.
  serverSocket.write("one");
  serverSocket.flush();
  await first.promise;

  // Second onData: before the fix, this dereferences the freed Handlers.
  serverSocket.write("two");
  serverSocket.flush();
  await second.promise;

  if (chunks !== "onetwo") throw new Error("bad data: " + chunks);
  serverSocket.end();
  await closed.promise;
}

// ---------------------------------------------------------------------------
// 3) Listener.reload() with a live accepted socket, then close it
{
  let serverSocket!: Socket;
  const opened = Promise.withResolvers<void>();
  const serverClosed = Promise.withResolvers<void>();
  const clientClosed = Promise.withResolvers<void>();

  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        serverSocket = s;
        opened.resolve();
      },
      data() {},
      close() {
        serverClosed.resolve();
      },
    },
  });

  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data() {},
      drain() {},
      close() {
        clientClosed.resolve();
      },
    },
  });

  await opened.promise;

  // reload the listener while 1 accepted socket is still active
  server.reload({
    socket: {
      open() {},
      data() {},
      close() {
        serverClosed.resolve();
      },
    },
  });

  // Close the accepted socket: drives handlers.markInactive() on the
  // listener's handlers. Underflows without the fix.
  client.end();
  await clientClosed.promise;
  await serverClosed.promise;
  server.stop(true);
}

console.log("OK");
