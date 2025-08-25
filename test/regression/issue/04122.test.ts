// Test for ECMAScript decorators support (issue 4122)
// https://github.com/oven-sh/bun/issues/4122

import { expect, test } from "bun:test";

// This test should pass with ECMAScript decorators implementation
// Note: Currently skipped until a full build is completed
test.skip("ECMAScript decorator with ClassFieldDecoratorContext", () => {
  function wrap<This, T>(value: T, ctx: ClassFieldDecoratorContext<This, T>) {
    console.log("Wrapping", value, ctx);
    ctx.addInitializer(function W() {
      console.log("Initialized", this, value);
    });
  }

  class A {
    @wrap
    public a: number = 1;
  }

  const a = new A();
  expect(a.a).toBe(1);
});

// This test verifies current TypeScript experimental decorators behavior
test("TypeScript experimental decorator (current implementation)", () => {
  let decoratorCalled = false;

  function wrap(target: any, propertyKey: string) {
    decoratorCalled = true;
    expect(target).toBeDefined();
    expect(propertyKey).toBe("a");
  }

  class A {
    @wrap
    public a: number = 1;
  }

  const a = new A();
  expect(a.a).toBe(1);
  expect(decoratorCalled).toBe(true);
});
