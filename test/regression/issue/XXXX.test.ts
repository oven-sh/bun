import { expect, test } from "bun:test";

// Regression test for LazyProperty assertion failure when Buffer() is called
// as a function (not constructor) in a recursive context with console.log
test("Buffer as function in recursive context with console.log should not crash", () => {
  const cent = Buffer.from([194]);
  let callCount = 0;
  const maxCalls = 5; // Limit recursion to avoid infinite loop

  function f6() {
    const v8 = Buffer("/posts/:slug([a-z]+)");

    if (callCount < maxCalls) {
      callCount++;
      try {
        cent.forEach(f6);
      } catch (e) {}
    }

    // This console.log would trigger util.inspect lazy initialization
    // If util.inspect isn't pre-initialized, this could cause re-entrant
    // initialization and trigger the LazyProperty assertion
    console.log(v8);
  }

  f6();

  // If we got here without crashing, the test passes
  expect(callCount).toBe(maxCalls);
});

test("Buffer as function should work like Buffer.from for strings", () => {
  const b1 = Buffer("hello");
  const b2 = Buffer.from("hello");

  expect(b1.toString()).toBe("hello");
  expect(b2.toString()).toBe("hello");
  expect(b1.equals(b2)).toBe(true);
});
