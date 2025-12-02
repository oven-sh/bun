"use strict";

import { FakeTimers, assert, sinon } from "./helpers/setup-tests";

describe("issue #315 - praseInt if delay is not a number", function () {
  it("should successfully execute the timer", function () {
    const clock = FakeTimers.install();
    const stub1 = sinon.stub();

    clock.setTimeout(stub1, "1");
    clock.tick(1);
    assert(stub1.calledOnce);

    clock.uninstall();
  });
});
