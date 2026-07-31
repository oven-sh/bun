// Regression fixture for the TLS `server.stop(true)` sibling-close
// use-after-free (issue #36459).
//
// us_socket_group_close_all_ex walks group->head_sockets to close every
// connection during teardown. It used to cache `next = s->next` and then call
// us_socket_close(s), which dispatches the JS close/handshake handler. If that
// handler closes a *sibling* connection (the one cached as `next`), the walk
// then advanced onto freed memory. With a burst of a few hundred TLS
// connections mid-handshake (overflowing the 5-per-tick handshake budget) the
// crash is reliable: the event loop dispatches through a freed socket's vtable
// and aborts with `panic: us_socket_t with kind=invalid`.
//
// This fixture is the server: it closes a sibling from both the handshake and
// close handlers, then floods itself from a CHILD process and tears down with
// server.stop(true) while connections are still mid-handshake.
import net from "node:net";
import tls from "node:tls";
import { tls as certs, bunEnv, bunExe } from "harness";

// Capture one real TLS 1.2 ClientHello record so raw net clients can replay it
// without doing a full handshake. TLS 1.2 keeps the server waiting for the
// client's second flight, so the accepted socket stays mid-handshake.
async function captureClientHello(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const srv = net.createServer(sock => {
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
    c = tls.connect({ port, host: "127.0.0.1", maxVersion: "TLSv1.2", minVersion: "TLSv1.2", rejectUnauthorized: false });
    c.on("error", reject);
    c.on("close", () => reject(new Error("tls.connect closed before the ClientHello was captured")));
    return await promise;
  } finally {
    c?.destroy();
    await new Promise<void>(r => srv.close(() => r()));
  }
}

const clientHello = await captureClientHello();
const N = Number(process.env.REPRO_N || 240);
const ROUNDS = Number(process.env.REPRO_ROUNDS || 3);

// Child floods `N` raw TLS ClientHellos, staggered so they sit mid-handshake,
// then fires a one-byte burst at all of them in a single tick and prints BURST.
const clientSrc = `
const net = require("node:net");
const port = Number(process.env.REPRO_PORT);
const N = Number(process.env.REPRO_N);
const hello = Buffer.from(process.env.REPRO_HELLO, "hex");
const socks = [];
for (let i = 0; i < N; i++) {
  const c = net.connect(port, "127.0.0.1");
  c.setNoDelay(true);
  c.on("error", () => {});
  socks.push(c);
  c.on("connect", () => setTimeout(() => { try { c.write(hello); } catch {} }, 30 + Math.floor(i / 4) * 40));
}
setTimeout(() => {
  for (const c of socks) if (!c.destroyed) { try { c.write(Buffer.from([0])); } catch {} }
  process.stdout.write("BURST\\n");
}, 30 + Math.ceil(N / 4) * 40 + 300);
setTimeout(() => process.exit(0), 60000);
`;

async function round() {
  const socks: any[] = [];
  let tearing = false;
  function closeSibling(self: any) {
    if (!tearing) return;
    const i = socks.indexOf(self);
    if (i < 0) return;
    const other = socks[(i + (socks.length >> 1)) % socks.length];
    if (other && other !== self) {
      try {
        other.end();
      } catch {}
    }
  }

  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key: certs.key, cert: certs.cert },
    socket: {
      open(s) {
        socks.push(s);
      },
      handshake(s) {
        closeSibling(s);
      },
      data() {},
      close(s) {
        closeSibling(s);
      },
      error() {},
    },
  });

  // The finally keeps a failed round (child crashed before BURST, spawn threw)
  // from leaking the listener and hanging the fixture until the test timeout;
  // stop(true) on an already-stopped listener is a no-op.
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", clientSrc],
      env: { ...bunEnv, REPRO_PORT: String(server.port), REPRO_N: String(N), REPRO_HELLO: clientHello.toString("hex") },
      stdout: "pipe",
      stderr: "ignore",
    });

    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawBurst = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      if (buf.includes("BURST")) {
        // The stop must land HERE, while the burst holds connections
        // mid-handshake, or the round doesn't exercise the teardown walk.
        sawBurst = true;
        tearing = true;
        server.stop(true);
        break;
      }
    }
    reader.cancel().catch(() => {});
    proc.kill();
    await proc.exited;
    if (!sawBurst) throw new Error("flood child exited before printing BURST");
  } finally {
    server.stop(true);
  }
}

for (let i = 0; i < ROUNDS; i++) {
  await round();
  Bun.gc(true);
}
console.log("OK");
