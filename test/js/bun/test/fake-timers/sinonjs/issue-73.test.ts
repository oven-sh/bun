"use strict";

import { FakeTimers, assert } from "./helpers/setup-tests";

describe("issue #73", function () {
  it("should install with date object", function () {
    const date = new Date("2015-09-25");
    const clock = FakeTimers.install({ now: date });
    assert.same(clock.now, 1443139200000);
    clock.uninstall();
  });
});
