// A subprocess stdout/stderr pipe reader is registered one-shot on every POSIX
// platform (`OneShotFlag::Dispatch`: EPOLLONESHOT on Linux, EV_DISPATCH on
// kqueue). When the reader's readable/EOF event is dropped in user-space after
// epoll_wait/kevent has already returned it, the kernel has disarmed the fd and
// nothing re-arms it: `onUpdate` (which sets the re-arm flag) never ran. The
// output is then never read and its consumer waits forever.
//
// The drop happens when a poll callback re-enters us_loop_run_bun_tick while
// the outer us_internal_dispatch_ready_polls is still iterating the batch. The
// inner tick's epoll_wait/kevent overwrites the shared loop->ready_polls /
// num_ready_polls / current_ready_poll, so the outer loop resumes against the
// inner batch and silently skips its own remaining events.
//
// Bun.$ hits this without any test-only poke: when a command finishes, finish()
// wraps the promise resolution in loop.enter()/loop.exit(), and loop.exit()
// drains microtasks inline, running the command's .then continuation *during*
// the poll dispatch. If that continuation synchronously waits on a promise
// (waitForPromise -> autoTick), the nested tick clobbers the batch and sibling
// commands' one-shot pipe-EOF events are lost. Those commands' shells never see
// EOF, so their promises never resolve.
//
// PR #30301 fixed the same batch corruption for the Linux pidfd by making it
// level-triggered, but left the pipe readers one-shot and assumed a dropped
// pipe event is reported again via EPOLLHUP on the next wait. It is not: a
// disarmed one-shot fd reports nothing until it is re-armed, which never
// happens. On macOS the process-exit watch (EVFILT_PROC) is also still
// one-shot, so the batch corruption loses exit events there too.
//
// Fix: when us_loop_run_bun_tick detects it is nested inside a mid-iteration
// dispatch, it dispatches the outer batch's remaining entries before its own
// epoll_wait/kevent can overwrite them, so no one-shot event is dropped.
import { expect, test } from "bun:test";
import { getEventLoopStats } from "bun:internal-for-testing";
import { isWindows } from "harness";

// The uws ready-poll batch only exists on the POSIX event loop; on Windows
// libuv drives readiness through a different path (and the stats below read 0).
test.skipIf(isWindows)(
  "a batch of Bun.$ commands survives a nested tick from one command's continuation",
  async () => {
    const N = 34;
    let nested = false;
    // Captured from inside the first continuation to run, then asserted after
    // the batch settles. They make the trigger self-checking: if either
    // implementation detail this test leans on is refactored away, these fail
    // loudly instead of leaving the test vacuously green against a broken
    // event loop.
    let tickDepthInContinuation = -1;
    let pendingSiblingsInContinuation = -1;
    let sawNestedTick = false;

    const cmds = Array.from({ length: N }, (_, i) => {
      const cmd = Bun.$`printf %s out-${i}`.quiet();
      // The first command to settle runs this continuation inline, during the
      // poll dispatch (finish() -> loop.exit() -> drainMicrotasks). Waiting on
      // a promise here forces a nested us_loop_run_bun_tick; without the fix it
      // clobbers the outer batch and drops sibling commands' one-shot pipe-EOF
      // events, which the kernel has already disarmed.
      cmd.then(
        () => {
          if (nested) return;
          nested = true;

          // Precondition 1: we really are running inline from inside a poll
          // dispatch (tickDepth >= 1) with undispatched sibling events still in
          // the live batch (pendingReadyPolls > 0). If finish() stops draining
          // microtasks inline, tickDepth reads 0 here. If the continuation no
          // longer lands inside the batch that holds the siblings' events,
          // pendingReadyPolls reads 0. Either way the test fails instead of
          // silently not exercising the bug.
          const stats = getEventLoopStats();
          tickDepthInContinuation = stats.tickDepth;
          pendingSiblingsInContinuation = stats.pendingReadyPolls;

          // Precondition 2: a nested tick actually runs before this
          // continuation returns. Bun.sleep(0)'s continuation can only have run
          // by the time the synchronous wait below returns if an event-loop
          // tick ran inside it. If expect().resolves stops blocking
          // synchronously, `sawNestedTick` is still false right afterwards.
          Bun.sleep(0).then(() => {
            sawNestedTick = true;
          });
          expect(Bun.sleep(1)).resolves.toBe(undefined);
        },
        () => {},
      );
      return cmd;
    });

    // With the dropped-slot bug, the commands whose pipe-EOF was skipped never
    // finish and this hangs until the test times out. There is no other wake
    // source for a disarmed one-shot pipe.
    const results = await Promise.all(cmds);

    expect(tickDepthInContinuation).toBeGreaterThanOrEqual(1);
    expect(pendingSiblingsInContinuation).toBeGreaterThan(0);
    expect(sawNestedTick).toBe(true);

    for (let i = 0; i < N; i++) {
      expect(results[i].stdout.toString()).toBe(`out-${i}`);
    }
  },
);
