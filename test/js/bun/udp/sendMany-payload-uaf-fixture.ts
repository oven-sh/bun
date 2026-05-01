// Regression fixture: UDPSocket.sendMany() used to capture a raw pointer into
// each payload's ArrayBuffer backing store (or borrowed JSString storage) and
// then keep iterating the input array. Subsequent iterations can run user JS
// — array index getters, port `valueOf()`, address `toString()` — which can
// detach an earlier payload's ArrayBuffer via `transfer(newLen)` and free its
// backing store synchronously. If sendMany does not copy the payload bytes
// into its arena, the pointer it hands to `bsd_sendmmsg` is dangling and ASAN
// reports a heap-use-after-free.
//
// The test driver spawns this fixture with `Malloc=1` so bmalloc routes
// ArrayBuffer backing stores through the system allocator, making the
// allocation visible to ASAN in sanitizer-enabled builds. Release builds fall
// through and we simply verify the correct bytes arrive at the other socket.

const server = await Bun.udpSocket({
  port: 0,
  socket: {
    data(_socket, data) {
      received = Buffer.from(data as ArrayBuffer);
      resolve();
    },
  },
});
const client = await Bun.udpSocket({ port: 0 });

let received: Buffer | undefined;
let resolve!: () => void;
const gotData = new Promise<void>(r => (resolve = r));

try {
  const size = 4096;
  const buf = new ArrayBuffer(size);
  const payload = new Uint8Array(buf);
  for (let i = 0; i < size; i++) payload[i] = i & 0xff;
  const expected = Buffer.from(payload);

  let detached = false;
  const evilPort = {
    valueOf() {
      if (!detached) {
        detached = true;
        // `transfer(newLen)` with newLen != byteLength allocates a new
        // backing store, copies, and synchronously frees the old one (the
        // `ArrayBufferContents` destructor runs before `transfer` returns).
        // Plain `transfer()` would only move the pointer, not free it.
        buf.transfer(0);
      }
      return server.port;
    },
  };

  // Unconnected socket: [payload, port, address] triples. The port is coerced
  // via `valueOf()` after the payload pointer for the same triple has already
  // been captured, so by the time sendMany calls the native send path the
  // first payload pointer refers to freed memory.
  const sent = client.sendMany([payload, evilPort, "127.0.0.1"]);

  if (!detached) throw new Error("valueOf() never ran");
  if (sent !== 1) throw new Error(`expected 1 packet sent, got ${sent}`);

  await gotData;

  if (!received) throw new Error("no data received");
  if (received.length !== size) {
    throw new Error(`expected ${size} bytes, got ${received.length}`);
  }
  if (!received.equals(expected)) {
    throw new Error("received payload does not match original bytes");
  }

  console.log("OK");
} finally {
  client.close();
  server.close();
}
