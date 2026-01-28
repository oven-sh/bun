"use strict";

import { FakeTimers, assert, refute, sinon } from "./helpers/setup-tests";

describe("issue #2449: permanent loss of native functions", function () {
  it.failing("should not fake faked timers", function () {
    const currentTime = new Date().getTime();
    const date1 = new Date("2015-09-25");
    const date2 = new Date("2015-09-26");
    let clock = FakeTimers.install({ now: date1 });
    assert.same(clock.now, date1.getTime());
    assert.same(new Date().getTime(), 1443139200000);
    assert.exception(function () {
      FakeTimers.install({ now: date2 });
    });
    clock.uninstall();
    clock = FakeTimers.install({ now: date2 });
    assert.same(clock.now, date2.getTime());
    clock.uninstall();
    assert.near(new Date().getTime(), currentTime, 10);
  });

  it.failing("should not fake faked timers on a custom target", function () {
    const context = {
      Date: Date,
      setTimeout: sinon.fake(),
      clearTimeout: sinon.fake(),
    };
    let clock = FakeTimers.withGlobal(context).install({
      ignoreMissingTimers: true,
    });
    assert.exception(function () {
      clock = FakeTimers.withGlobal(context).install({
        ignoreMissingTimers: true,
      });
    });
    clock.uninstall();

    // After uninstaling we should be able to install without issue
    clock = FakeTimers.withGlobal(context).install({
      ignoreMissingTimers: true,
    });
    clock.uninstall();
  });

  it.failing(
    "should not allow a fake on a custom target if the global is faked and the context inherited from the global",
    function () {
      const globalClock = FakeTimers.install();
      assert.equals(new Date().getTime(), 0);
      const setTimeoutFake = sinon.fake();
      const context = {
        Date: Date,
        setTimeout: setTimeoutFake,
        clearTimeout: sinon.fake(),
      };
      assert.equals(new context.Date().getTime(), 0);
      assert.exception(function () {
        FakeTimers.withGlobal(context).install({
          ignoreMissingTimers: true,
        });
      });

      globalClock.uninstall();
      refute.equals(new Date().getTime(), 0);
    },
  );

  it.failing("should allow a fake on the global if a fake on a customer target is already defined", function () {
    const setTimeoutFake = sinon.fake();
    const context = {
      Date: Date,
      setTimeout: setTimeoutFake,
      clearTimeout: sinon.fake(),
    };
    const clock = FakeTimers.withGlobal(context).install({
      ignoreMissingTimers: true,
    });
    assert.equals(new context.Date().getTime(), 0);
    refute.equals(new Date().getTime(), 0);
    const globalClock = FakeTimers.install();
    assert.equals(new Date().getTime(), 0);

    globalClock.uninstall();
    refute.equals(new Date().getTime(), 0);
    assert.equals(new context.Date().getTime(), 0);
    clock.uninstall();
    refute.equals(new Date().getTime(), 0);
    refute.equals(new context.Date().getTime(), 0);
  });
});
