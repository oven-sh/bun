import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";

// worker.terminate() while an async node:fs write of a user Buffer is still
// inside write(2) on a pool thread: Heap::lastChanceToFinalize would free the
// ArrayBufferContents while the kernel is still copying from it, so the fd
// receives freed-heap bytes instead of the bytes the writer held. The reader
// is the kernel, so the oracle is content: the worker fills its buffer with
// one known byte and writes only to one FIFO; the parent flags any byte that
// writer never held.
describe.concurrent.skipIf(isWindows || !isASAN)(
  "worker.terminate() during in-flight async node:fs write does not write freed memory",
  () => {
    for (const api of ["write", "writev", "writeFile"] as const) {
      test(`fs.${api}`, async () => {
        const fixture = `
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const API = process.argv[3];
const fifo = path.join(dir, "fifo");
execFileSync("mkfifo", [fifo]);
const rfd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

const src =
  "import { parentPort, workerData as d } from 'node:worker_threads';\\n" +
  "import fs from 'node:fs';\\n" +
  // 8 MiB malloc-backed Buffer filled with this worker's unique byte
  "const buf = Buffer.allocUnsafe(8 << 20).fill(d.gen);\\n" +
  "let fd;\\n" +
  "async function lane() { for (;;) {\\n" +
  "  if (d.api === 'write') await new Promise(r => fs.write(fd ??= fs.openSync(d.fifo, 'w'), buf, 0, buf.length, null, r));\\n" +
  "  else if (d.api === 'writev') await new Promise(r => fs.writev(fd ??= fs.openSync(d.fifo, 'w'), [buf.subarray(0, 4 << 20), buf.subarray(4 << 20)], null, r));\\n" +
  "  else if (d.api === 'writeFile') await new Promise(r => fs.writeFile(d.fifo, buf, r));\\n" +
  "} }\\n" +
  "parentPort.postMessage('up'); lane().catch(() => {});\\n";
const wfile = path.join(dir, "w.mjs");
fs.writeFileSync(wfile, src);

const GEN = 0x42;
const chunk = Buffer.alloc(1 << 16);
let foreign = 0;
function drain() {
  let n;
  try { n = fs.readSync(rfd, chunk, 0, chunk.length, null); } catch { return false; }
  if (n <= 0) return false;
  for (let j = 0; j < n; j++) {
    if (chunk[j] !== GEN) {
      let k = j; while (k < n && chunk[k] === chunk[j]) k++;
      if (++foreign <= 4)
        console.log("FOREIGN fifo byte 0x" + chunk[j].toString(16) + " run=" + (k - j) + " writer-held=0x42");
      j = k - 1;
    }
  }
  return true;
}

const w = new Worker(wfile, { workerData: { fifo, gen: GEN, api: API } });
w.on("error", () => {});
await Promise.race([new Promise(res => w.once("message", res)), Bun.sleep(5000)]);
// Let write(2) park on the full pipe, then tear the VM down while the kernel
// is still copying from the buffer.
await Bun.sleep(30);
await w.terminate();
// Drain enough of what the in-flight write(2) streamed to observe the bytes
// it produced after the VM died. Stop well short of the full 8 MiB so the
// pool thread stays parked inside write(2) and never reaches the dead-VM
// completion path (that crash is tracked separately).
let idle = 0, reads = 0;
while (idle < 20 && reads < 48) { if (drain()) { idle = 0; reads++; } else { idle++; await Bun.sleep(5); } }
console.log(foreign ? "FAIL foreign-chunks=" + foreign : "PASS reads=" + reads);
process.exit(foreign ? 1 : 0);
`;

        using dir = tempDir("fs-write-term", { "fixture.mjs": fixture });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--smol", "fixture.mjs", String(dir), api],
          env: {
            ...bunEnv,
            // Route JSC ArrayBuffer storage through system malloc so ASAN
            // free-fills it on release (bmalloc/Gigacage hides the UAF).
            Malloc: "1",
            ASAN_OPTIONS: (bunEnv.ASAN_OPTIONS ? bunEnv.ASAN_OPTIONS + ":" : "") + "max_free_fill_size=268435456",
          },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        const out = stdout + stderr;
        expect(out).not.toContain("FOREIGN");
        expect(out).not.toContain("use-after-free");
        if (exitCode === 0) expect(stdout).toContain("PASS");
      }, 30_000);
    }
  },
);
