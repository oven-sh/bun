import { test, expect, vi } from "bun:test";

test("fake timers", async () => {
  let timeoutTriggered = false;
  expect(vi.useFakeTimers()).toBe(vi);
  setTimeout(() => {
    timeoutTriggered = true;
  }, 0);
  expect(vi.useRealTimers()).toBe(vi);
  await Bun.sleep(10);
  expect(timeoutTriggered).toBe(false); // it was created as a fake timer, so it should not have triggered
});
