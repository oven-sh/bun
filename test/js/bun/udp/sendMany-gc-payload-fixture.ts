// Regression fixture: UDPSocket.sendMany() must not hold borrowed raw
// pointers into payload backing stores across user-JS re-entrance.
//
// The loop used to store `slice.ptr` from each ArrayBuffer / JSString into
// arena memory (not GC-scanned) and only later call `parseAddr`, which
// invokes `port.valueOf()` / `address.toString()`. That user JS can:
//   (a) drop the only reference to an earlier payload and force a GC, or
//   (b) detach an earlier ArrayBuffer via `ArrayBuffer.prototype.transfer()`.
// In either case the stored pointer is left dangling and `sendmmsg` reads
// freed heap bytes straight onto the wire.
//
// (a) is hard to reproduce in a debug build because JSC's conservative
// stack scan tends to find the payload's JSValue in a dead stack slot in
// the unoptimized `sendMany` frame, so this fixture exercises (b) — the
// same borrowed-pointer-across-user-JS root cause — deterministically. Run
// with `Malloc=1` so bmalloc/Gigacage allocations go through the system
// allocator and ASAN can see the free.

const kind = process.argv[2];
if (kind !== "detach-arraybuffer" && kind !== "gc-string") {
  console.error("usage: sendMany-gc-payload-fixture.ts <detach-arraybuffer|gc-string>");
  process.exit(2);
}

const received: Buffer[] = [];
let resolveReceived!: () => void;
const gotEnough = new Promise<void>(r => (resolveReceived = r));

const server = await Bun.udpSocket({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(_socket, data) {
      received.push(Buffer.from(data));
      if (received.length >= 2) resolveReceived();
    },
  },
});

const client = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });

let fired = false;
let packets: unknown[];
let expectFirst: string;
const expectedSecond = "sentinel";

if (kind === "detach-arraybuffer") {
  // Deterministic: detach the first payload's ArrayBuffer from inside the
  // first triple's port `valueOf()`. Without the fix, `payloads[0]` already
  // holds a raw pointer into the freed backing store and `sendmmsg` reads
  // it → ASAN heap-use-after-free (with Malloc=1). With the fix, the slice
  // is taken after all user JS has run and the detached view yields a
  // zero-length payload.
  const ab = new ArrayBuffer(256);
  new Uint8Array(ab).fill(0x41);
  const evilPort = {
    valueOf() {
      if (!fired) {
        fired = true;
        ab.transfer(4096); // frees the old 256-byte backing store
      }
      return server.port;
    },
  };
  expectFirst = ""; // detached → zero-length datagram
  // prettier-ignore
  packets = [
    new Uint8Array(ab), evilPort,    "127.0.0.1",
    expectedSecond,     server.port, "127.0.0.1",
  ];
} else {
  // Best-effort exercise of the GC path. Conservative stack scanning may
  // keep the payload alive in debug builds, so this case only asserts that
  // the received bytes match what was sent (which will also hold if the
  // payload was never collected). It still trips ASAN whenever the
  // conservative scan happens not to pin the payload.
  const makePayload = () => Buffer.alloc(256, "A").toString();
  const evilPort = {
    valueOf() {
      if (!fired) {
        fired = true;
        packets[0] = null;
        Bun.gc(true);
        for (let i = 0; i < 64; i++) new Uint8Array(256).fill(0x5a);
        Bun.gc(true);
      }
      return server.port;
    },
  };
  expectFirst = Buffer.alloc(256, "A").toString();
  // prettier-ignore
  packets = [
    makePayload(),  evilPort,    "127.0.0.1",
    expectedSecond, server.port, "127.0.0.1",
  ];
}

const sent = client.sendMany(packets);
if (sent !== 2) throw new Error(`expected sendMany to send 2 packets, got ${sent}`);
if (!fired) throw new Error("valueOf() never ran");

await gotEnough;

// UDP over loopback with two back-to-back sendmmsg packets almost always
// preserves order, but compare as a set so the assertion is stable.
const texts = received.map(b => b.toString("binary")).sort();
const want = [expectFirst, expectedSecond].sort();
if (texts.length !== 2 || texts[0] !== want[0] || texts[1] !== want[1]) {
  const got = texts.map(t => `len=${t.length} head=${JSON.stringify(t.slice(0, 32))}`);
  throw new Error(`received packets did not match expected: got ${JSON.stringify(got)}`);
}

client.close();
server.close();
console.log("OK");
