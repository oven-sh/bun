import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// A thread-pool `fs.write` that is still blocked in the kernel when
// `process.exit()` runs must not crash the process when it later completes.
// `BUN_DESTRUCT_VM_ON_EXIT=1` (set by the CI runner) makes `global_exit`
// call `VirtualMachine::destroy()` on the main-thread VM before `libc::exit`;
// a work-pool completion that lands after that posts to the event loop of a
// VM whose `has_terminated` is already true. The main-thread VM box is never
// freed, so the push is harmless and the debug assert was a false positive.
//
// Deterministically reproducing the race requires something to unblock the
// kernel write *after* `destroy()` has returned. The child registers a libc
// atexit handler (via bun:ffi's tinycc) that closes the FIFO reader and
// then sleeps, so the blocked `write()` returns EPIPE while the main thread
// is still inside the atexit chain.
//
// Linux-only: relies on mkfifo, blocking-pipe write semantics, and glibc's
// `__cxa_atexit`.
test.skipIf(!isLinux)(
  "process.exit with a thread-pool fs.write still blocked in the kernel exits cleanly",
  async () => {
    using dir = tempDir("fs-write-exit-race", {
      "helper.c": `
        #include <unistd.h>
        extern int __cxa_atexit(void (*)(void *), void *, void *);
        static int g_fd = -1;
        static void do_close_and_sleep(void *unused) {
          (void)unused;
          if (g_fd >= 0) close(g_fd);
          usleep(300000);
        }
        void schedule_close_at_exit(int fd) {
          g_fd = fd;
          __cxa_atexit(do_close_and_sleep, 0, 0);
        }
      `,
      "child.js": `
        const fs = require("node:fs");
        const path = require("node:path");
        const cp = require("node:child_process");
        const { cc, FFIType } = require("bun:ffi");

        const fifo = path.join(__dirname, "pipe");
        cp.spawnSync("mkfifo", [fifo]);

        const rd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const wd = fs.openSync(fifo, fs.constants.O_WRONLY);

        const { symbols } = cc({
          source: path.join(__dirname, "helper.c"),
          symbols: {
            schedule_close_at_exit: { args: [FFIType.i32], returns: FFIType.void },
          },
        });
        symbols.schedule_close_at_exit(rd);

        // Larger than any pipe capacity so write() blocks in the kernel until
        // the reader fd closes.
        fs.write(wd, Buffer.alloc(1 << 21, 0x41), () => {});

        setTimeout(() => {
          process.stdout.write("alive\\n");
          process.exit(0);
        }, 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "child.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "alive\n", stderr: "", exitCode: 0 });
  },
  // On an unfixed debug build the panic hook symbolizes the backtrace through
  // llvm-symbolizer (~5s) before the process terminates.
  15_000,
);
