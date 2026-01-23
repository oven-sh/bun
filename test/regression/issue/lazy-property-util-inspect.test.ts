import { expect, test } from "bun:test";

// Regression test for LazyProperty assertion failure when Buffer's custom inspect
// is called during util.inspect initialization
//
// The issue occurred when:
// 1. console.log(buffer) triggers util.inspect LazyProperty initialization
// 2. During node:util module loading, Buffer's custom inspect is invoked
// 3. Buffer's custom inspect needs util.inspect to format properties
// 4. LazyProperty assertion: ASSERTION FAILED: !(initializer.property.m_pointer & lazyTag)
//
// Fix: JSC__JSValue__callCustomInspectFunction checks if util.inspect is initialized
// before calling it, returns the original value if not ready (fallback to default formatting)

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
    // The fix ensures custom inspect doesn't cause circular LazyProperty access
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
