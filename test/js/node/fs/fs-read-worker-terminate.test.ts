import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";

// worker.terminate() while an async node:fs read into a user Buffer is parked
// in read(2) on an empty FIFO: Heap::lastChanceToFinalize would free the
// ArrayBufferContents while the kernel still holds the destination address,
// so a later write to the FIFO copies the peer's bytes into freed (and
// possibly reused) memory. The kernel's copy_to_user is invisible to ASAN,
// so the oracle is a direct address probe: the worker reports ptr(buf) before
// parking, the parent terminates it, and bun:ffi's read.u8 at that address
// either observes the worker's fill byte (storage alive) or trips ASAN
// heap-use-after-free (storage freed mid-read). The FIFO is never written,
// so read(2) stays parked and the separate completion-into-dead-VM crash
// (#34154) is not reached.
describe.concurrent.skipIf(!isLinux || !isASAN)(
  "worker.terminate() during parked async node:fs read keeps the destination buffer alive",
  () => {
    for (const api of ["read", "readv"] as const) {
      test(
        `fs.${api}`,
        async () => {
          const fixture = `
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { read as ffiRead } from "bun:ffi";

const dir = process.argv[2];
const API = process.argv[3];
const fifo = path.join(dir, "fifo");
execFileSync("mkfifo", [fifo]);
// O_RDWR on a FIFO (Linux) never blocks on open and never delivers EOF, so
// the worker's read(2) parks on an empty pipe for as long as we need.
const fd = fs.openSync(fifo, fs.constants.O_RDWR);

const src =
  "import { parentPort, workerData as d } from 'node:worker_threads';\\n" +
  "import fs from 'node:fs';\\n" +
  "import { ptr } from 'bun:ffi';\\n" +
  "const buf = Buffer.allocUnsafeSlow(8 << 20).fill(0x42);\\n" +
  "if (d.api === 'read') fs.read(d.fd, buf, 0, buf.length, null, () => {});\\n" +
  "else fs.readv(d.fd, [buf.subarray(0, 4 << 20), buf.subarray(4 << 20)], null, () => {});\\n" +
  "parentPort.postMessage({ addr: ptr(buf), len: buf.length });\\n";
const wfile = path.join(dir, "w.mjs");
fs.writeFileSync(wfile, src);

const w = new Worker(wfile, { workerData: { fd, api: API } });
w.on("error", e => { console.log("WORKER_ERR", String(e)); process.exit(1); });
const { addr, len } = await new Promise(r => w.once("message", r));
await w.terminate();
// Probe both ends of the range the pool thread handed to read(2). Without
// the native ref this is the first access after lastChanceToFinalize freed
// the storage and ASAN aborts with heap-use-after-free.
const head = ffiRead.u8(addr, 0);
const tail = ffiRead.u8(addr, len - 1);
if (head !== 0x42 || tail !== 0x42) {
  console.log("FAIL saw 0x" + head.toString(16) + "/0x" + tail.toString(16) + " at freed destination");
  process.exit(1);
}
console.log("PASS addr=0x" + addr.toString(16) + " len=" + len);
process.exit(0);
`;

          using dir = tempDir("fs-read-term", { "fixture.mjs": fixture });
          await using proc = Bun.spawn({
            cmd: [bunExe(), "--smol", "fixture.mjs", String(dir), api],
            env: {
              ...bunEnv,
              // Route JSC ArrayBuffer storage through system malloc so ASAN
              // owns the allocation and the ffi probe can observe the free.
              Malloc: "1",
              // The fail-before ASAN report is the signal; symbolization adds
              // several seconds for no information the assertion uses.
              ASAN_OPTIONS: (bunEnv.ASAN_OPTIONS ? bunEnv.ASAN_OPTIONS + ":" : "") + "symbolize=0",
            },
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).not.toContain("AddressSanitizer");
          expect(stdout + stderr).not.toContain("FAIL");
          expect(stdout).toMatch(/^PASS addr=0x[0-9a-f]+ len=8388608$/m);
        },
        20_000,
      );
    }
  },
);
