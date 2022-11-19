import { expect, test } from "bun:test";

test("toBe()", () => {
  const a = 1;
  const b = 1;
  expect(a).toBe(a);
  expect(a).toBe(b);
  expect(a).toBe(1);
  expect(1).toBe(a);
  expect(b).toBe(a);

  const c = { a: 1 };
  const d = { a: 1 };
  expect(c).toBe(c);
  expect(c).not.toBe(d);
  expect(c).not.toBe({ a: 1 });
  expect({ a: 1 }).not.toBe(c);
  expect(d).not.toBe(c);

  expect(1).toBe(1);
  // expect(1).not.toBe(1);

  expect(1).not.toBe(2);
  expect(1).not.toBe("1");
  expect("hello test").toBe("hello test");
  expect("hello test").not.toBe("hello test2");
});

test("toHaveLength()", () => {
  expect("123").toHaveLength(3);
  expect([1, 2, 3]).toHaveLength(3);
  expect([1, 2, 3]).not.toHaveLength(2);
  expect("123").not.toHaveLength(2);
  expect({ length: 3 }).toHaveLength(3);
  expect({ length: 3 }).not.toHaveLength(2);
});

test("toContain()", () => {
  const s1 = new String("123");
  expect(s1).not.toContain("12");
  const s2 = "123";
  expect(s2).toContain("12");

  expect("test").toContain("es");
  expect("test").toContain("est");
  expect("test").toContain("test");
  expect(["test", "es"]).toContain("es");
  expect("").toContain("");
  expect([""]).toContain("");

  expect(["lemon", "lime"]).not.toContain("orange");
  expect("citrus fruits").toContain("fruit");

  const a = new Uint16Array([1, 2, 3]);
  expect(a).toContain(2);
  expect(a).not.toContain(4);
  // expect([4, 5, 6]).not.toContain(5);

  expect([]).not.toContain([]);
});

test("toBeTruthy()", () => {
  expect("test").toBeTruthy();
  expect(true).toBeTruthy();
  expect(1).toBeTruthy();
  expect({}).toBeTruthy();
  expect([]).toBeTruthy();
  expect(() => {}).toBeTruthy();
  // expect(() => {}).not.toBeTruthy();

  expect("").not.toBeTruthy();
  expect(0).not.toBeTruthy();
  expect(-0).not.toBeTruthy();
  expect(NaN).not.toBeTruthy();
  expect(0n).not.toBeTruthy();
  expect(false).not.toBeTruthy();
  expect(null).not.toBeTruthy();
  expect(undefined).not.toBeTruthy();
});

test("toBeUndefined()", () => {
  expect(undefined).toBeUndefined();
  // expect(undefined).not.toBeUndefined();

  expect(null).not.toBeUndefined();
  expect(null).not.not.not.toBeUndefined();
  expect(0).not.toBeUndefined();
  expect("hello defined").not.toBeUndefined();
});

test("toBeNaN()", () => {
  expect(NaN).toBeNaN();
  // expect(NaN).not.toBeNaN();

  expect(0).not.toBeNaN();
  expect("hello not NaN").not.toBeNaN();
});

test("toBeNull()", () => {
  expect(null).toBeNull();
  // expect(null).not.toBeNull();

  expect(undefined).not.toBeNull();
  expect(0).not.toBeNull();
  expect("hello not null").not.toBeNull();
});

test("toBeDefined()", () => {
  expect(0).toBeDefined();
  expect("hello defined").toBeDefined();
  expect(null).toBeDefined();
  // expect(null).not.toBeDefined();

  expect(undefined).not.toBeDefined();
});

test("toBeFalsy()", () => {
  expect("").toBeFalsy();
  expect(0).toBeFalsy();
  expect(-0).toBeFalsy();
  expect(NaN).toBeFalsy();
  expect(0n).toBeFalsy();
  expect(false).toBeFalsy();
  expect(null).toBeFalsy();
  expect(undefined).toBeFalsy();
  // expect(undefined).not.toBeFalsy();

  expect("hello not falsy").not.toBeFalsy();
  expect("hello not falsy").not.not.not.toBeFalsy();
  expect(1).not.toBeFalsy();
  expect(true).not.toBeFalsy();
  expect({}).not.toBeFalsy();
  expect([]).not.toBeFalsy();
  expect(() => {}).not.toBeFalsy();
});
