// Regression fixture for the TLS low-priority handshake queue.
//
// uSockets throttles concurrent TLS handshakes: when the per-tick budget (5)
// is exhausted, the readable dispatch PARKS the socket in the loop-wide
// low-priority queue (loop->data.low_prio_head), unlinking it from
// group->head_sockets (the two lists share the prev/next fields) and
// disabling READABLE on its poll.
//
// A parked socket can still get a WRITABLE dispatch. If its handshake flight
// is backpressured, us_internal_ssl_on_writable retries the BIO write, and
// us_socket_raw_write re-issues us_poll_change(READABLE|WRITABLE); readable
// is now back on a socket that is still in the low-prio queue. The next
// readable dispatch with an exhausted budget used to park it a SECOND time:
// us_internal_socket_group_unlink_socket(g, s) ran on a socket whose
// prev/next are low-prio-queue links, cross-wiring group->head_sockets with
// loop->data.low_prio_head (heap-use-after-free once either list walks
// through a freed entry) and double-incrementing group->low_prio_count
// (aborting at the `low_prio_count == 0` group-deinit assertion in
// debug/ASAN builds when the Listener is finalized).
//
// This fixture is the server: it arms a process-wide `send -> 0` fault so
// every handshake flight is permanently backpressured, and drives N raw TLS
// clients from a CHILD process (the fault is process-global, and the clients'
// ClientHello delivery must not be affected).
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import net from "node:net";
import tls from "node:tls";
import { tls as certs, bunEnv, bunExe } from "harness";

if (!fault.available()) throw new Error("socket fault injection is not available in this build");

const N = 32;
const ROUNDS = 2;

// Capture one real TLS 1.2 ClientHello record so raw net clients can replay
// it. TLS 1.2 keeps the server waiting for the client's second flight after
// it sends its own, so SSL_in_init() stays true for the whole window.
async function captureClientHello(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const srv = net.createServer(sock => {
    // A `data` event delivers a TCP chunk, not a TLS record, so buffer until
    // the first record is complete (5-byte header + the length it declares)
    // and resolve with exactly that record.
    const chunks: Buffer[] = [];
    let total = 0;
    sock.on("error", reject);
    sock.on("close", () => reject(new Error("socket closed before a full ClientHello record arrived")));
    sock.on("data", d => {
      chunks.push(d);
      total += d.length;
      const buf = Buffer.concat(chunks, total);
      if (buf.length < 5) return;
      const recordLength = 5 + buf.readUInt16BE(3);
      if (buf.length < recordLength) return;
      sock.removeAllListeners("close");
      sock.destroy();
      resolve(buf.subarray(0, recordLength));
    });
  });
  srv.on("error", reject);
  await new Promise<void>((r, rej) => {
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", r);
  });
  const port = (srv.address() as net.AddressInfo).port;
  let c: tls.TLSSocket | undefined;
  try {
    c = tls.connect({
      port,
      host: "127.0.0.1",
      maxVersion: "TLSv1.2",
      minVersion: "TLSv1.2",
      rejectUnauthorized: false,
    });
    // The raw server never replies, so the client errors or closes once the
    // ClientHello has been captured and `sock` is destroyed; by then `promise`
    // is settled and these rejections are no-ops. Before that point they turn
    // a setup failure into a real error instead of a hang.
    c.on("error", reject);
    c.on("close", () => reject(new Error("tls.connect closed before the ClientHello was captured")));
    return await promise;
  } finally {
    c?.destroy();
    await new Promise<void>(r => srv.close(() => r()));
  }
}

const clientHello = await captureClientHello();

// One "wave": connect N clients, stagger their ClientHellos so the server
// processes each without parking, then hit all N server sockets with a byte
// in one synchronous burst so N readables land in one server tick and the
// budget exhausts. The parked sockets never recv the byte (the low-prio gate
// breaks before the recv loop) so it stays buffered, keeping them
// level-readable on every subsequent tick.
const clientSrc = `
const net = require("node:net");
const port = Number(process.env.REPRO_PORT);
const N = Number(process.env.REPRO_N);
const hello = Buffer.from(process.env.REPRO_HELLO, "hex");
function wave() {
  const socks = [];
  for (let i = 0; i < N; i++) {
    const c = net.connect(port, "127.0.0.1");
    c.setNoDelay(true);
    c.on("error", () => {});
    socks.push(c);
    // ONLY the ClientHello. Trailing bytes in the same segment would trip the
    // "unread ciphertext after WANT_WRITE" close guard in on_data and destroy
    // the socket before it can be parked.
    c.on("connect", () => setTimeout(() => c.write(hello), 40 + Math.floor(i / 3) * 70));
  }
  setTimeout(() => {
    for (let i = 0; i < N; i++) if (!socks[i].destroyed) socks[i].write(Buffer.from([0]));
    // Mixed staggered teardown so closes land while peers sit in the queue.
    setTimeout(() => {
      for (let i = 0; i < N; i++) {
        const c = socks[i];
        setTimeout(() => (i % 3 === 0 ? c.resetAndDestroy() : c.destroy()), (i % 9) * 30);
      }
    }, 900);
  }, 40 + Math.ceil(N / 3) * 70 + 500);
}
let off = 0;
for (let w = 0; w < 3; w++) { setTimeout(wave, off); off += 40 + Math.ceil(N / 3) * 70 + 1900; }
setTimeout(() => process.exit(0), off + 2000);
`;

async function round() {
  // Bun.listen({tls}) is the native SSL listen path: us_internal_ssl_attach()
  // runs inside the accept loop and the accepted socket hits the low-prio
  // gate on its very first readable dispatch. `server` is local so each
  // round's Listener can be finalized (which is where the group deinit
  // asserts low_prio_count == 0).
  let server: ReturnType<typeof Bun.listen> | null = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key: certs.key, cert: certs.cert },
    socket: {
      open() {},
      data() {},
      close() {},
      error() {},
      handshake() {},
    },
  });

  // Every send from THIS process returns 0 (backpressure): the server flights
  // stay WANT_WRITE forever and every writable retry re-issues
  // us_poll_change(READABLE|WRITABLE), including on already-parked sockets.
  // The faults are process-wide, so clear them even if the child fails.
  try {
    // fault.set returns false if the rule could not be armed; without the
    // forced backpressure nothing ever parks, so that must fail the fixture.
    if (!fault.set({ syscall: "send", action: "zero", repeat: -1 })) {
      throw new Error("failed to arm the send socket fault");
    }
    if (!fault.set({ syscall: "writev", action: "zero", repeat: -1 })) {
      throw new Error("failed to arm the writev socket fault");
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", clientSrc],
      env: {
        ...bunEnv,
        REPRO_PORT: String(server.port),
        REPRO_N: String(N),
        REPRO_HELLO: clientHello.toString("hex"),
      },
      stdout: "inherit",
      stderr: "inherit",
    });
    const clientExitCode = await proc.exited;
    // Without the clients the server sockets never park, so a broken client
    // script must fail the fixture rather than let it still print OK.
    if (clientExitCode !== 0) throw new Error(`client fixture exited with ${clientExitCode}`);
  } finally {
    fault.clear();
    server.stop(true);
    server = null;
  }
}

for (let i = 0; i < ROUNDS; i++) {
  await round();
  // Finalize the round's Listener so its socket group deinits.
  Bun.gc(true);
  await Bun.sleep(30);
  Bun.gc(true);
}
console.log("OK");
