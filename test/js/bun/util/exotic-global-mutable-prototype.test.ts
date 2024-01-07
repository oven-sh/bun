import { test, expect } from "bun:test";

// StructureFlag: ~IsImmutablePrototypeExoticObject
//
// Some libraries like `web-worker` override the prototype on `globalThis` to add extra properties.
test("Object.setPrototypeOf works on globalThis", () => {
  const orig = Object.getPrototypeOf(globalThis);
  Object.setPrototypeOf(
    globalThis,
    Object.create(null, {
      a: {
        value: 1,
      },
    }),
  );
  expect(
    // @ts-expect-error
    a,
  ).toBe(1);

  Object.setPrototypeOf(globalThis, orig);

  expect(
    // @ts-expect-error
    globalThis.a,
  ).toBeUndefined();
});
