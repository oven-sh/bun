import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// FilePoll::unregister builds its error from the kevent changelist: with
// KEVENT_FLAG_ERROR_EVENTS, a failed EV_DELETE comes back as an eventlist
// entry with EV_ERROR set and the errno *value* in `data`. That value used to
// be fed through `errno_sys`, which decodes the -1-sentinel return-code
// convention and therefore returned `None` for every real errno — so the
// `.unwrap()` at the call site panicked whenever deregistration failed.
//
// Deregistration legitimately fails when the polled fd is closed while the
// poll is still registered: close() removes the fd's kevents, so the forced
// EV_DELETE during PipeReader teardown reports ENOENT/EBADF. That is a
// tolerated race (the deinit path discards the error); it must not abort.
//
// The fixture makes the race deterministic. Bun.spawn({stdout: "pipe"})
// registers a FilePoll on the parent's read end of the stdout socketpair at
// spawn time (no dup — the polled fd is discoverable via /proc/self/fd //
// /dev/fd). Closing that fd behind the runtime's back drops the kernel-side
// registration, so cancelling the stream force-unregisters a stale FilePoll.
// Only macOS reaches the buggy kevent path (Linux's epoll branch decodes the
// epoll_ctl return code, which is the convention `errno_sys` expects), so the
// test can only fail on an unfixed build there; it still runs on Linux, where
// it exercises the EPOLL_CTL_DEL-on-stale-fd teardown.
test.skipIf(isWindows)("FilePoll teardown tolerates an fd closed while still registered", async () => {
  using dir = tempDir("spawn-pipe-stale-fd", {
    "fixture.js": `
import { closeSync, constants, fstatSync, openSync, readdirSync } from "node:fs";

function pipeFds() {
  const dir = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
  const out = new Map();
  for (const name of readdirSync(dir)) {
    const fd = Number(name);
    if (!Number.isInteger(fd)) continue;
    try {
      const st = fstatSync(fd);
      if (st.isFIFO() || st.isSocket()) out.set(fd, st.ino);
    } catch {
      // closed between readdir and fstat (e.g. readdir's own dir fd)
    }
  }
  return out;
}

const before = pipeFds();
const proc = Bun.spawn({
  cmd: ["sleep", "120"],
  stdin: "ignore",
  stdout: "pipe",
  stderr: "ignore",
});

try {
  // Transfers the live BufferedReader (and its registered FilePoll) into a
  // ReadableStream source; the pending read keeps it polling.
  const reader = proc.stdout.getReader();
  const pending = reader.read();
  await new Promise(resolve => setImmediate(resolve));

  // Only stdout is piped, so exactly one new pipe/socket fd exists: the
  // parent's read end of the stdout socketpair, which is what the FilePoll
  // is registered on.
  const candidates = [...pipeFds()].filter(([fd, ino]) => before.get(fd) !== ino).map(([fd]) => fd);
  if (candidates.length !== 1) {
    throw new Error("expected exactly one new pipe fd, got [" + candidates.join(", ") + "]");
  }
  const stdoutFd = candidates[0];

  // Closing the polled fd removes its kevents/epoll registration in the
  // kernel; the FilePoll's later EV_DELETE / EPOLL_CTL_DEL now fails with
  // ENOENT/EBADF.
  closeSync(stdoutFd);
  // Re-occupy the fd number (lowest free fd) so the reader's own deferred
  // close() of it hits a live descriptor instead of EBADF.
  const shield = openSync("/dev/null", constants.O_RDONLY);
  if (shield !== stdoutFd) throw new Error("fd number was not reused: " + stdoutFd + " vs " + shield);

  // Teardown force-unregisters the stale FilePoll. Stream-level rejections
  // are fine; a runtime panic (abort) is what this test guards against.
  await reader.cancel().catch(() => {});
  await pending.catch(() => {});
  console.log("OK");
} finally {
  proc.kill();
  await proc.exited;
}
process.exit(0);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stderrLines = stderr.split("\n").filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"));
  expect(stderrLines).toEqual([]);
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
