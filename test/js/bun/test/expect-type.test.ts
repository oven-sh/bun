import { expectTypeOf, test } from "bun:test";

test("types", () => {
  expectTypeOf({ a: 1 }).toMatchObjectType<{ a: number }>();
  // @ts-expect-error
  expectTypeOf({ a: 1 }).toMatchObjectType<{ a: 1 }>();
  expectTypeOf({ a: 1 as const }).toMatchObjectType<{ a: 1 }>();
});
