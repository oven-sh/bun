// Regression fixture: UDPSocket.sendMany() / send() used to capture a raw
// pointer into the payload's ArrayBuffer backing store (or borrowed JSString
// storage) and then run user JS before handing that pointer to
// `bsd_sendmmsg`. In `sendMany` the user JS runs on later iterations (array
// index getters, port `valueOf()`, address `toString()`); in `send` it runs
// inside `parseAddr` (port `valueOf()`, address `toString()`) after the
// payload is captured. That JS can detach the ArrayBuffer via
// `transfer(newLen)`, which synchronously frees the old backing store, and
// the native send path then reads freed memory.
//
// The test driver spawns this fixture with `Malloc=1` so bmalloc routes
// ArrayBuffer backing stores through the system allocator, making the
// allocation visible to ASAN in sanitizer-enabled builds. Release builds fall
// through and we simply verify the correct bytes arrive at the other socket.

const mode = process.argv[2];
if (mode !== "sendMany" && mode !== "send") {
  console.error("usage: sendMany-payload-uaf-fixture.ts <sendMany|send>");
  process.exit(2);
}

const size = 4096;

let received: Buffer | undefined;
let resolve!: () => void;
const gotData = new Promise<void>(r => (resolve = r));

const server = await Bun.udpSocket({
  port: 0,
  hostname: "127.0.0.1",
  socket: {
    data(_socket, data) {
      if (received) return;
      const chunk = Buffer.from(data as ArrayBuffer);
      // In `send` mode the first call captures the payload from the
      // now-detached view (length 0). On Linux that surfaces as EFAULT and
      // nothing is sent; on Windows it succeeds and a 0-byte packet arrives
      // here before the retry loop delivers the real payload. Ignore it so
      // both platforms settle on the 4096-byte retry packet.
      if (chunk.length !== size) return;
      received = chunk;
      resolve();
    },
  },
});
const client = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1" });

try {
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

  // Unconnected socket: the port is coerced via `valueOf()` after the payload
  // JSValue has been captured, so by the time the native send path borrows a
  // raw pointer the buffer is already detached. Both send() and sendMany()
  // now observe the detached (length-0) view rather than the freed 4096-byte
  // region. sendMany substitutes a valid empty pointer and sends a 0-byte
  // packet; send()'s detached-view path may surface as EFAULT on Linux (the
  // same pre-existing behavior as `send(detachedView, ...)`) or send a 0-byte
  // packet on Windows. Either outcome is fine — the regression this fixture
  // guards is the ASAN heap-use-after-free, which aborts the process before
  // this catch ever runs.
  try {
    if (mode === "sendMany") {
      client.sendMany([payload, evilPort, "127.0.0.1"]);
    } else {
      client.send(payload, evilPort as never, "127.0.0.1");
    }
  } catch (e: any) {
    if (mode !== "send" || e?.code !== "EFAULT") throw e;
  }

  if (!detached) throw new Error("valueOf() never ran");

  // Handle unreliable transmission in UDP: the first send already exercised
  // the UAF path; retries just let the correctness assertion complete if the
  // single packet was dropped on a loaded host. Use the captured `expected`
  // bytes since the original buffer is now detached.
  function sendRec() {
    if (received || client.closed) return;
    client.send(expected, server.port, "127.0.0.1");
    setTimeout(sendRec, 10);
  }
  setTimeout(sendRec, 10);

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
