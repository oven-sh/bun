// On Linux, a subprocess's pidfd is the only exit-notification poll when
// stdio is ignored. It was registered with EPOLLONESHOT, so the kernel
// disarms the fd the instant epoll_wait returns it — before user-space
// has dispatched it. If the event is then dropped in user-space before
// `onUpdate` reaches it, the fd is left permanently disarmed with no
// re-arm path, and the subprocess's `'exit'` event arrives only when the
// next unrelated timer happens to wake the loop.
//
// The drop happens when a poll callback re-enters `us_loop_run_bun_tick`
// (e.g. an `HTMLRewriter.transform` with an async handler → `waitForPromise`
// → `autoTick`), which overwrites the shared `loop->ready_polls` /
// `num_ready_polls` / `current_ready_poll` while the outer dispatch is
// still mid-iteration.
// The outer loop resumes with the inner tick's indices and silently skips
// its own remaining events.
//
// Observed in the wild as a 5s `afterAll` timeout in
// anthropic-experimental/sandbox-runtime on GH Actions ubuntu-24.04 x86
// runners (two socat bridges SIGTERM'd together; one's event lost).
//
// Fix: register the pidfd level-triggered (no EPOLLONESHOT). A pidfd stays
// readable from process exit until close, so a dropped ready_polls slot is
// harmless — the next epoll_wait returns it again.
import { getEventLoopStats } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isDebug, isLinux } from "harness";

// pidfd path is Linux-only; macOS/FreeBSD use EVFILT_PROC which is keyed
// on pid and auto-removed by the kernel when the process is reaped.
test.skipIf(!isLinux)(
  "subprocess pidfd exit survives nested event-loop tick dropping its ready_polls slot",
  async () => {
    // Spawn a batch of short-lived children with stdio ignored so the pidfd
    // is each one's only poll. They all exit ~together, so a single
    // epoll_wait returns most of their pidfd events in one batch.
    const N = 20;
    const exits: Array<Promise<void>> = [];
    let nested = false;
    // `nestedDispatchTicks` (debug-only) counts ticks entered while an outer ready-poll
    // dispatch is mid-batch — exactly the re-entry this test relies on triggering below.
    const nestedTicksBefore = getEventLoopStats().nestedDispatchTicks;

    for (let i = 0; i < N; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      exits.push(promise);
      Bun.spawn({
        cmd: ["true"],
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        onExit() {
          // First onExit to run forces a synchronous nested tick of the
          // main uws loop. HTMLRewriter's synchronous transform() with an
          // async element handler must waitForPromise on Bun.sleep(1), which
          // resolves via the timer queue that only drains inside autoTick()
          // AFTER us_loop_run_bun_tick — so it enters autoTick → epoll_wait.
          // That overwrites the outer dispatch's ready_polls state; any
          // sibling pidfd events queued after this one in the outer batch
          // are dropped. With EPOLLONESHOT those pidfds are now disarmed in
          // the kernel with no re-arm path.
          if (!nested) {
            nested = true;
            new HTMLRewriter()
              .on("p", {
                async element() {
                  await Bun.sleep(1);
                },
              })
              .transform("<p>x</p>");
          }
          resolve();
        },
      });
    }

    // Every child must report exit. With the EPOLLONESHOT bug, the children
    // whose events were dropped never fire onExit and this await hangs until
    // the test's own 5s timeout — there is no other wake source.
    await Promise.all(exits);

    // Self-verifying trigger: the HTMLRewriter transform in onExit must have re-entered
    // the event loop from inside the outer poll dispatch. If it stops nesting (#33261),
    // this test no longer exercises the dropped-ready_polls path and must be re-armed.
    if (isDebug) {
      expect(getEventLoopStats().nestedDispatchTicks).toBeGreaterThan(nestedTicksBefore);
    }
  },
);
