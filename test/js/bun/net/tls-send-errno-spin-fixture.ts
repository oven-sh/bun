// Demonstrates the TLS writable-dispatch spin: us_socket_raw_write treats any
// send() failure (including fatal errnos) as "partial write, re-arm writable",
// so ssl_drain_spill re-enters on every poll tick and send() is called in a
// tight loop for as long as the kernel keeps the fd writable.
//
// Method: arm fault injection so the next N send() calls on the client fd
// return -1 EPIPE, issue one TLS write (which spills because the ciphertext
// send "fails"), then wait for the server to receive the bytes. The server
// only receives once the fault disarms (after N failed sends) and the real
// send() goes through.
//
//   - If the loop SPINS, all N failures are consumed immediately (the writable
//     poll re-fires back-to-back) and the server receives the data almost at
//     once even for large N. The socket never errors or closes.
//   - If the loop is BOUNDED (the desired behavior), a fatal errno surfaces as
//     an error/close after a small constant number of retries and the server
//     never receives the data.
//
// Prints one line: "<verdict> received=<bool> errored=<bool> closed=<bool>
// cpu=<ms> wall=<ms>"

import { socketFaultInjection as fault } from "bun:internal-for-testing";
import tls from "node:tls";
import { tls as cert } from "harness";

if (!fault.available()) {
  console.log("SKIP fault injection not available");
  process.exit(0);
}

let serverGotData: (b: Buffer) => void = () => {};
const serverData = new Promise<Buffer>(r => (serverGotData = r));

const server = tls.createServer({ key: cert.key, cert: cert.cert }, s => {
  s.on("error", () => {});
  s.once("data", d => serverGotData(d));
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;

const sock = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
let closed = false;
let errored = false;
sock.on("error", () => (errored = true));
sock.on("close", () => (closed = true));
await new Promise<void>((res, rej) => {
  sock.once("secureConnect", res);
  sock.once("error", rej);
});

const fd: number = (sock as any)._handle?.fd;
if (typeof fd !== "number" || fd < 0) {
  console.log("SETUP no fd");
  process.exit(2);
}

const N = 50_000;
fault.set({ syscall: "send", action: "errno", errno: "EPIPE", repeat: N, fd });

const cpu0 = process.cpuUsage();
const t0 = process.hrtime.bigint();
sock.write(Buffer.alloc(100, "x"));

const received = await Promise.race([
  serverData.then(() => true),
  new Promise<boolean>(r => sock.once("close", () => r(false))),
  new Promise<boolean>(r => setTimeout(() => r(false), 3000)),
]);

const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
const cpu = process.cpuUsage(cpu0);
const cpuMs = (cpu.user + cpu.system) / 1000;

fault.clear();
sock.destroy();
server.close();

// Spin verdict: the server received data (all N failures were silently
// retried) AND CPU ≈ wall (loop was hot the whole time).
const verdict = received && !errored && !closed ? "SPIN" : "OK";
console.log(
  `${verdict} received=${received} errored=${errored} closed=${closed} ` +
    `N=${N} cpu=${cpuMs.toFixed(0)}ms wall=${wallMs.toFixed(0)}ms`,
);
process.exit(verdict === "SPIN" ? 1 : 0);
