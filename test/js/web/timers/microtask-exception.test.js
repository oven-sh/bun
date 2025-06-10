import { it, expect } from "bun:test";

it("queueMicrotask exception handling", async () => {
  // Test that exceptions in microtasks are properly reported and don't crash
  const errors = [];
  const originalOnError = globalThis.onerror;

  // Set up error handler to capture unhandled exceptions
  globalThis.onerror = (message, source, lineno, colno, error) => {
    errors.push({ message, error });
    return true; // Prevent default error handling
  };

  try {
    await new Promise(resolve => {
      let microtaskRan = false;

      // Queue a microtask that throws
      queueMicrotask(() => {
        throw new Error("Exception from microtask!");
      });

      // Queue another microtask to verify execution continues
      queueMicrotask(() => {
        microtaskRan = true;
      });

      // Wait a bit for microtasks to run
      setTimeout(() => {
        expect(microtaskRan).toBe(true);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].error.message).toBe("Exception from microtask!");
        resolve();
      }, 10);
    });
  } finally {
    // Restore original error handler
    globalThis.onerror = originalOnError;
  }
});

it("process.nextTick exception handling", async () => {
  // Test that exceptions in nextTick callbacks are properly reported
  const errors = [];
  const originalOnError = globalThis.onerror;

  globalThis.onerror = (message, source, lineno, colno, error) => {
    errors.push({ message, error });
    return true;
  };

  try {
    await new Promise(resolve => {
      let nextTickRan = false;

      // Use nextTick which also uses the microtask queue
      process.nextTick(() => {
        throw new Error("Exception from nextTick!");
      });

      process.nextTick(() => {
        nextTickRan = true;
      });

      setTimeout(() => {
        expect(nextTickRan).toBe(true);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].error.message).toBe("Exception from nextTick!");
        resolve();
      }, 10);
    });
  } finally {
    globalThis.onerror = originalOnError;
  }
});
