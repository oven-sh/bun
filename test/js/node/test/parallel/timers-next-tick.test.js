//#FILE: test-timers-next-tick.js
//#SHA1: c6c6f667dac048dd0aed0a244e484ae1f0127d53
//-----------------
"use strict";

// This test verifies that the next tick queue runs after each
// individual Timeout, as well as each individual Immediate.

test("next tick queue runs after each Timeout and Immediate", async () => {
  const timeoutSpy1 = jest.fn();
  const timeoutSpy2 = jest.fn();
  const immediateSpy1 = jest.fn();
  const immediateSpy2 = jest.fn();

  setTimeout(timeoutSpy1, 1);
  const t2 = setTimeout(jest.fn(), 1);
  const t3 = setTimeout(jest.fn(), 1);
  setTimeout(timeoutSpy2, 1);

  await new Promise(resolve => setTimeout(resolve, 5));

  setImmediate(immediateSpy1);
  const i2 = setImmediate(jest.fn());
  const i3 = setImmediate(jest.fn());
  setImmediate(immediateSpy2);

  await new Promise(resolve => setImmediate(resolve));

  expect(timeoutSpy1).toHaveBeenCalledTimes(1);
  expect(timeoutSpy2).toHaveBeenCalledTimes(1);
  expect(immediateSpy1).toHaveBeenCalledTimes(1);
  expect(immediateSpy2).toHaveBeenCalledTimes(1);

  // Confirm that clearing Timeouts from a next tick doesn't explode.
  process.nextTick(() => {
    clearTimeout(t2);
    clearTimeout(t3);
  });

  // Confirm that clearing Immediates from a next tick doesn't explode.
  process.nextTick(() => {
    clearImmediate(i2);
    clearImmediate(i3);
  });

  // Wait for next tick to complete
  await new Promise(process.nextTick);
});

//<#END_FILE: test-timers-next-tick.js
