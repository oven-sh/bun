"use strict";

import { FakeTimers, assert, sinon } from "./helpers/setup-tests";

describe("#368 - timeout.refresh setTimeout arguments", function () {
  it("should forward arguments passed to setTimeout", function () {
    const clock = FakeTimers.install();
    const stub = sinon.stub();

    const t = setTimeout(stub, 1000, "test");
    clock.tick(1000);
    t.refresh();
    clock.tick(1000);
    assert.calledTwice(stub);
    assert.alwaysCalledWith(stub, "test");
    clock.uninstall();
  });
});
