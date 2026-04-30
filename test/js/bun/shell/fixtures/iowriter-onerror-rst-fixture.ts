// Self-contained helper for iowriter-onerror.test.ts.
//
// Creates both ends of a loopback TCP connection via raw FFI so the event loop
// never registers the fd (node:net would epoll it and consume the pending socket
// error before the grandchild writes). The server side sets SO_LINGER{1,0} and
// closes → RST; the first write from the grandchild's stderr IOWriter then fails
// with ECONNRESET (not EPIPE), exercising IOWriter.onError while multiple writers
// are pending.
//
// Linux-only: SOL_SOCKET / SO_REUSEADDR / SO_LINGER constant values are Linux ABI.

import { dlopen, ptr } from "bun:ffi";
import { execFileSync } from "node:child_process";

const bunExe = process.argv[2];

const isMusl = !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header
  .glibcVersionRuntime;
const libcPath = isMusl ? "/usr/lib/libc.so" : "libc.so.6";

const libc = dlopen(libcPath, {
  socket: { args: ["int", "int", "int"], returns: "int" },
  bind: { args: ["int", "ptr", "int"], returns: "int" },
  listen: { args: ["int", "int"], returns: "int" },
  accept: { args: ["int", "ptr", "ptr"], returns: "int" },
  connect: { args: ["int", "ptr", "int"], returns: "int" },
  getsockname: { args: ["int", "ptr", "ptr"], returns: "int" },
  setsockopt: { args: ["int", "int", "int", "ptr", "int"], returns: "int" },
  close: { args: ["int"], returns: "int" },
  usleep: { args: ["u32"], returns: "int" },
});

const AF_INET = 2;
const SOCK_STREAM = 1;
const SOL_SOCKET = 1;
const SO_REUSEADDR = 2;
const SO_LINGER = 13;

function sockaddrIn(port: number): Uint8Array {
  const addr = new Uint8Array(16);
  const dv = new DataView(addr.buffer);
  dv.setUint16(0, AF_INET, true); // sin_family
  dv.setUint16(2, port, false); // sin_port (network byte order)
  addr[4] = 127;
  addr[5] = 0;
  addr[6] = 0;
  addr[7] = 1; // 127.0.0.1
  return addr;
}

// Server: bind to an ephemeral port on loopback.
const srv = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
if (srv < 0) throw new Error("socket(srv) failed");
const one = new Int32Array([1]);
libc.symbols.setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, ptr(one), 4);
if (libc.symbols.bind(srv, ptr(sockaddrIn(0)), 16) < 0) throw new Error("bind failed");
libc.symbols.listen(srv, 1);
const addrOut = new Uint8Array(16);
const addrLen = new Int32Array([16]);
libc.symbols.getsockname(srv, ptr(addrOut), ptr(addrLen));
const port = new DataView(addrOut.buffer).getUint16(2, false);

// Client: blocking connect (loopback completes synchronously).
const cli = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
if (cli < 0) throw new Error("socket(cli) failed");
if (libc.symbols.connect(cli, ptr(sockaddrIn(port)), 16) < 0) throw new Error("connect failed");

// Accept, set SO_LINGER{on=1, linger=0}, close → kernel sends RST.
const acc = libc.symbols.accept(srv, null, null);
if (acc < 0) throw new Error("accept failed");
const linger = new Int32Array([1, 0]);
libc.symbols.setsockopt(acc, SOL_SOCKET, SO_LINGER, ptr(linger), 8);
libc.symbols.close(acc);
libc.symbols.close(srv);

// Let the RST propagate to the client socket's error queue.
libc.symbols.usleep(100000);

// Spawn the shell under test with stderr = the RST'd client socket. Use a
// synchronous spawn so the event loop never ticks and nothing reads SO_ERROR
// off the socket before the grandchild's first write.
try {
  const out = execFileSync(
    bunExe,
    [
      "-e",
      `
        const { $ } = require("bun");
        $.throws(false);
        // (cd /neA || cd /neB) | cd /ne2
        //   - cdA and cd2 both enqueue on the shared stderr IOWriter (2 pending,
        //     SmolList inlined at capacity).
        //   - stderr write fails ECONNRESET -> onError iterates [cdA, cd2].
        //   - cdA's callback runs Binary(||).childDone -> starts cdB -> enqueue on
        //     the same IOWriter mid-iteration.
        const result = await $\`(cd /neA || cd /neB) | cd /ne2\`;
        console.log("exit:" + result.exitCode);
        console.log("done");
      `,
    ],
    {
      stdio: [0, "pipe", cli],
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
      timeout: 10000,
      encoding: "utf8",
    },
  );
  process.stdout.write(out);
  libc.symbols.close(cli);
  process.exit(0);
} catch (e: any) {
  libc.symbols.close(cli);
  if (e.signal) {
    // Timed out — the shell hung waiting on a stranded writer.
    process.stderr.write("HUNG signal=" + e.signal + "\n");
    if (e.stdout) process.stdout.write(e.stdout);
    process.exit(1);
  }
  process.stderr.write("ERROR: " + (e.message || String(e)) + "\n");
  if (e.stdout) process.stdout.write(e.stdout);
  process.exit(e.status ?? 1);
}
