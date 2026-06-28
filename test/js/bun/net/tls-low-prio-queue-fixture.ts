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
  const { promise, resolve } = Promise.withResolvers<Buffer>();
  const srv = net.createServer(sock => sock.once("data", d => (sock.destroy(), resolve(d))));
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  const c = tls.connect({
    port,
    host: "127.0.0.1",
    maxVersion: "TLSv1.2",
    minVersion: "TLSv1.2",
    rejectUnauthorized: false,
  });
  c.on("error", () => {});
  const hello = await promise;
  c.destroy();
  await new Promise<void>(r => srv.close(() => r()));
  return hello;
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
  fault.set({ syscall: "send", action: "zero", repeat: -1 });
  fault.set({ syscall: "writev", action: "zero", repeat: -1 });

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
  await proc.exited;

  fault.clear();
  server.stop(true);
  server = null;
}

for (let i = 0; i < ROUNDS; i++) {
  await round();
  // Finalize the round's Listener so its socket group deinits.
  Bun.gc(true);
  await Bun.sleep(30);
  Bun.gc(true);
}
console.log("OK");
