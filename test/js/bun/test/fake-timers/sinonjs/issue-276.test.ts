// https://github.com/sinonjs/fake-timers/blob/main/test/issue-276-test.js

import { describe, test } from "bun:test";

describe("#276 - remove config.target", () => {
  test.skip("should throw on using `config.target`", () => {
    // This test is specific to FakeTimers.install API
    // Bun's vi.useFakeTimers() has a different API
  });
});
