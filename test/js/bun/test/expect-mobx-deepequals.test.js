import { expect, test } from "bun:test";

// Mock of MobX-like reactive object that could trigger the segfault
// The issue was that MobX reactive objects can return non-cell values
// when asymmetric matchers try to access properties
class ReactiveProxy {
  constructor(target) {
    return new Proxy(target, {
      get(target, prop) {
        // Simulate MobX behavior that could return non-cell values
        // This mimics what happens when asymmetric matchers check properties
        if (prop === Symbol.for("jest.asymmetricMatcher")) {
          // Return a non-cell value (primitive) instead of undefined
          // This would cause asCell() to crash without the fix
          return null;
        }
        if (prop === "$$typeof") {
          return null;
        }
        if (prop === "asymmetricMatch") {
          return false;
        }
        // For arrays, we need to properly handle length and numeric indices
        if (Array.isArray(target)) {
          if (prop === "length" || !isNaN(Number(prop))) {
            return target[prop];
          }
        }
        return target[prop];
      },
      has(target, prop) {
        return prop in target;
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        return Object.getOwnPropertyDescriptor(target, prop);
      },
    });
  }
}

test("deepEquals with MobX-like reactive objects should not segfault", () => {
  const store = new ReactiveProxy({
    value: 42,
    nested: {
      prop: "test",
    },
  });

  const expected = {
    value: 42,
    nested: {
      prop: "test",
    },
  };

  // This would cause a segfault before the fix
  expect(store).toEqual(expected);
  expect(expected).toEqual(store);
});

test("deepEquals with reactive objects returning non-cell values for matcher symbols", () => {
  const reactiveObj = new ReactiveProxy({
    a: 1,
    b: 2,
  });

  // Test various asymmetric matcher checks
  expect(reactiveObj).toEqual({ a: 1, b: 2 });
  expect({ a: 1, b: 2 }).toEqual(reactiveObj);

  // Test with nested reactive objects
  const nestedReactive = new ReactiveProxy({
    outer: new ReactiveProxy({
      inner: "value",
    }),
  });

  expect(nestedReactive).toEqual({ outer: { inner: "value" } });
});

test("deepEquals with reactive arrays should not segfault", () => {
  const reactiveArray = new ReactiveProxy([1, 2, 3]);

  // The main point is that it shouldn't segfault
  // The reactive proxy might not perfectly emulate an array for deepEquals
  expect(reactiveArray[0]).toBe(1);
  expect(reactiveArray[1]).toBe(2);
  expect(reactiveArray[2]).toBe(3);
  expect(reactiveArray.length).toBe(3);

  // Test that it doesn't crash when checking for asymmetric matchers
  const compareResult = (() => {
    try {
      // This is the code path that would trigger the segfault
      return Bun.deepEquals(reactiveArray, [1, 2, 3]);
    } catch {
      // If it throws, that's fine - we just don't want a segfault
      return false;
    }
  })();

  // We don't care about the result, just that it didn't crash
  expect(typeof compareResult).toBe("boolean");
});

test("deepEquals with reactive objects and asymmetric matchers", () => {
  const reactiveObj = new ReactiveProxy({
    str: "hello",
    num: 42,
    arr: [1, 2, 3],
  });

  // These would trigger the asymmetric matcher code path
  expect(reactiveObj).toEqual({
    str: expect.any(String),
    num: expect.any(Number),
    arr: expect.arrayContaining([1, 2]),
  });
});

test("deepEquals handles primitive returns from reactive getters", () => {
  const weirdProxy = new Proxy(
    {},
    {
      get(target, prop) {
        // Return primitives for internal checks
        if (typeof prop === "symbol") {
          return 0; // primitive number
        }
        if (prop === "constructor") {
          return null;
        }
        if (prop === "valueOf") {
          return 42;
        }
        return undefined;
      },
      ownKeys() {
        return [];
      },
      has() {
        return false;
      },
    },
  );

  // Should not crash when deepEquals tries to check for asymmetric matchers
  // The main test is that this doesn't segfault
  const result = (() => {
    try {
      return Bun.deepEquals(weirdProxy, {});
    } catch {
      return "error";
    }
  })();

  // We just care that it didn't segfault, not the specific result
  expect(result !== undefined).toBe(true);
});
