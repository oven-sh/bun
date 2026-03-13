"use strict";

import { FakeTimers, assert } from "./helpers/setup-tests";

describe("issue #504", function () {
  it("should not mutate Date class", function () {
    const priorDate = new Date();
    assert.equals(priorDate instanceof Date, true);

    const clock = FakeTimers.install();

    const afterDate = new Date();
    assert.equals(priorDate instanceof Date, true);
    assert.equals(afterDate instanceof Date, true);

    clock.uninstall();
  });
});
