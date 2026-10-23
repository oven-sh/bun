// A TLS connection that arrives with input while the handshake budget of the loop iteration is
// spent is parked in the handshake queue at once, and its timeout does not run there.
//
// With a deferred accept (Linux, FreeBSD) the accept path dispatches a readable event for the new
// socket itself, and over the budget that dispatch is what parks the socket. This server accepts
// 12 connections that each hold the head of a TLS record in one loop iteration: 5 are read, 7 are
// over the budget. Then it runs the timeout sweep by hand for the 4 ticks that a connection has
// to send its request. The 5 sockets that were read are linked, so their timeout comes due and
// the server closes them. The 7 must be in the queue, untouched: the server closes them only
// after the queue released them and 4 more ticks passed.
//
// The clients run in a child process, so that they can connect while this loop is blocked.
//
// Prints one JSON line: { clients, closedWhileParked, closedAfterRelease }.

import { getEventLoopStats, sweepSocketTimers } from "bun:internal-for-testing";
import { tempDir, tls as certs } from "harness";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const N = 12;
// MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION in packages/bun-usockets/src/loop.c.
const BUDGET = 5;
// The 10 s that a connection has to send its request, in sweep ticks: ceil(10 / 4) + 1.
const TIMEOUT_TICKS = 4;
// Well inside the test's own timeout, so a step that stalls ends in an error.
const STEP_DEADLINE_MS = 20_000;
// A handshake record that announces 512 more bytes.
const RECORD_HEAD = new Uint8Array([0x16, 0x03, 0x01, 0x02, 0x00]);

if (process.argv[2] === "client") {
  await client(Number(process.argv[3]), Number(process.argv[4]), process.argv[5]);
} else {
  await server();
}

async function server() {
  // The clients create this file once every record head is on its way.
  using dir = tempDir("tls-serve-deferred-accept", {});
  const everyHeadSent = join(String(dir), "every-head-sent");

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: certs.cert, key: certs.key },
    fetch: () => new Response("ok"),
  });
  // The clients answer a byte on this connection with the number of their sockets that have closed.
  let answer = Promise.withResolvers<number>();
  let ask: (() => Promise<number>) | undefined;
  const control = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, chunk) {
        answer.resolve(Number(chunk.toString()));
      },
      open(socket) {
        ask = () => {
          answer = Promise.withResolvers<number>();
          socket.write("?");
          return answer.promise;
        };
      },
    },
  });

  await using child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "client", String(server.port), String(control.port), everyHeadSent],
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });

  // The loop stays blocked until every record head is in the kernel, so one iteration accepts them all.
  const deadline = Date.now() + STEP_DEADLINE_MS;
  while (!existsSync(everyHeadSent)) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the clients to connect");
    Bun.sleepSync(5);
  }
  await iterations(1);
  sweepSocketTimers(TIMEOUT_TICKS);
  // These iterations empty the queue: every socket it held is read and linked, with its 4 ticks left.
  await iterations(Math.ceil((N - BUDGET) / BUDGET) + 2);
  if (!ask) throw new Error("the control connection did not open");
  const closedWhileParked = await ask();
  sweepSocketTimers(TIMEOUT_TICKS);
  const closedAfterRelease = await ask();

  console.log(JSON.stringify({ clients: N, closedWhileParked, closedAfterRelease }));
  child.kill();
  control.stop(true);
  await server.stop(true);
}

// An immediate runs once per loop iteration.
async function iterations(n: number) {
  const target = getEventLoopStats().iteration + n;
  while (getEventLoopStats().iteration < target) await new Promise(resolve => setImmediate(resolve));
}

async function client(port: number, controlPort: number, everyHeadSent: string) {
  let opened = 0;
  let closed = 0;
  await Bun.connect({
    hostname: "127.0.0.1",
    port: controlPort,
    socket: {
      // The closes that the server made before it asked are in the kernel already: two turns deliver them.
      data(socket) {
        setImmediate(() => setImmediate(() => socket.write(String(closed))));
      },
    },
  });
  for (let i = 0; i < N; i++) {
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.write(RECORD_HEAD);
          if (++opened === N) setImmediate(() => setImmediate(() => writeFileSync(everyHeadSent, "")));
        },
        data() {},
        error() {},
        close() {
          closed++;
        },
      },
    });
  }
}
