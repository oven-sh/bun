// A subprocess stdout/stderr pipe reader is registered one-shot on Linux
// (EPOLLONESHOT, via OneShotFlag::Dispatch). When the reader's readable/EOF
// event is dropped in user-space after epoll_wait has already returned it, the
// kernel has disarmed the fd and nothing re-arms it: `onUpdate` (which sets the
// re-arm flag) never ran. The output is then never read and the consumer waits
// forever.
//
// The drop happens when a poll callback re-enters us_loop_run_bun_tick while the
// outer us_internal_dispatch_ready_polls is still iterating the batch. The inner
// tick runs epoll_wait again, overwriting the shared loop->ready_polls /
// num_ready_polls / current_ready_poll, so the outer loop resumes against the
// inner batch and silently skips its own remaining events.
//
// Bun.$ hits this without any test-only poke: when a command finishes, finish()
// wraps the promise resolution in loop.enter()/loop.exit(), and loop.exit()
// drains microtasks inline, running the command's .then continuation *during*
// the poll dispatch. If that continuation synchronously waits on a promise
// (waitForPromise -> autoTick), the nested tick clobbers the batch and sibling
// commands' one-shot pipe-EOF events are lost. The command's shell never sees
// EOF, so its promise never resolves.
//
// PR #30301 fixed this for the pidfd by making it level-triggered, but left the
// pipe readers one-shot and assumed a dropped pipe event is reported again via
// EPOLLHUP on the next wait. It is not: a disarmed EPOLLONESHOT fd reports
// nothing until it is re-armed, which never happens.
//
// Fix: us_loop_run_bun_tick snapshots the outer ready-poll batch before a nested
// tick can clobber it and restores it afterward, so no one-shot event is dropped.
import { expect, test } from "bun:test";
import { isLinux } from "harness";

// One-shot pipe polls are the POSIX event-loop path; on Windows libuv drives
// readiness. The deterministic repro relies on EPOLLONESHOT pipe readers, so gate
// it to Linux like the sibling pidfd regression test.
test.skipIf(!isLinux)(
  "a batch of Bun.$ commands survives a nested tick from one command's continuation",
  async () => {
    const N = 34;
    let nested = false;

    const cmds = Array.from({ length: N }, (_, i) => {
      const cmd = Bun.$`printf %s out-${i}`.quiet();
      // The first command to settle runs this continuation inline, during the
      // poll dispatch (finish() -> loop.exit() -> drainMicrotasks). Waiting on a
      // promise here forces a nested us_loop_run_bun_tick; without the fix it
      // clobbers the outer batch and drops sibling commands' one-shot pipe-EOF
      // events, which EPOLLONESHOT has already disarmed in the kernel.
      cmd.then(
        () => {
          if (!nested) {
            nested = true;
            expect(Bun.sleep(1)).resolves.toBe(undefined);
          }
        },
        () => {},
      );
      return cmd;
    });

    // With the dropped-slot bug, the commands whose pipe-EOF was skipped never
    // finish and this hangs until the test times out. There is no other wake
    // source for a disarmed one-shot pipe.
    const results = await Promise.all(cmds);

    for (let i = 0; i < N; i++) {
      expect(results[i].stdout.toString()).toBe(`out-${i}`);
    }
  },
);
