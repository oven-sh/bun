// Regression test for issue #11680
// https://github.com/oven-sh/bun/issues/11680
//
// This issue caused a floating point exception (SIGILL) on macOS when running
// long-lived processes like `nuxt dev`. The crash occurred in os.loadavg() when
// the system's fscale value was 0, causing division by zero.
//
// Fixed in commit 731a85f80d (June 8, 2024) by adding zero-check guards
// before division in the load average calculation.

import { expect, test } from "bun:test";
import { connect } from "node:net";
import os from "node:os";

test("os.loadavg() should not crash with floating point error", () => {
  // This should not throw a floating point exception even on systems
  // where fscale might be 0 (macOS-specific edge case)
  const loadavg = os.loadavg();

  expect(loadavg).toBeArrayOfSize(3);
  expect(loadavg[0]).toBeNumber();
  expect(loadavg[1]).toBeNumber();
  expect(loadavg[2]).toBeNumber();

  // All values should be finite (not NaN or Infinity)
  expect(Number.isFinite(loadavg[0])).toBe(true);
  expect(Number.isFinite(loadavg[1])).toBe(true);
  expect(Number.isFinite(loadavg[2])).toBe(true);
});

test("DNS resolution with socket connection should not crash", async () => {
  // The original issue occurred during DNS resolution + socket connection
  // in a long-running Nuxt dev server
  await new Promise<void>((resolve, reject) => {
    const socket = connect({
      host: "example.com",
      port: 80,
      timeout: 5000,
    });

    socket.on("connect", () => {
      socket.end();
      resolve();
    });

    socket.on("error", err => {
      // Connection errors are fine - we're testing that it doesn't crash
      resolve();
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve();
    });
  });
});
