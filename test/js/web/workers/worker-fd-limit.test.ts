import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// On Linux, a Worker's event loop consumes an epoll fd, a timerfd (sweep timer)
// and an eventfd (wakeup async), and then the per-VM GC controller lazily
// creates two more timerfds. When the process is near RLIMIT_NOFILE,
// timerfd_create(2) for those GC timers returns EMFILE. Previously the Rust
// wrapper around us_create_timer would panic on the documented NULL return,
// aborting the whole process. The GC controller is an optimisation, so it
// should disable itself and let the Worker proceed (or fail later with a
// catchable error event) instead of taking the process down.
//
// Linux-only: on kqueue and libuv, us_create_timer does not allocate an fd.
//
// With 4 spare fds: loop init (3 fds) succeeds, the first GC timerfd succeeds,
// and the second GC timerfd hits EMFILE. With the fix, the controller frees the
// first timerfd and disables itself, leaving one fd for the Worker to open its
// script with.
test.skipIf(!isLinux)(
  "new Worker() does not abort the process on timerfd_create EMFILE near RLIMIT_NOFILE",
  async () => {
    using dir = tempDir("worker-fd-limit", {
      "worker.mjs": `postMessage(42)\n`,
      "main.mjs": `
        import * as fs from "node:fs";
        const held = [];
        for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }
        for (let i = 0; i < 4; i++) { const fd = held.pop(); if (fd !== undefined) fs.closeSync(fd); }
        const { promise, resolve } = Promise.withResolvers();
        const w = new Worker(new URL("./worker.mjs", import.meta.url));
        w.onerror = e => resolve("error:" + (e?.message ?? e));
        w.onmessage = e => resolve("message:" + e.data);
        const outcome = await promise;
        for (const fd of held) fs.closeSync(fd);
        process.stdout.write("SURVIVED " + outcome + "\\n");
      `,
    });

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 256 && exec "$@"`, "sh", bunExe(), "main.mjs"],
      env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // The Worker may either run to completion (message:42) or surface a
    // catchable error for a later fd-consuming open (error:...). Either is
    // fine; what must not happen is a panic/SIGABRT.
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: expect.stringMatching(/^SURVIVED (message:42|error:.+)\n$/),
      stderr: expect.any(String),
      exitCode: 0,
      signalCode: null,
    });
  },
);
