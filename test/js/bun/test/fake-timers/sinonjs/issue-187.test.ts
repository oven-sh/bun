"use strict";

import { assert, FakeTimers, sinon } from "./helpers/setup-tests";

describe("#187 - Support timeout.refresh in node environments", function () {
  it("calls the stub again after refreshing the timeout", function () {
    const clock = FakeTimers.install();
    const stub = sinon.stub();

    const t = setTimeout(stub, 1000);
    clock.tick(1000);
    t.refresh();
    clock.tick(1000);
    assert(stub.calledTwice);
    clock.uninstall();
  });

  it("only calls stub once if not fired at time of refresh", function () {
    const clock = FakeTimers.install();
    const stub = sinon.stub();

    const t = setTimeout(stub, 1000);
    clock.tick(999);
    assert(stub.notCalled);
    t.refresh();
    clock.tick(999);
    assert(stub.notCalled);
    clock.tick(1);
    assert(stub.calledOnce);
    clock.uninstall();
  });
});
