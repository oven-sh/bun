import { test } from "bun:test";
import { setTimeout } from "node:timers";

test("unref is possible", () => {
  const timer = setTimeout(() => {
    throw new Error("should not be called");
  }, 1000);
  timer.unref();
  clearTimeout(timer);
});
