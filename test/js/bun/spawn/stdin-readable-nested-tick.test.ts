// process.stdin backed by a FileReader polls its fd with EPOLLONESHOT. The
// kernel disarms the fd the instant epoll_wait returns it, before user-space
// has dispatched it. If a poll callback then re-enters us_loop_run_bun_tick
// (expect().resolves -> waitForPromise -> autoTick), the inner epoll_pwait2
// overwrites loop->ready_polls / num_ready_polls / current_ready_poll and the
// outer dispatch silently skips its remaining slots. A one-shot stdin readable
// sitting in a skipped slot is unrecoverable: the fd is disarmed in the kernel,
// FileReader::on_pull returns Pending without touching it (has_pending_read()
// stays true), and the pending reader.read() never resolves. The REPL goes
// input-deaf until more bytes force a fresh readable edge.
//
// Observed in the wild as a PTY REPL that stops responding to typing mid-
// session, with the event loop alive (timers still render), wchan=ep_poll, and
// typing more un-wedges it and delivers the stalled bytes too; probabilistic
// (~1/14k turns standalone, ~20% of 100-turn sessions under real load).
//
// Fix: register FileReader's poll level-triggered (no EPOLLONESHOT), same as
// the pidfd poll in src/spawn/process.rs. A pollable FileReader drains to
// EAGAIN on every dispatch so level-triggered cannot busy-loop; a dropped slot
// is harmless because the next epoll_wait just returns it again.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { join } from "node:path";

// The ready_polls clobber is documented behaviour on epoll+kqueue; this test
// relies on the Linux pidfd + epoll path specifically to reproduce it.
test.skipIf(!isLinux)(
  "stdin FileReader readable survives nested event-loop tick dropping its ready_polls slot",
  async () => {
    // The fixture arranges for its stdin readable and a batch of pidfd exits
    // to be reported by a single epoll_wait, with the pidfds first (it spins
    // synchronously while /bin/true exits and our byte lands). The first
    // onExit then forces a nested tick that drops the rest of the outer batch.
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "stdin-readable-nested-tick-fixture.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    let out = "";
    const reader = proc.stdout.getReader();
    while (!out.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    proc.stdin.write("X");
    proc.stdin.flush();

    // With the one-shot bug: stdin's fd is disarmed before dispatch, the
    // pending read never resolves, and the fixture hangs until the test
    // timeout with no other wake source.
    const rest = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    })();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, rest]);

    expect({ out: out.trim(), stderr, exitCode }).toEqual({
      out: "READY\nGOT:X",
      stderr: "",
      exitCode: 0,
    });
  },
);
