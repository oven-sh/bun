// This test reproduces a UAF bug where Atomics.waitAsync creates a DispatchTimer
// which creates a new WTFTimer, violating Bun's assumption that there's only one WTFTimer per VM.
// The UAF occurs when the timer fires and continues to reference `this` after it's been freed.

import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.todoIf(isWindows)("Atomics.waitAsync with setTimeout does not crash (UAF bug)", async () => {
  // Run 2 times to trigger the UAF with ASAN
  for (let i = 0; i < 2; i++) {
    const buffer = new SharedArrayBuffer(16);
    const view = new Int32Array(buffer);

    Atomics.store(view, 0, 0);

    const result = Atomics.waitAsync(view, 0, 0, 1); // 1ms timeout
    expect(result.async).toBe(true);
    expect(result.value).toBeInstanceOf(Promise);

    // This setTimeout would trigger the UAF bug by creating another WTFTimer
    const timeoutPromise = new Promise<string>(resolve => {
      setTimeout(() => {
        resolve("hi");
      }, 5); // 5ms timeout
    });

    const [waitResult, timeoutResult] = await Promise.all([result.value, timeoutPromise]);

    expect(waitResult).toBe("timed-out");
    expect(timeoutResult).toBe("hi");
  }
});

test.todoIf(isWindows)("Multiple Atomics.waitAsync calls do not crash", async () => {
  const buffer = new SharedArrayBuffer(16);
  const view = new Int32Array(buffer);

  Atomics.store(view, 0, 0);
  Atomics.store(view, 1, 0);
  Atomics.store(view, 2, 0);

  const result1 = Atomics.waitAsync(view, 0, 0, 10);
  const result2 = Atomics.waitAsync(view, 1, 0, 20);
  const result3 = Atomics.waitAsync(view, 2, 0, 30);

  expect(result1.async).toBe(true);
  expect(result2.async).toBe(true);
  expect(result3.async).toBe(true);

  const [r1, r2, r3] = await Promise.all([result1.value, result2.value, result3.value]);

  expect(r1).toBe("timed-out");
  expect(r2).toBe("timed-out");
  expect(r3).toBe("timed-out");
});
