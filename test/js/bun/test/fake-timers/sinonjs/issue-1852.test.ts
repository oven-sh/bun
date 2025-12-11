"use strict";

import { FakeTimers, assert } from "./helpers/setup-tests";

describe("issue sinon#1852", function () {
  it("throws when creating a clock and global has no Date", function () {
    assert.exception(function () {
      FakeTimers.withGlobal({
        setTimeout: function () {},
        clearTimeout: function () {},
      });
    });
  });
});
