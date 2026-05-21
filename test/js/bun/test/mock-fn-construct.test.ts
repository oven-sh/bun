import { describe, expect, jest, spyOn, test } from "bun:test";

describe("Reflect.construct on mock functions", () => {
  test("jest.fn() with no implementation", () => {
    const fn = jest.fn();
    const result = Reflect.construct(fn, []);
    expect(typeof result).toBe("object");
    expect(result).not.toBe(fn);
  });

  test("jest.fn() with implementation returning a primitive", () => {
    const fn = jest.fn(() => 42);
    const result = Reflect.construct(fn, []);
    expect(typeof result).toBe("object");
  });

  test("jest.fn() with implementation returning an object", () => {
    const obj = { a: 1 };
    const fn = jest.fn(() => obj);
    const result = Reflect.construct(fn, []);
    expect(result).toBe(obj);
  });

  test("jest.fn().mockReturnValue(primitive)", () => {
    const fn = jest.fn().mockReturnValue(42);
    const result = Reflect.construct(fn, []);
    expect(typeof result).toBe("object");
  });

  test("jest.fn().mockReturnThis()", () => {
    const fn = jest.fn().mockReturnThis();
    const result = Reflect.construct(fn, []);
    expect(typeof result).toBe("object");
  });

  test("spyOn an undefined property", () => {
    const obj: Record<string, unknown> = {};
    const spy = spyOn(obj, "x" as never);
    const result = Reflect.construct(spy, []);
    expect(typeof result).toBe("object");
  });

  test("with explicit newTarget", () => {
    const fn = jest.fn();
    const result = Reflect.construct(fn, [], function () {});
    expect(typeof result).toBe("object");
  });

  test("implementation receives constructed this", () => {
    const fn = jest.fn(function (this: { x: number }) {
      this.x = 1;
    });
    const result = Reflect.construct(fn, []);
    expect(result).toEqual({ x: 1 });
  });

  test("new on jest.fn() returns an object", () => {
    const fn = jest.fn();
    const result = new (fn as any)();
    expect(typeof result).toBe("object");
    expect(result).not.toBe(fn);
  });

  test("regular call preserves this", () => {
    const fn = jest.fn(function (this: unknown) {
      return this;
    });
    const obj = { fn };
    expect(obj.fn()).toBe(obj);
    expect(fn.call(123 as any)).toBe(123);
  });
});
