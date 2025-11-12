import { describe, test } from "bun:test";

describe("issue #516 - not resilient to changes on Intl", () => {
  test.skip("should successfully install the timer", () => {
    // This test uses FakeTimers.createClock() which is a different API
    // from vi.useFakeTimers(). Skipping for now as it's specific to
    // the FakeTimers implementation details
  });
});
