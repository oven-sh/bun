import { expect, test } from "bun:test";

test("expect().toBe() supports custom error messages", () => {
  expect(() => expect(1).toBe(2, "my custom error message")).toThrow("my custom error message");
});

test("expect().toBe() supports lazy custom error messages", () => {
  let called = false;
  expect(() =>
    expect(1).toBe(2, {
      toString() {
        called = true;
        return "my lazy custom error message";
      },
    }),
  ).toThrow("my lazy custom error message");
  expect(called).toBe(true);
});

test("expect().toBe() errors in toString matcher bubble up", () => {
  let called = false;
  try {
    expect(1).toBe(2, {
      toString() {
        called = true;
        throw new Error("Success");
      },
    });
    expect.unreachable();
  } catch (e) {
    expect(e.message).toBe("Success");
  }

  expect(called).toBe(true);
});
