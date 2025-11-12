import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { promisify } from "node:util";

const utilPromisifyAvailable = typeof promisify === "function";
const setImmediatePresent = typeof setImmediate === "function";

describe("#347 - Support util.promisify once installed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  if (utilPromisifyAvailable) {
    test.todo("setTimeout", async () => {
      // TODO: Need async timer advancement API in Bun's fake timers
      let resolved = false;
      promisify(global.setTimeout)(100).then(() => {
        resolved = true;
      });

      // vi.advanceTimersByTimeAsync doesn't exist yet
      vi.advanceTimersByTime(100);
      expect(resolved).toBe(true);
    });

    if (setImmediatePresent) {
      test.todo("setImmediate", async () => {
        // TODO: Need async timer advancement API in Bun's fake timers
        let resolved = false;
        promisify(global.setImmediate)().then(() => {
          resolved = true;
        });

        // vi.advanceTimersByTimeAsync doesn't exist yet
        vi.advanceTimersByTime(0);
        expect(resolved).toBe(true);
      });
    }
  }
});
