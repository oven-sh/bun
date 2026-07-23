import { expect, jest, test } from "bun:test";

// Each test asserts that a matcher throwing an *argument-validation* error
// (wrong arity or wrong argument type) does not increment the assertion
// counter, matching Jest and the original implementation.
//
// The `threw` check uses a plain `throw` (not `expect`) so the counter stays
// at 0 while still failing the test if the matcher stops rejecting bad args.

function mustThrow(name: string, fn: () => void) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${name} with invalid args must throw`);
}

test("toBe argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBe()", () => expect(1).toBe());
});

test("toBeOneOf argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeOneOf()", () => expect(1).toBeOneOf());
});

test("toBeTypeOf argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeTypeOf()", () => expect(1).toBeTypeOf());
});

test("toBeTypeOf type", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeTypeOf(number)", () => expect(1).toBeTypeOf(123));
});

test("toBeWithin argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeWithin()", () => expect(5).toBeWithin());
});

test("toBeWithin type start", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeWithin(str, num)", () => expect(5).toBeWithin("a", 10));
});

test("toBeWithin type end", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toBeWithin(num, str)", () => expect(5).toBeWithin(0, "z"));
});

test("toContain argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toContain()", () => expect([1]).toContain());
});

test("toContainEqual argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toContainEqual()", () => expect([1]).toContainEqual());
});

test("toEqual argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toEqual()", () => expect(1).toEqual());
});

test("toEqualIgnoringWhitespace argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toEqualIgnoringWhitespace()", () => expect("x").toEqualIgnoringWhitespace());
});

test("toHaveLength argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toHaveLength()", () => expect([1]).toHaveLength());
});

test("toMatch argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toMatch()", () => expect("x").toMatch());
});

test("toStrictEqual argcount", () => {
  expect.assertions(0);
  // @ts-expect-error
  mustThrow("toStrictEqual()", () => expect(1).toStrictEqual());
});

test("toHaveBeenCalled argcount", () => {
  expect.assertions(0);
  const fn = jest.fn();
  // @ts-expect-error
  mustThrow("toHaveBeenCalled(arg)", () => expect(fn).toHaveBeenCalled(1));
});

test("toHaveNthReturnedWith type", () => {
  expect.assertions(0);
  const fn = jest.fn(() => 1);
  fn();
  // @ts-expect-error
  mustThrow("toHaveNthReturnedWith(str, ...)", () => expect(fn).toHaveNthReturnedWith("x", 1));
});

test("toHaveNthReturnedWith n<=0", () => {
  expect.assertions(0);
  const fn = jest.fn(() => 1);
  fn();
  mustThrow("toHaveNthReturnedWith(0, ...)", () => expect(fn).toHaveNthReturnedWith(0, 1));
});

// Valid calls must still count: one assertion each.

test("toBe valid counts", () => {
  expect.assertions(1);
  expect(1).toBe(1);
});

test("toBeWithin valid counts", () => {
  expect.assertions(1);
  expect(5).toBeWithin(0, 10);
});

test("toBeTypeOf valid counts", () => {
  expect.assertions(1);
  expect(5).toBeTypeOf("number");
});

test("toEqual valid counts", () => {
  expect.assertions(1);
  expect(1).toEqual(1);
});

test("toStrictEqual valid counts", () => {
  expect.assertions(1);
  expect(1).toStrictEqual(1);
});

test("toContain valid counts", () => {
  expect.assertions(1);
  expect([1]).toContain(1);
});

test("toContainEqual valid counts", () => {
  expect.assertions(1);
  expect([{ a: 1 }]).toContainEqual({ a: 1 });
});

test("toEqualIgnoringWhitespace valid counts", () => {
  expect.assertions(1);
  expect("a b").toEqualIgnoringWhitespace("a  b");
});

test("toHaveLength valid counts", () => {
  expect.assertions(1);
  expect([1, 2]).toHaveLength(2);
});

test("toMatch valid counts", () => {
  expect.assertions(1);
  expect("abc").toMatch("b");
});

test("toBeOneOf valid counts", () => {
  expect.assertions(1);
  expect(1).toBeOneOf([1, 2, 3]);
});

test("toMatchObject valid counts", () => {
  expect.assertions(1);
  expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
});

test("toHaveBeenCalled valid counts", () => {
  expect.assertions(1);
  const fn = jest.fn();
  fn();
  expect(fn).toHaveBeenCalled();
});

test("toHaveNthReturnedWith valid counts", () => {
  expect.assertions(1);
  const fn = jest.fn(() => 7);
  fn();
  expect(fn).toHaveNthReturnedWith(1, 7);
});
