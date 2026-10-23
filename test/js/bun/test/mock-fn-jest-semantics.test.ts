import { describe, expect, jest, mock, test } from "bun:test";
import { runInNewContext } from "node:vm";

describe("mock functions match Jest", () => {
  test("mock methods and the mock getter work through a Proxy", () => {
    const fn = mock(() => 1);
    const proxied = new Proxy(fn, {});
    expect(proxied.mockReturnValue(2)).toBe(fn);
    expect(proxied()).toBe(2);
    expect(proxied.mock.calls).toHaveLength(1);
    expect(proxied.getMockName()).toBe(fn.getMockName());
    expect((proxied as any)._protoImpl).toBe((fn as any)._protoImpl);
    expect(proxied).toHaveBeenCalledTimes(1);
    expect(proxied).toHaveReturnedWith(2);
    proxied.mockClear();
    expect(fn.mock.calls).toHaveLength(0);
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

  test("new mockFn() falls back to Object.prototype of newTarget's realm", () => {
    const fn = mock();
    const { NewTarget, otherObjectPrototype } = runInNewContext(
      "({ NewTarget: function NewTarget() {}, otherObjectPrototype: Object.prototype })",
    );
    expect(otherObjectPrototype).not.toBe(Object.prototype);
    NewTarget.prototype = null;
    const instance = Reflect.construct(fn, [], NewTarget);
    expect(Object.getPrototypeOf(instance)).toBe(otherObjectPrototype);
    expect(fn.mock.instances).toEqual([instance]);
  });

  test("a detached mock method still reports a useful error", () => {
    const fn = mock();
    const { mockReturnValue } = fn;
    expect(() => (mockReturnValue as any).call({}, 1)).toThrow();
  });
});
