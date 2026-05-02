import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";

// PipeReader.onReaderError() was missing the this.deref() that balances the
// this.ref() from start(), so when a read on a subprocess stdout/stderr pipe
// failed with a real error (not EOF/EAGAIN), the PipeReader struct, its
// buffered data, its poll registration and the pipe fd were all leaked. The
// leaked poll's keep-alive ref also prevented the event loop from exiting.
//
// Triggering a real read error on an AF_UNIX socketpair from JS is hard; the
// only reliable way is to dup() the parent's read-end fd (so the underlying
// file description stays alive in the epoll interest list), then dup2() a
// write-only fd onto the original fd number. When the child writes, epoll
// still fires for the original file description but read() on the swapped fd
// returns EBADF, which reaches SubprocessPipeReader.onReaderError. This
// relies on Linux epoll semantics so the test is Linux-only, but the leak
// itself is cross-platform.
test.skipIf(!isLinux)(
  "PipeReader is freed when a subprocess stdout read fails",
  async () => {
    using dir = tempDir("spawn-pipe-read-error-leak", {
      "fixture.js": `
const { dlopen, FFIType } = require("bun:ffi");
const { readdirSync, readlinkSync, openSync, closeSync, writeFileSync, rmSync } = require("fs");
const { execFileSync } = require("child_process");
const { join } = require("path");

const libc = dlopen(process.env.LIBC_PATH, {
  dup: { args: [FFIType.i32], returns: FFIType.i32 },
  dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

function snapshotFds() {
  const out = new Map();
  for (const name of readdirSync("/proc/self/fd")) {
    const fd = Number(name);
    if (!Number.isInteger(fd)) continue;
    try {
      out.set(fd, readlinkSync("/proc/self/fd/" + fd));
    } catch {
      // fd closed between readdir and readlink (e.g. readdir's own dir fd)
    }
  }
  return out;
}

const fifo = join(process.cwd(), "sync-fifo");

async function once() {
  try { rmSync(fifo); } catch {}
  execFileSync("mkfifo", [fifo]);

  const before = snapshotFds();

  // cat blocks opening the fifo until the parent opens it for writing, then
  // copies whatever the parent writes to stdout.
  const proc = Bun.spawn({
    cmd: ["cat", fifo],
    stdin: "ignore",
    stdout: "pipe", // PipeReader - never access proc.stdout from JS
    stderr: "inherit",
  });

  // Only stdout is piped, so exactly one new socket fd exists: the parent's
  // read end of the stdout socketpair.
  const after = snapshotFds();
  let stdoutFd = -1;
  for (const [fd, link] of after) {
    if (link.startsWith("socket:") && before.get(fd) !== link) {
      stdoutFd = fd;
    }
  }
  if (stdoutFd < 0) {
    proc.kill();
    await proc.exited;
    throw new Error("could not locate stdout socket fd");
  }

  // Keep the file description alive so the epoll interest-list entry survives
  // the dup2() below; epoll tracks file descriptions, not fd numbers.
  const dupFd = libc.symbols.dup(stdoutFd);
  if (dupFd < 0) throw new Error("dup() failed");

  // Swap the stdout fd number to point at a write-only file so the next
  // read() on it fails with EBADF.
  const wo = openSync("/dev/null", "w");
  if (libc.symbols.dup2(wo, stdoutFd) < 0) throw new Error("dup2() failed");
  closeSync(wo);

  // Unblock the child so it writes to stdout; epoll fires on the original
  // file description and the reader's read() on stdoutFd returns EBADF.
  writeFileSync(fifo, "x");

  await proc.exited;

  // Drop our extra reference to the original file description so its epoll
  // entry goes away.
  closeSync(dupFd);

  Bun.gc(true);

  // The fd close goes through bun.Async.Closer which schedules close() on
  // a jsc.WorkPool thread; Bun.sleep(0) doesn't synchronize with that. Poll
  // a few times so a briefly-starved close thread doesn't flag a false
  // positive (same pattern as spawn-stdin-pipe-fd-leak.test.ts).
  let leaked = 0;
  for (let i = 0; i < 20; i++) {
    const final = snapshotFds();
    leaked = 0;
    for (const [fd, link] of final) {
      if (before.get(fd) !== link) leaked++;
    }
    if (leaked === 0) break;
    await Bun.sleep(20);
  }
  return leaked;
}

let total = 0;
for (let i = 0; i < 10; i++) total += await once();
try { rmSync(fifo); } catch {}
console.log(JSON.stringify({ leaked: total }));
// Without the fix the leaked polls keep the event loop alive forever; exit
// explicitly so the parent test can assert on the leak count instead of
// just timing out.
process.exit(0);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: { ...bunEnv, LIBC_PATH: libcPathForDlopen() },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const stderrLines = stderr.split("\n").filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"));
    expect(stderrLines).toEqual([]);
    expect(stdout.trim()).toBe(JSON.stringify({ leaked: 0 }));
    expect(exitCode).toBe(0);
  },
  30_000,
);

// Cross-platform version that uses an internal-for-testing hook to inject a
// synthetic EBADF directly into the reader, instead of relying on Linux epoll
// semantics. On Windows, normal subprocess termination maps to UV_EOF (not an
// error), and the uv.Pipe HANDLE isn't JS-accessible, so there's no way to
// trigger a real read error from JS — hence the hook.
//
// Without the fix, the leaked poll keep-alive refs (Posix) / uv.Pipe handles
// (Windows) prevent the event loop from exiting after the loop completes, so
// the fixture hangs and the spawn timeout kills it.
test("PipeReader is freed when a subprocess stdout read fails (injected)", async () => {
  using dir = tempDir("spawn-pipe-read-error-leak-inject", {
    "fixture.js": `
const { subprocessInternals } = require("bun:internal-for-testing");

const sleeper = process.platform === "win32"
  ? ["cmd.exe", "/c", "timeout /t 120 /nobreak >nul"]
  : ["sleep", "120"];

let injected = 0;
for (let i = 0; i < 10; i++) {
  const proc = Bun.spawn({
    cmd: sleeper,
    stdin: "ignore",
    stdout: "pipe", // PipeReader - never access proc.stdout from JS
    stderr: "ignore",
  });

  // Inject EBADF into the stdout PipeReader as if read()/uv_read_cb had
  // failed. This tears down the PipeReader via onReaderError.
  if (subprocessInternals.injectStdioReadError(proc, "stdout")) injected++;

  proc.kill();
  await proc.exited;
}
Bun.gc(true);
console.log(JSON.stringify({ injected }));
// No explicit process.exit(): if the fix works, the event loop exits on its
// own once the script finishes. Without the fix, the leaked keep-alive refs
// (Posix) / open uv.Pipe handles (Windows) keep it alive and the parent's
// spawn timeout fires.
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Without the fix the fixture never exits; bound it so the assertion
    // below shows a clear failure instead of the test itself timing out.
    timeout: isWindows ? 25_000 : 15_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stderrLines = stderr.split("\n").filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"));
  expect(stderrLines).toEqual([]);
  expect(stdout.trim()).toBe(JSON.stringify({ injected: 10 }));
  // SIGKILL from the spawn timeout is the failure signal here.
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 60_000);
