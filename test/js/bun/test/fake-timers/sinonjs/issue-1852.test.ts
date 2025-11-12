import { describe, test } from "bun:test";

describe("issue sinon#1852", () => {
  test.skip("throws when creating a clock and global has no Date", () => {
    // This test is specific to FakeTimers.withGlobal API
    // which is different from vi.useFakeTimers()
  });
});
