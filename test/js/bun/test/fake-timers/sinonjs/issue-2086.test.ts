"use strict";

import { FakeTimers, assert } from "./helpers/setup-tests";

describe("issue #sinonjs/2086 - don't install setImmediate in unsupported environment", function () {
  let clock;

  if (typeof setImmediate === "undefined") {
    afterEach(function () {
      clock.uninstall();
    });

    it("should not install setImmediate", function () {
      clock = FakeTimers.install();

      assert.isUndefined(global.setImmediate);
    });
  }
});
