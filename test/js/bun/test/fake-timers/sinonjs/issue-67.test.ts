"use strict";

import { FakeTimers, assert, sinon } from "./helpers/setup-tests";

describe("issue #67", function () {
  // see https://nodejs.org/api/timers.html
  it.failing("should overflow to 1 on very big timeouts", function () {
    const clock = FakeTimers.install();
    const stub1 = sinon.stub();
    const stub2 = sinon.stub();

    clock.setTimeout(stub1, 100);
    clock.setTimeout(stub2, 214748334700); //should be called after 1 tick

    clock.tick(1);
    assert(stub2.called);
    assert.isFalse(stub1.called);

    clock.tick(99);
    assert(stub1.called);
    assert(stub2.called);

    clock.uninstall();
  });

  it.failing("should overflow to interval 1 on very big timeouts", function () {
    const clock = FakeTimers.install();
    const stub = sinon.stub();

    clock.setInterval(stub, 214748334700);
    clock.tick(3);
    assert(stub.calledThrice);

    clock.uninstall();
  });

  it("should execute setTimeout smaller than 1", function () {
    const clock = FakeTimers.install();
    const stub1 = sinon.stub();

    clock.setTimeout(stub1, 0.5);
    clock.tick(1);
    assert(stub1.calledOnce);

    clock.uninstall();
  });

  it("executes setTimeout with negative duration as if it has zero delay", function () {
    const clock = FakeTimers.install();
    const stub1 = sinon.stub();

    clock.setTimeout(stub1, -10);
    clock.tick(1);
    assert(stub1.calledOnce);

    clock.uninstall();
  });
});
