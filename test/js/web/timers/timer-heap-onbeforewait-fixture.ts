// us_loop_run_bun_tick computes the epoll/kqueue poll timeout from the bun
// timer heap on the Rust side (timer::All::get_timeout), then runs
// Bun__JSC_onBeforeWait before parking. onBeforeWait calls
// heap.stopIfNecessary(), which can synchronously run a GC slice that arms
// RunLoop::TimerBase timers (IncrementalSweeper, GCActivityCallback) into the
// wtf_timers heap. A timer armed there after get_timeout() has already
// returned must still bound the park, so the event loop re-reads the heap
// after onBeforeWait and clamps the timeout.
//
// This fixture arms a WTF DispatchTimer from inside onBeforeWait via
// bun:internal-for-testing and checks it resolves on time rather than after
// the only other pending timer's deadline.
//
// Run with BUN_JSC_sweepSynchronously=1 so module-load GC does not leave a
// short-deadline IncrementalSweeper in the wtf_timers heap ahead of the
// watchdog; the watchdog must be the soonest deadline get_timeout() sees.

const { timerInternals } = require("bun:internal-for-testing");

// Only short regular-heap timer, so get_timeout() returns ~WATCHDOG ms (the
// 1 s GC repeating timer is later).
const WATCHDOG = 500;
setTimeout(() => {
  console.log("STALE");
  process.exit(1);
}, WATCHDOG);

const t0 = performance.now();
// On the next onBeforeWait, arm a 20 ms RunLoop::DispatchTimer (which inserts
// into the wtf_timers heap, exactly as heap.stopIfNecessary() does for the
// IncrementalSweeper).
const p = timerInternals.armWTFTimerOnNextBeforeWait(20);
// Falling off top-level here enters auto_tick_active -> get_timeout()
// (WATCHDOG ms) -> us_loop_run_bun_tick -> onBeforeWait (arms 20 ms) ->
// clamp -> epoll_pwait2/kevent64.
p.then(() => {
  const dt = performance.now() - t0;
  if (dt < WATCHDOG * 0.8) {
    console.log("OK");
    process.exit(0);
  } else {
    console.log("LATE " + dt.toFixed(0));
    process.exit(1);
  }
});
