import { expect, jest, test } from "bun:test";

// Each test asserts that a matcher throwing an *argument-validation* error
// (wrong arity or wrong argument type) does not increment the assertion
// counter, matching Jest and the original implementation.

test("toBe argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toBe();
  } catch {}
});

test("toBeOneOf argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toBeOneOf();
  } catch {}
});

test("toBeTypeOf argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toBeTypeOf();
  } catch {}
});

test("toBeTypeOf type", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toBeTypeOf(123);
  } catch {}
});

test("toBeWithin argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(5).toBeWithin();
  } catch {}
});

test("toBeWithin type start", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(5).toBeWithin("a", 10);
  } catch {}
});

test("toBeWithin type end", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(5).toBeWithin(0, "z");
  } catch {}
});

test("toContain argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect([1]).toContain();
  } catch {}
});

test("toContainEqual argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect([1]).toContainEqual();
  } catch {}
});

test("toEqual argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toEqual();
  } catch {}
});

test("toEqualIgnoringWhitespace argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect("x").toEqualIgnoringWhitespace();
  } catch {}
});

test("toHaveLength argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect([1]).toHaveLength();
  } catch {}
});

test("toMatch argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect("x").toMatch();
  } catch {}
});

test("toStrictEqual argcount", () => {
  expect.assertions(0);
  try {
    // @ts-expect-error
    expect(1).toStrictEqual();
  } catch {}
});

test("toHaveBeenCalled argcount", () => {
  expect.assertions(0);
  const fn = jest.fn();
  try {
    // @ts-expect-error
    expect(fn).toHaveBeenCalled(1);
  } catch {}
});

test("toHaveNthReturnedWith type", () => {
  expect.assertions(0);
  const fn = jest.fn(() => 1);
  fn();
  try {
    // @ts-expect-error
    expect(fn).toHaveNthReturnedWith("x", 1);
  } catch {}
});

test("toHaveNthReturnedWith n<=0", () => {
  expect.assertions(0);
  const fn = jest.fn(() => 1);
  fn();
  try {
    expect(fn).toHaveNthReturnedWith(0, 1);
  } catch {}
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
