"use strict";

import { FakeTimers } from "./helpers/setup-tests";

describe("issue #516 - not resilient to changes on Intl", function () {
  it.failing("should successfully install the timer", function () {
    const originalIntlProperties = Object.getOwnPropertyDescriptors(global.Intl);
    for (const key of Object.keys(originalIntlProperties)) {
      delete global.Intl[key];
    }
    try {
      const clock = FakeTimers.createClock();
      clock.tick(16);
    } finally {
      Object.defineProperties(global.Intl, originalIntlProperties);
    }
  });
});
