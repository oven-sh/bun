import { jest, test } from "bun:test";

// https://github.com/oven-sh/bun/pull/33359#discussion_r3556322148
test("drain_timers terminates when mocked time > CLOCK_MONOTONIC uptime", async () => {
  // Real event-loop ticks so the GcRepeating / WTFTimer / BunTest nodes are
  // armed (real-time deadlines) before fake timers are installed.
  for (let i = 0; i < 4; i++) await Bun.file(import.meta.path).text();

  jest.useFakeTimers();
  try {
    // Push the mocked monotonic clock past any plausible machine uptime
    // (advanceTimersByTime caps at u32 ms, so loop in ~40-day chunks).
    for (let i = 0; i < 100; i++) jest.advanceTimersByTime(40 * 24 * 3600 * 1000);
    // A real I/O await reaches All::drain_timers. Pre-fix that loop cached
    // `now = AllowMockedTime`, so every allow_fake_timers()==false node
    // (GC, WTFTimer, test timeout) looked overdue; those that re-arm at
    // ForceRealTime on fire were re-inserted still "overdue" and the loop spun.
    for (let i = 0; i < 4; i++) await Bun.file(import.meta.path).text();
  } finally {
    jest.useRealTimers();
  }
  console.log("DRAIN_OK");
});
