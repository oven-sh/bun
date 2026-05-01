"use strict";

import { FakeTimers, assert, setImmediatePresent, utilPromisify } from "./helpers/setup-tests";

describe("#347 - Support util.promisify once installed", function () {
  let clock;
  beforeEach(function () {
    clock = FakeTimers.install();
  });

  afterEach(function () {
    clock.uninstall();
  });

  it.failing("setTimeout", function () {
    let resolved = false;
    utilPromisify(global.setTimeout)(100).then(function () {
      resolved = true;
    });

    return clock.tickAsync(100).then(function () {
      assert.isTrue(resolved);
    });
  });

  it.failing("setImmediate", function () {
    if (!setImmediatePresent) {
      this.skip();
    }

    let resolved = false;
    utilPromisify(global.setImmediate)().then(function () {
      resolved = true;
    });

    return clock.tickAsync(0).then(function () {
      assert.isTrue(resolved);
    });
  });
});
