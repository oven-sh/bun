import { expectTypeOf, test } from "bun:test";

test("types", () => {
  expectTypeOf({ a: 1 }).toMatchObjectType<{ a: number }>();
  // @ts-expect-error
  expectTypeOf({ a: 1 }).toMatchObjectType<{ a: 1 }>();
  expectTypeOf({ a: 1 as const }).toMatchObjectType<{ a: 1 }>();
});

test("a matcher can follow every method that returns another type", () => {
  const join = (a: number, b: string) => a + b;
  expectTypeOf(join).parameter(0).toEqualTypeOf<number>();
  expectTypeOf(join).parameter(1).toBeString();
  expectTypeOf(join).toBeCallableWith(1, "a").returns.toBeString();
  expectTypeOf({ a: 1, b: "" }).toHaveProperty("a").toBeNumber();
  expectTypeOf({ a: 1, b: "" }).pick<"a">().toEqualTypeOf<{ a: number }>();
  expectTypeOf({ a: 1, b: "" }).omit<"a">().toEqualTypeOf<{ b: string }>();
  expectTypeOf<string | number>().exclude<string>().toBeNumber();
  expectTypeOf<string | number>().extract<string>().toBeString();
  expectTypeOf<number>()
    .map(n => String(n))
    .toBeString();
});

test("toBeNullable()", () => {
  expectTypeOf<string | null>().toBeNullable();
  expectTypeOf<string>().not.toBeNullable();
});
