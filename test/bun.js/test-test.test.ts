import { expect, test } from "bun:test";

// test("");

test("toBe", () => {
  expect(1).toBe(0);
});

test("toContain", () => {
  expect("test").toContain("es");
  expect("test").toContain("est");
  expect("test").toContain("test");
  expect(["test", "es"]).toContain("es");
  expect("").toContain("");
  // expect(1).toContain(1);
  // expect([]).toContain([]);
  // expect("123").toContain(2);
});

test("toBeTruthy", () => {
  expect("test").toBeTruthy();
  expect(true).toBeTruthy();
  expect(1).toBeTruthy();
  expect({}).toBeTruthy();
  expect([]).toBeTruthy();
  expect(() => {}).toBeTruthy();

  // expect("").toBeTruthy();
  // expect(0).toBeTruthy();
  // expect(-0).toBeTruthy();
  // expect(NaN).toBeTruthy();
  // expect(0n).toBeTruthy();
  // expect(false).toBeTruthy();
  // expect(null).toBeTruthy();
  // expect(undefined).toBeTruthy();
});
