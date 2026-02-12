import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26965
// setInterval(fn, 16) fires with ~28ms intervals on Windows instead of ~16ms
// due to the default Windows timer resolution being ~15.6ms.
// The fix calls timeBeginPeriod(1) at startup to set 1ms resolution.
test("setInterval fires at approximately the requested interval", async () => {
  const interval = 16;
  const count = 50;

  const times: number[] = [];
  let last = performance.now();

  await new Promise<void>(resolve => {
    let i = 0;
    const id = setInterval(() => {
      const now = performance.now();
      times.push(now - last);
      last = now;
      i++;
      if (i >= count) {
        clearInterval(id);
        resolve();
      }
    }, interval);
  });

  // Drop the first few measurements as they can be noisy during startup
  const stable = times.slice(5);
  const avg = stable.reduce((a, b) => a + b, 0) / stable.length;

  // The average interval should be close to the requested 16ms.
  // Before the fix on Windows, this was ~28ms (nearly 2x).
  // Allow up to 22ms to account for normal scheduling jitter,
  // but catch the ~28ms+ intervals caused by 15.6ms timer resolution.
  expect(avg).toBeLessThan(22);
  expect(avg).toBeGreaterThan(10);
});
