// On Linux, `Bun.spawn` acquires a pidfd via `pidfd_open(2)` after
// `posix_spawn` has already succeeded. When the process is at its fd limit,
// `pidfd_open` fails with EMFILE. Previously the catch-all handler for that
// error issued a blocking `wait4(pid, 0)` to avoid leaking a zombie, which
// froze the JS thread for the child's entire lifetime and then threw EMFILE
// for a child whose side effects had fully run. A long-running or daemon child
// turned this into a permanent event-loop hang.
//
// With the fix, `Bun.spawn` never blocks on or reports failure for a child
// that `posix_spawn` accepted: if no pidfd is available it falls back to the
// waiter thread for that process and returns a `Subprocess` immediately.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// pidfd_open is Linux-only; on other platforms the reap path never needs an
// fd after the child is live.
test.skipIf(!isLinux)("Bun.spawn falls back to the waiter thread when pidfd_open hits EMFILE", async () => {
  // Run the probe in a child with a low RLIMIT_NOFILE so the parent test
  // runner's fd table is never disturbed.
  const fixture = `
      const fs = require("node:fs");
      // Exhaust the fd table, then reopen a small hole: three "pipe" stdio
      // slots need six socketpair fds (which posix_spawn's CLOEXEC handling
      // halves after the fork), leaving zero for pidfd_open.
      const held = [];
      try { for (;;) held.push(fs.openSync("/dev/null", "r")); } catch {}
      let hole = Math.min(6, held.length);
      for (let i = 0; i < hole; i++) fs.closeSync(held.pop());

      const t0 = performance.now();
      let thrown = null, proc = null;
      // Hunt for the hole size where posix_spawn succeeds but pidfd_open is
      // the call that hits EMFILE. If we undershoot, socketpair fails first
      // (atomic failure before fork); widen the hole and retry. If we never
      // hit the target errno the environment can't reproduce the race and the
      // test is a no-op.
      while (true) {
        try {
          proc = Bun.spawn({
            cmd: ["sleep", "1"],
            stdout: "pipe", stderr: "pipe", stdin: "pipe",
          });
          break;
        } catch (e) {
          if ((e?.syscall === "socketpair" || e?.syscall === "open") && held.length) {
            fs.closeSync(held.pop());
            hole++;
            continue;
          }
          thrown = { code: e?.code, syscall: e?.syscall };
          break;
        }
      }
      const spawnMs = performance.now() - t0;
      for (const fd of held) fs.closeSync(fd);
      const exit = proc ? await proc.exited : null;
      console.log(JSON.stringify({
        hole,
        spawnMs: Math.round(spawnMs),
        thrown,
        gotProc: !!proc,
        exit,
      }));
    `;

  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", `ulimit -n 256 && exec "$@"`, "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const line = stdout.trim().split("\n").pop() ?? "";
  let result: {
    hole: number;
    spawnMs: number;
    thrown: { code?: string; syscall?: string } | null;
    gotProc: boolean;
    exit: number | null;
  };
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error(`probe did not emit JSON\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  // Invariant: Bun.spawn never blocks on, and never reports failure for, a
  // child that ran. Before the fix this reported
  // thrown = {code: "EMFILE", syscall: "pidfd_open"} with spawnMs at the
  // child's full lifetime (~1000ms here).
  expect(result).toMatchObject({ thrown: null, gotProc: true, exit: 0 });
  // spawn() must return promptly, not after the child's 1s lifetime.
  expect(result.spawnMs).toBeLessThan(500);
  expect(exitCode).toBe(0);
});

// With all stdio inherited there are no socketpair fds to release after
// posix_spawn, so the waiter thread's one-time eventfd() is attempted at the
// same fd pressure that just failed pidfd_open. Bun.spawn must not abort the
// process in that case.
test.skipIf(!isLinux)("Bun.spawn with inherited stdio at fd exhaustion does not panic", async () => {
  const fixture = `
    const fs = require("node:fs");
    const { which } = require("bun");
    const sleep = which("sleep");
    const held = [];
    try { for (;;) held.push(fs.openSync("/dev/null", "r")); } catch {}
    let proc = null, thrown = null;
    try {
      proc = Bun.spawn({
        cmd: [sleep, "0.1"],
        stdin: "inherit", stdout: "inherit", stderr: "inherit",
      });
    } catch (e) { thrown = { code: e?.code, syscall: e?.syscall }; }
    for (const fd of held) fs.closeSync(fd);
    const exit = proc ? await proc.exited : null;
    process.stdout.write(JSON.stringify({ gotProc: !!proc, thrown, exit }) + "\\n");
  `;
  await using proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", `ulimit -n 256 && exec "$@"`, "sh", bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const line = stdout.trim().split("\n").pop() ?? "";
  let result: { gotProc: boolean; thrown: unknown; exit: number | null };
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error(`probe did not emit JSON\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  expect(result).toMatchObject({ gotProc: true, thrown: null, exit: 0 });
  expect(exitCode).toBe(0);
});
