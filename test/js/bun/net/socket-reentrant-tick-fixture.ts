import type { Socket } from "bun";
import { expect } from "bun:test";
import { readFile } from "node:fs/promises";

const connections = 16;

using echo = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, chunk) {
      socket.write(chunk);
    },
  },
});

// Settles only after a socket round trip, so waiting on it synchronously has to run the event loop.
async function roundTrip() {
  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: echo.port,
    socket: {
      data(_, chunk) {
        resolve(chunk.toString());
      },
    },
  });
  socket.write("ping");
  const echoed = await promise;
  socket.end();
  return echoed;
}

const peers: Socket[] = [];
const allAccepted = Promise.withResolvers<void>();
using server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      peers.push(socket);
      if (peers.length === connections) allAccepted.resolve();
    },
    data() {},
  },
});

let reentered = false;
const handlerReturned = Promise.withResolvers<void>();
// "ping" only if the handler really waited for the round trip before it returned.
let echoedBeforeHandlerReturned: string | undefined;
const received = Array.from({ length: connections }, () => "");
let expectedLength = 1;
let roundDone = Promise.withResolvers<void>();

const clients: Socket[] = [];
for (let i = 0; i < connections; i++) {
  clients.push(
    await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(_, chunk) {
          received[i] += chunk.toString();
          if (!reentered) {
            reentered = true;
            let echoed: string | undefined;
            // `.resolves` blocks until the promise settles by ticking the event loop from inside this callback.
            expect(roundTrip().then(value => (echoed = value))).resolves.toBe("ping");
            echoedBeforeHandlerReturned = echoed;
            handlerReturned.resolve();
          }
          if (received.every(bytes => bytes.length === expectedLength)) roundDone.resolve();
        },
      },
    }),
  );
}
await allAccepted.promise;

// One synchronous burst: every client is readable before the loop polls again,
// so the handler that re-enters the loop runs with the others still undelivered.
for (const peer of peers) peer.write("a");
await roundDone.promise;

// Every socket still has to be armed after the nested tick.
expectedLength = 2;
roundDone = Promise.withResolvers<void>();
for (const peer of peers) peer.write("b");
await roundDone.promise;

// A completion posted from another thread still has to wake the loop.
const source = await readFile(import.meta.path, "utf8");

// Everything above can run from inside the handler's wait.
await handlerReturned.promise;

console.log(JSON.stringify({ echoedBeforeHandlerReturned, received, readFile: source.length > 0 }));
for (const client of clients) client.end();
