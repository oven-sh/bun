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

  describe("restoring both sides of one accessor", () => {
    function makeObject() {
      const stored: unknown[] = [];
      const obj = {
        get value() {
          return stored.at(-1);
        },
        set value(v: unknown) {
          stored.push(v);
        },
      };
      const { get, set } = Object.getOwnPropertyDescriptor(obj, "value")!;
      return { obj, stored, get, set };
    }

    function expectRestored(obj: object, get: unknown, set: unknown) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, "value")!;
      expect(descriptor.get).toBe(get);
      expect(descriptor.set).toBe(set);
    }

    test("getter spy restored first, then setter spy", () => {
      const { obj, stored, get, set } = makeObject();
      const getSpy = spyOn(obj, "value", "get").mockReturnValue("mocked");
      const setSpy = spyOn(obj, "value", "set").mockImplementation(() => {});
      getSpy.mockRestore();
      obj.value = 1;
      expect(stored).toEqual([]); // the setter spy still swallows writes
      expect(setSpy).toHaveBeenCalledWith(1);
      setSpy.mockRestore();
      expectRestored(obj, get, set);
      obj.value = 2;
      expect(obj.value).toBe(2);
    });

    test("setter spy restored first, then getter spy", () => {
      const { obj, stored, get, set } = makeObject();
      const getSpy = spyOn(obj, "value", "get").mockReturnValue("mocked");
      const setSpy = spyOn(obj, "value", "set").mockImplementation(() => {});
      setSpy.mockRestore();
      obj.value = 1;
      expect(stored).toEqual([1]);
      expect(obj.value).toBe("mocked"); // the getter spy is still in place
      getSpy.mockRestore();
      expectRestored(obj, get, set);
      expect(obj.value).toBe(1);
    });

    test("jest.restoreAllMocks restores both sides", () => {
      const { obj, get, set } = makeObject();
      spyOn(obj, "value", "get").mockReturnValue("mocked");
      spyOn(obj, "value", "set").mockImplementation(() => {});
      jest.restoreAllMocks();
      expectRestored(obj, get, set);
      obj.value = 3;
      expect(obj.value).toBe(3);
    });

    describe.each(["get-first", "set-first"] as const)(
      "both sides of a prototype accessor restore by removing the own copy (%s)",
      order => {
        test("the own copy is gone after both restores", () => {
          class Box {
            #size = 10;
            get size() {
              return this.#size;
            }
            set size(v: number) {
              this.#size = v;
            }
          }
          const box = new Box();
          const getSpy = spyOn(box, "size", "get").mockReturnValue(1);
          const setSpy = spyOn(box, "size", "set");
          expect(Object.getOwnPropertyDescriptor(box, "size")).toBeDefined();
          if (order === "get-first") {
            getSpy.mockRestore();
            // the getter is back, the setter spy is still installed on the own copy
            const own = Object.getOwnPropertyDescriptor(box, "size")!;
            expect(own.set).toBe(setSpy);
            expect(box.size).toBe(10);
            box.size = 3;
            expect(setSpy).toHaveBeenCalledWith(3);
            expect(box.size).toBe(3);
            setSpy.mockRestore();
          } else {
            setSpy.mockRestore();
            // the setter is back, the getter spy is still installed on the own copy
            const own = Object.getOwnPropertyDescriptor(box, "size")!;
            expect(own.get).toBe(getSpy);
            expect(box.size).toBe(1);
            box.size = 4;
            expect(getSpy).toHaveBeenCalled();
            getSpy.mockRestore();
            expect(box.size).toBe(4);
          }
          expect(Object.getOwnPropertyDescriptor(box, "size")).toBeUndefined();
          box.size = 5;
          expect(box.size).toBe(5);
        });
      },
    );
  });
});
