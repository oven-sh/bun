import { describe, expect, jest, mock, test } from "bun:test";

describe("mock functions match Jest", () => {
  test("mock methods and the mock getter work through a Proxy", () => {
    const fn = mock(() => 1);
    const proxied = new Proxy(fn, {});
    expect(proxied.mockReturnValue(2)).toBe(fn);
    expect(proxied()).toBe(2);
    expect(proxied.mock.calls).toHaveLength(1);
    expect(proxied.getMockName()).toBe(fn.getMockName());
    expect(proxied).toHaveBeenCalledTimes(1);
    expect(proxied).toHaveReturnedWith(2);
    proxied.mockClear();
    expect(fn.mock.calls).toHaveLength(0);
  });

  test("a mock has a prototype object like a plain function", () => {
    const fn = mock();
    expect(typeof fn.prototype).toBe("object");
    expect(fn.prototype.constructor).toBe(fn);
  });

  test("new mockFn() returns the constructed instance and records it", () => {
    const Klass = mock(function (this: any, a: number) {
      this.a = a;
    });
    const instance = new (Klass as any)(7);
    expect(instance).toBeInstanceOf(Klass);
    expect(instance.a).toBe(7);
    expect(Klass.mock.instances).toEqual([instance]);
    expect(Klass.mock.contexts).toEqual([instance]);
    expect(Klass).toHaveBeenCalledWith(7);
  });

  test("new mockFn() honours an object returned by the implementation", () => {
    const explicit = { built: true };
    const Klass = mock(() => explicit);
    expect(new (Klass as any)()).toBe(explicit);

    const primitive = mock(() => 42);
    const instance = new (primitive as any)();
    expect(instance).toBeInstanceOf(primitive);
    expect(primitive.mock.results[0]).toEqual({ type: "return", value: 42 });

    const byValue = mock().mockReturnValue("x");
    expect(new (byValue as any)()).toBeInstanceOf(byValue);
  });

  test("new mockFn() uses mockFn.prototype, so methods defined there are visible", () => {
    const Klass = mock(function () {});
    Klass.prototype.greet = () => "hi";
    expect(new (Klass as any)().greet()).toBe("hi");
  });

  test("mock.instances and mock.contexts record this for plain calls too", () => {
    const fn = mock(function () {});
    const receiver = { fn };
    receiver.fn();
    fn.call("str");
    expect(fn.mock.contexts).toEqual([receiver, "str"]);
    expect(fn.mock.instances).toEqual([receiver, "str"]);
    fn.mockClear();
    expect(fn.mock.instances).toEqual([]);
  });

  test("a detached mock method still reports a useful error", () => {
    const fn = mock();
    const { mockReturnValue } = fn;
    expect(() => (mockReturnValue as any).call({}, 1)).toThrow();
  });
});
