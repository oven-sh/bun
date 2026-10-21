// When `stdin: "pipe"` is passed to Bun.spawn and the `.stdin` getter is
// never read, the stdin pipe fd should still be closed when the child
// exits — not deferred to GC.
//
// Root cause: `Writable.init()` wrote `subprocess.weak_file_sink_stdin_ptr`,
// `subprocess.ref()`, and `subprocess.flags.*` while being called as a field
// initializer inside the `subprocess.* = Subprocess{ ... }` aggregate, so
// those writes were immediately clobbered by the rest of the literal
// (including `weak_file_sink_stdin_ptr`'s default of `null`). `onProcessExit`
// then found no pipe to close and the fd lived until Subprocess finalization.

import { fileSinkInternals, getCounters } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isPosix, isWindows, tempDir } from "harness";
import { readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

function countOpenFds(): number {
  // Linux and macOS both expose per-process fd tables here.
  try {
    return readdirSync("/proc/self/fd").length;
  } catch {
    return readdirSync("/dev/fd").length;
  }
}

// Windows has no /proc/self/fd equivalent; the observable leak is
// POSIX-specific anyway (libuv pipe close on Windows is async regardless).
test.skipIf(!isPosix)("stdin: 'pipe' fd is closed on child exit without reading .stdin", async () => {
  const N = 100;

  // Warm up: spawn once so any lazily-opened runtime fds (signalfd, etc.)
  // are already present in the baseline.
  {
    const p = Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    await p.exited;
  }

  const baseline = countOpenFds();

  const children: Bun.Subprocess[] = [];
  for (let i = 0; i < N; i++) {
    children.push(Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" }));
  }
  await Promise.all(children.map(p => p.exited));

  // fd closes go through bun.Async.Closer on POSIX; give the close thread
  // a moment — but do NOT invoke GC, since the bug was that cleanup only
  // happened via Subprocess finalization.
  for (let i = 0; i < 20 && countOpenFds() - baseline > N / 4; i++) await Bun.sleep(20);

  const afterExit = countOpenFds() - baseline;

  // Keep `children` alive across the measurement so GC finalization cannot
  // be what closed the fds.
  expect(children.length).toBe(N);

  // Without the fix every stdin pipe (one per child) is still open here,
  // so `afterExit` ≈ N. Allow slack for a few async closes still in flight.
  expect(afterExit).toBeLessThan(N / 4);
});

test("reading .stdin does not leak a native FileSink per spawn", async () => {
  const N = 24;

  async function once() {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
    // Touch the getter — this is the `Writable.toJS` `.pipe` arm under test.
    const stdin = proc.stdin;
    expect(stdin).toBeDefined();
    await Promise.resolve(stdin!.end()).catch(() => {});
    await proc.exited;
  }

  // Warm up so any one-off lazy allocations are in the baseline.
  await once();
  Bun.gc(true);
  const baseline = fileSinkInternals.liveCount();

  await Promise.all(Array.from({ length: N }, once));

  // Let JS wrappers finalize (their deref is what drops liveCount).
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    if (fileSinkInternals.liveCount() <= baseline) break;
    await Bun.sleep(10);
  }

  const leaked = fileSinkInternals.liveCount() - baseline;
  // A couple of stragglers whose JS wrappers haven't finalized yet are fine;
  // a +1-per-iteration native leak would leave `leaked` ≈ N here.
  expect(leaked).toBeLessThan(N / 4);
});

// A Buffer `stdin` (Bun.spawn's, or the shell's `< ${buffer}` redirect, which
// shares the implementation) is pumped into the child by a native writer that
// holds a ref on itself while the write is in flight. When the child closed
// its stdin before the write finished, the failed write (EPIPE) tore the
// writer down without releasing that ref, leaving a few hundred bytes behind
// per such spawn: too small for an RSS check, so this relies on LeakSanitizer,
// i.e. the ASAN lane, and the scenarios run in their own process so that leak
// detection can be switched on for exactly them. That process also gets memfd
// disabled, which only matters for the Bun.spawn scenarios: on Linux Bun.spawn
// otherwise hands a Buffer stdin to the child as a memfd and never creates the
// writer, while the shell redirect uses the writer on every configuration. Of
// the two owners it is the shell's stranded writers that LSan reports (it still
// finds the address of a stranded Bun.spawn one somewhere); the Bun.spawn
// scenarios run the same teardown under ASAN all the same.
test.skipIf(!isASAN || isWindows)(
  "Buffer stdin does not leak its native writer when the child closes stdin or drains it",
  async () => {
    using cwd = tempDir("stdin-buffer-writer-leak", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawn-stdin-buffer-writer-leak-fixture.ts")],
      cwd: String(cwd),
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_DISABLE_MEMFD: "1",
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dir, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  // LSan symbolizes its report on the debug binary when it does find a leak,
  // which alone can take far longer than the default timeout.
  90_000,
);

// Reading `.stdin` after the child has already exited should still return
// the FileSink (not `undefined`) — the fix must not regress this.
test.skipIf(!isPosix)("reading .stdin after child exit still returns a FileSink", async () => {
  const p = Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  await p.exited;
  const stdin = p.stdin;
  expect(stdin).toBeDefined();
  expect(typeof (stdin as any).write).toBe("function");
});

// On Linux a Blob or buffer `stdin` does not go through a pipe: the bytes are copied into a
// memfd, and the child gets the memfd as its fd 0. The parent has no use for its own descriptor
// of the memfd once the child is spawned.
const stdinMemfd = "/memfd:spawn_stdio_stdin";

function countOpenStdinMemfds(): number {
  return readdirSync("/proc/self/fd").filter(fd => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`).startsWith(stdinMemfd);
    } catch {
      // The descriptor that listed the directory is closed by now.
      return false;
    }
  }).length;
}

test.skipIf(!isLinux)("a buffer stdin memfd is closed in the parent when the child has it", async () => {
  const text = "bytes for the child";
  const stdins = {
    Uint8Array: new TextEncoder().encode(text),
    ArrayBuffer: new TextEncoder().encode(text).buffer,
    Buffer: Buffer.from(text),
    Blob: new Blob([text]),
    Response: new Response(text),
  };
  const kinds = Object.keys(stdins) as (keyof typeof stdins)[];

  const before = countOpenStdinMemfds();
  const children = kinds.map(kind =>
    Bun.spawn({
      // Prints what its fd 0 is, then what it reads from it.
      cmd: ["sh", "-c", "readlink /proc/self/fd/0; cat"],
      stdin: stdins[kind],
      stdout: "pipe",
      stderr: "inherit",
    }),
  );
  // No child was reaped yet, and `children` keeps every Subprocess from the GC.
  const whileRunning = countOpenStdinMemfds() - before;
  const outputs = await Promise.all(children.map(child => child.stdout.text()));
  const exitCodes = await Promise.all(children.map(child => child.exited));

  expect({
    whileRunning,
    afterExit: countOpenStdinMemfds() - before,
    outputs: Object.fromEntries(kinds.map((kind, i) => [kind, outputs[i]])),
    exitCodes,
  }).toEqual({
    whileRunning: 0,
    afterExit: 0,
    outputs: Object.fromEntries(kinds.map(kind => [kind, `${stdinMemfd} (deleted)\n${text}`])),
    exitCodes: kinds.map(() => 0),
  });
});

test.skipIf(!isLinux)("Bun.spawnSync closes a buffer stdin memfd before it waits for the child", () => {
  // The parent stays inside spawnSync until the child exits, so the child is the one that looks
  // at the parent's descriptors. The parent closes the memfd right after the spawn, which can be
  // a moment after the child starts: the child polls until the memfd is gone.
  const child = `
    const fs = require("node:fs");
    const parentFds = "/proc/" + process.ppid + "/fd";
    const heldByParent = () =>
      fs.readdirSync(parentFds).filter(fd => {
        try {
          return fs.readlinkSync(parentFds + "/" + fd).startsWith(${JSON.stringify(stdinMemfd)});
        } catch {
          return false;
        }
      }).length - ${countOpenStdinMemfds()};
    const deadline = performance.now() + 2000;
    while (heldByParent() > 0 && performance.now() < deadline) Bun.sleepSync(5);
    console.log(
      JSON.stringify({
        stdin: fs.readlinkSync("/proc/self/fd/0"),
        heldByParent: heldByParent(),
        // Read only now: the bytes do not depend on the parent's descriptor.
        bytesRead: fs.readFileSync(0).length,
      }),
    );
  `;
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", child],
    env: bunEnv,
    stdin: new Uint8Array(1024 * 1024),
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(stdout.toString()).toBe(
    JSON.stringify({ stdin: `${stdinMemfd} (deleted)`, heldByParent: 0, bytesRead: 1024 * 1024 }) + "\n",
  );
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)("a buffer stdin memfd is closed when the spawn fails", () => {
  const before = { open: countOpenStdinMemfds(), made: getCounters().spawn_memfd };
  expect(() => Bun.spawn({ cmd: ["/this/program/does/not/exist"], stdin: new Uint8Array(8) })).toThrow(
    expect.objectContaining({ code: "ENOENT" }),
  );
  expect({
    open: countOpenStdinMemfds() - before.open,
    made: getCounters().spawn_memfd - before.made,
  }).toEqual({ open: 0, made: 1 });
});
