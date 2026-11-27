// Bun.serve returning `Bun.file(path).slice(0, n)` of a larger file: the
// response's reader asks the kernel for exactly `n` bytes and ends there, so
// each request costs one read() of the served file and an error from the file
// can only fail the response it belongs to. (The reader used to pull in the
// whole read buffer and cut the chunk down afterwards, so every request took
// two read()s, a 4 KiB one and the EOF probe, and the response had to end
// itself from a queued task. That task was once freed out from under the
// read-error path: heap-use-after-free under ASAN.)
//
// A small ptrace supervisor counts the read() calls on the served file and
// injects EIO into the second one. Bun issues read() as a raw syscall on Linux
// (rustix linux_raw backend), so LD_PRELOAD cannot intercept it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { constants } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// The file is 4 KiB; slicing to 2 KiB keeps us on the BufferedReader path
// (below the 1 MiB sendfile threshold) while leaving bytes past the slice that
// a read sized by the buffer instead of the slice would pick up. The slice
// starts at 0 so the reader uses read(), which is what the supervisor counts.
const FIXTURE_JS = /* js */ `
const path = process.argv[2];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() { return new Response(Bun.file(path).slice(0, 2048)); },
});
let okBodies = 0;
for (let i = 0; i < 3; i++) {
  try {
    // A fresh connection per request: a request that fails on a reused
    // keep-alive connection before any response bytes would be retried
    // (and then succeed) instead of being reported.
    const r = await fetch(\`http://127.0.0.1:\${server.port}/\`, { headers: { connection: "close" } });
    const b = await r.arrayBuffer();
    if (b.byteLength === 2048) okBodies++;
  } catch {}
}
server.stop(true);
console.log("DONE " + okBodies);
`;

let dir: ReturnType<typeof tempDir> | undefined;
let supervisorBin: string | undefined;
let served: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("serve-file-slice-read-error", {
    "fixture.mjs": FIXTURE_JS,
    "served.bin": Buffer.alloc(4096, 97).toString("latin1"),
  });
  served = join(String(dir), "served.bin");
  const out = join(String(dir), "supervisor");
  await using proc = Bun.spawn({
    cmd: [cc, "-O0", "-o", out, join(import.meta.dir, "..", "io", "fail-nth-read.c")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (ccExit !== 0) {
    throw new Error(`supervisor compile failed:\n${ccErr || ccOut}`);
  }
  supervisorBin = out;
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

test.skipIf(!isLinux || !cc)(
  "Bun.serve Bun.file().slice() reads the file once per response, so a read() error fails only its own response",
  async () => {
    expect(supervisorBin).toBeDefined();

    // LeakSanitizer's StopTheWorld PTRACE_ATTACHes its own threads; that
    // fails (EPERM) when the process is already ptraced and LSan aborts
    // ("LeakSanitizer does not work under ptrace"). Disable it for the
    // traced child only.
    const asanOpts = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
    await using proc = Bun.spawn({
      cmd: [
        supervisorBin!,
        served,
        "2",
        String(constants.errno.EIO),
        "--",
        bunExe(),
        join(String(dir), "fixture.mjs"),
        served,
      ],
      env: { ...bunEnv, ASAN_OPTIONS: asanOpts, LSAN_OPTIONS: "detect_leaks=0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Three requests, one read() each, so the injected EIO lands on request
    // #2's only read: that response fails and the other two carry their 2048
    // bytes. A reader that over-reads takes two read()s per request (6 in
    // total) and the EIO lands on request #1's EOF probe, after the slice has
    // already been satisfied, so all three responses succeed.
    expect(stderr).toContain("matched read() calls on target:");
    const reads = Number(stderr.match(/matched read\(\) calls on target:\s*(\d+)/)![1]);
    expect({ stdout: stdout.trim(), reads }).toEqual({ stdout: "DONE 2", reads: 3 });
    expect(exitCode).toBe(0);
  },
);
