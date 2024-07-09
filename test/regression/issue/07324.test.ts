import { test, expect } from "bun:test";

test("override is an accessibility modifier", () => {
  class FooParent {}

  class FooChild extends FooParent {}

  class BarParent {
    constructor(readonly foo: FooParent) {}
  }

  class BarChild extends BarParent {
    constructor(override foo: FooChild) {
      super(foo);
    }
  }

  new BarChild(new FooChild());

  expect().pass();
});
