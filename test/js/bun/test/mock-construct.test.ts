import { describe, expect, mock, test } from "bun:test";

describe("mock() used as a constructor", () => {
  test("Reflect.construct with no implementation returns an object", () => {
    const m = mock();
    const r = Reflect.construct(m, []);
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });

  test("Reflect.construct with a different newTarget returns an object", () => {
    const m = mock();
    const r = Reflect.construct(m, [], function () {});
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });

  test("Reflect.construct with implementation returning a primitive returns an object", () => {
    const m = mock(() => 42);
    const r = Reflect.construct(m, []);
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });

  test("Reflect.construct with mockReturnValue(primitive) returns an object", () => {
    const m = mock().mockReturnValue(7);
    const r = Reflect.construct(m, []);
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });

  test("Reflect.construct preserves object return values", () => {
    const obj = { hello: "world" };
    const m = mock(() => obj);
    const r = Reflect.construct(m, []);
    expect(r).toBe(obj);
  });

  test("Reflect.construct with a custom newTarget honors its prototype", () => {
    class Foo {}
    const m = mock();
    const r = Reflect.construct(m, [], Foo);
    expect(r).toBeInstanceOf(Foo);
  });

  test("calling without new still returns the implementation's value", () => {
    const m1 = mock();
    expect(m1()).toBeUndefined();
    const m2 = mock(() => 42);
    expect(m2()).toBe(42);
    const m3 = mock().mockReturnValue("x");
    expect(m3()).toBe("x");
  });
});
