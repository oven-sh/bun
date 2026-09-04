import { describe, expect, jest, mock, spyOn, test } from "bun:test";

describe("spyOn on accessor properties", () => {
  test('spyOn(obj, prop, "get") wraps the getter and calls through by default', () => {
    let reads = 0;
    const obj = {
      get value() {
        reads++;
        return 41 + 1;
      },
    };
    const originalGet = Object.getOwnPropertyDescriptor(obj, "value")!.get;

    const spy = spyOn(obj, "value", "get");
    expect(obj.value).toBe(42);
    expect(reads).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockReturnValue(7);
    expect(obj.value).toBe(7);
    expect(reads).toBe(1);

    // spying again hands back the same mock, as Jest does
    expect(spyOn(obj, "value", "get")).toBe(spy);

    spy.mockRestore();
    expect(Object.getOwnPropertyDescriptor(obj, "value")!.get).toBe(originalGet);
    expect(obj.value).toBe(42);
    expect(reads).toBe(2);
  });

  test('spyOn(obj, prop, "set") wraps the setter and keeps the getter', () => {
    const stored: unknown[] = [];
    const obj = {
      get value() {
        return stored.at(-1);
      },
      set value(v: unknown) {
        stored.push(v);
      },
    };
    const spy = spyOn(obj, "value", "set");
    obj.value = 1;
    expect(spy).toHaveBeenCalledWith(1);
    expect(obj.value).toBe(1);
    spy.mockImplementation(() => {});
    obj.value = 2;
    expect(stored).toEqual([1]);
    spy.mockRestore();
    obj.value = 3;
    expect(stored).toEqual([1, 3]);
  });

  test("a prototype accessor spied through an instance is restored by removing the own copy", () => {
    class Box {
      get size() {
        return 10;
      }
    }
    const box = new Box();
    const spy = spyOn(box, "size", "get").mockReturnValue(99);
    expect(box.size).toBe(99);
    expect(Object.hasOwn(box, "size")).toBe(true);
    expect(new Box().size).toBe(10);
    spy.mockRestore();
    expect(Object.hasOwn(box, "size")).toBe(false);
    expect(box.size).toBe(10);
  });

  test("spyOn(obj, method) accepts a getter that returns a function", () => {
    // jsdom-style: the method lives behind a getter on the prototype
    const calls: unknown[] = [];
    function focus(this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
      return "focused";
    }
    const proto = {};
    Object.defineProperty(proto, "focus", { get: () => focus, configurable: true, enumerable: false });
    const el = Object.create(proto);

    const spy = spyOn(el, "focus");
    expect(el.focus).toBe(spy);
    expect(el.focus("a")).toBe("focused");
    expect(calls).toEqual([[el, "a"]]);
    expect(spy).toHaveBeenCalledWith("a");

    spy.mockReturnValue("mocked");
    expect(el.focus()).toBe("mocked");

    spy.mockRestore();
    expect(Object.hasOwn(el, "focus")).toBe(false);
    expect(el.focus).toBe(focus);
    expect(Object.getOwnPropertyDescriptor(proto, "focus")!.get).toBeDefined();
  });

  test("an own getter-backed method gets its accessor back on restore", () => {
    const original = () => "real";
    const obj = {};
    Object.defineProperty(obj, "run", { get: () => original, configurable: true });
    const spy = spyOn(obj, "run").mockReturnValue("fake");
    expect((obj as any).run()).toBe("fake");
    expect(Object.getOwnPropertyDescriptor(obj, "run")!.value).toBe(spy);
    spy.mockRestore();
    const descriptor = Object.getOwnPropertyDescriptor(obj, "run")!;
    expect(typeof descriptor.get).toBe("function");
    expect((obj as any).run).toBe(original);
  });

  test("jest.restoreAllMocks restores accessor spies", () => {
    const obj = {
      get value() {
        return 1;
      },
    };
    jest.spyOn(obj, "value", "get").mockReturnValue(2);
    expect(obj.value).toBe(2);
    jest.restoreAllMocks();
    expect(obj.value).toBe(1);
  });

  test("errors match Jest", () => {
    const data = { value: 1 };
    expect(() => spyOn(data, "value", "get")).toThrow("does not have access type get");
    expect(() => spyOn(data, "missing" as any, "get")).toThrow("property does not exist");
    const getterOnly = {
      get value() {
        return 1;
      },
    };
    expect(() => spyOn(getterOnly, "value", "set")).toThrow("does not have access type set");
    expect(() => spyOn(getterOnly, "value", "peek" as any)).toThrow('"get" or "set"');
    const notAFunction = {
      get value() {
        return 1;
      },
    };
    expect(() => spyOn(notAFunction, "value")).toThrow(
      "Cannot spy on the `value` property because it is not a function; number given instead",
    );
  });
});
