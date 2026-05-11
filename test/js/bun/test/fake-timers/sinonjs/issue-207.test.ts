"use strict";

import { FakeTimers, assert, hrtimePresent } from "./helpers/setup-tests";

describe("issue #207 - nanosecond round-off errors on high-res timer", function () {
  let clock;

  afterEach(function () {
    clock.uninstall();
  });

  if (hrtimePresent) {
    it("should not round off nanosecond arithmetic on hrtime - case 1", function () {
      clock = FakeTimers.install();

      clock.tick(1022.7791);

      const nanos = clock.hrtime([0, 2 * 1e7])[1];
      assert.equals(nanos, 2779100);
    });

    it("should not round off nanosecond arithmetic on hrtime - case 2", function () {
      clock = FakeTimers.install({
        now: new Date("2018-09-12T08:58:33.742000000Z").getTime(),
        toFake: ["hrtime"],
      });
      const start = clock.hrtime();
      clock.tick(123.493);

      const nanos = clock.hrtime(start)[1];
      assert.equals(nanos, 123493000);
    });

    it("should truncate sub-nanosecond ticks", function () {
      clock = FakeTimers.install();
      clock.tick(0.123456789);

      const nanos = clock.hrtime()[1];
      assert.equals(nanos, 123456);
    });
  }

  it("should always set 'now' to an integer value when ticking with sub-millisecond precision", function () {
    clock = FakeTimers.install();
    clock.tick(2.993);

    assert.equals(clock.now, 2);
  });

  it("should adjust adjust the 'now' value when the nano-remainder overflows", function () {
    clock = FakeTimers.install();
    clock.tick(0.993);
    clock.tick(0.5);

    assert.equals(clock.now, 1);
  });

  it.failing("should floor negative now values", function () {
    clock = FakeTimers.install({ now: -1.2 });

    assert.equals(clock.now, -2);
  });

  it("should floor start times", function () {
    clock = FakeTimers.install({ now: 1.2 });
    assert.equals(clock.now, 1);
  });

  it.failing("should floor negative start times", function () {
    clock = FakeTimers.install({ now: -1.2 });
    assert.equals(clock.now, -2);
  });

  it.failing("should handle ticks on the negative side of the Epoch", function () {
    clock = FakeTimers.install({ now: -2 });
    clock.tick(0.8); // -1.2
    clock.tick(0.5); // -0.7

    assert.equals(clock.now, -1);
  });

  it("should handle multiple non-integer ticks", function () {
    clock = FakeTimers.install({ now: -2 });
    clock.tick(1.1); // -0.9
    clock.tick(0.5);
    clock.tick(0.5); // 0.1

    assert.equals(clock.now, 0);
  });
});
