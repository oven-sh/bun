// Spawned by tcp-server.test.ts "should not leak memory". The counts below are
// heap-wide, and a `bun test --parallel` worker runs several files in one heap,
// so the check has to run in a process of its own. It mirrors the echo tests
// of that file: a `using` listener and a client per binaryType. It does not
// import "harness": that costs over a second of startup in a debug build.
import { heapStats } from "bun:jsc";
import { expect } from "bun:test";

const BINARY_TYPES = ["arraybuffer", "uint8array", "buffer"] as const;
const ROUND_TRIPS_PER_TYPE = 4;
const DATA_CLASS = { arraybuffer: ArrayBuffer, uint8array: Uint8Array, buffer: Buffer };

type BinaryType = (typeof BINARY_TYPES)[number];

async function echoRoundTrip(hostname: string, port: number, binaryType: BinaryType) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  await Bun.connect({
    hostname,
    port,
    socket: {
      binaryType,
      open(socket) {
        socket.write("ping");
      },
      data(socket, data) {
        // Not toBeInstanceOf: a Buffer is also a Uint8Array.
        expect(data.constructor).toBe(DATA_CLASS[binaryType]);
        socket.end();
      },
      close() {
        resolve();
      },
      error(_, error) {
        reject(error);
      },
      connectError(_, error) {
        reject(error);
      },
    },
  });
  await promise;
}

// Everything that touches a Listener or a TCPSocket stays inside this function,
// so no frame below the count still holds one.
async function run(binaryType: BinaryType) {
  let closedOnServer = 0;
  const allClosedOnServer = Promise.withResolvers<void>();
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      binaryType,
      open() {},
      data(socket, data) {
        socket.write(data);
      },
      close() {
        if (++closedOnServer === ROUND_TRIPS_PER_TYPE) allClosedOnServer.resolve();
      },
    },
  });
  for (let i = 0; i < ROUND_TRIPS_PER_TYPE; i++) {
    await echoRoundTrip(server.hostname, server.port, binaryType);
  }
  await allClosedOnServer.promise;
}

function liveObjects(type: string): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts[type] ?? 0;
}

// The native side releases a closed socket's wrapper one event loop turn after
// the close callback, and a debug build keeps two more reachable for about a
// second, so poll with a deadline like harness's expectMaxObjectTypeCount.
async function expectAtMost(type: string, max: number) {
  const deadline = performance.now() + 2000;
  while (liveObjects(type) > max && performance.now() < deadline) {
    await Bun.sleep(20);
  }
  expect(liveObjects(type)).toBeLessThanOrEqual(max);
}

for (const binaryType of BINARY_TYPES) {
  await run(binaryType);
}

// 2 is the prototype and the constructor.
await expectAtMost("Listener", 2);
// The Windows slack for one more pair of sockets dates from #29538.
await expectAtMost("TCPSocket", process.platform === "win32" ? 4 : 2);
