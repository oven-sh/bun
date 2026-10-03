import { describe, expect, it } from "bun:test";
import stripAnsi from "strip-ansi";

describe("Bun.inspect", () => {
  it("reports error instead of [native code]", () => {
    expect(() =>
      Bun.inspect({
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw new Error("custom inspect");
        },
      }),
    ).toThrow("custom inspect");
  });

  it("supports colors: false", () => {
    const output = Bun.inspect({ a: 1 }, { colors: false });
    expect(stripAnsi(output)).toBe(output);
  });

  it("supports colors: true", () => {
    const output = Bun.inspect({ a: 1 }, { colors: true });
    expect(stripAnsi(output)).not.toBe(output);
    expect(stripAnsi(output)).toBe(Bun.inspect({ a: 1 }, { colors: false }));
  });

  it("supports colors: false, via 2nd arg", () => {
    const output = Bun.inspect({ a: 1 }, null, null);
    expect(stripAnsi(output)).toBe(output);
  });

  it("supports colors: true, via 2nd arg", () => {
    const output = Bun.inspect({ a: 1 }, true, 2);
    expect(stripAnsi(output)).not.toBe(output);
  });

  it("supports compact", () => {
    expect(Bun.inspect({ a: 1, b: 2 }, { compact: true })).toBe("{ a: 1, b: 2 }");
    expect(Bun.inspect({ a: 1, b: 2 }, { compact: false })).toBe("{\n  a: 1,\n  b: 2,\n}");

    expect(Bun.inspect({ a: { 0: 1, 1: 2 }, b: 3 }, { compact: true })).toBe('{ a: { "0": 1, "1": 2 }, b: 3 }');
    expect(Bun.inspect({ a: { 0: 1, 1: 2 }, b: 3 }, { compact: false })).toBe(
      '{\n  a: {\n    "0": 1,\n    "1": 2,\n  },\n  b: 3,\n}',
    );
  });

  it("compact keeps the indentation balanced after an object", () => {
    // The "more items" marker is the one line break compact mode still prints.
    // It sits two levels deep, no matter how many objects came before it.
    const items = Array.from({ length: 101 }, (_, i) => i);
    const marker = ",\n    ... 1 more items ] }";
    expect(Bun.inspect({ z: items }, { compact: true })).toEndWith(marker);
    expect(Bun.inspect({ a: { x: 1 }, b: { x: 1 }, z: items }, { compact: true })).toEndWith(marker);
  });

  it("depth < 0 throws", () => {
    expect(() => Bun.inspect({}, { depth: -1 })).toThrow();
    expect(() => Bun.inspect({}, { depth: -13210 })).toThrow();
  });

  describe("depth is read by value, whichever way JSC boxes the number", () => {
    // A Float64Array element is always a double-boxed JSValue, and -0 can only be one,
    // even though each is === to the int32 it holds.
    const asDouble = (n: number) => new Float64Array([n])[0];
    const obj = { a: { b: { c: { d: 1 } } } };
    const inspected = (depth: number) => {
      try {
        return Bun.inspect(obj, { depth });
      } catch (e) {
        return "threw: " + (e as Error).message;
      }
    };
    const inspectedPositional = (depth: number) => {
      try {
        return Bun.inspect(obj, depth);
      } catch (e) {
        return "threw: " + (e as Error).message;
      }
    };

    it("a double-boxed integer behaves like the int32", () => {
      for (const depth of [0, 1, 2]) {
        expect(asDouble(depth)).toBe(depth);
        expect(inspected(asDouble(depth))).toBe(inspected(depth));
        expect(inspectedPositional(asDouble(depth))).toBe(inspectedPositional(depth));
      }
      expect(inspected(asDouble(1))).toBe("{\n  a: {\n    b: [Object ...],\n  },\n}");
    });

    it("-0 is depth 0", () => {
      expect(inspected(-0)).toBe(inspected(0));
      expect(inspectedPositional(-0)).toBe(inspectedPositional(0));
    });

    it("an integer past int32 is clamped like a large int32", () => {
      expect(inspected(2 ** 32)).toBe(inspected(0x0fff0000));
      expect(inspected(Number.MAX_SAFE_INTEGER)).toBe(inspected(Infinity));
    });

    it("a negative double-boxed integer gets the same error as the int32", () => {
      expect(inspected(asDouble(-1))).toBe("threw: expected depth to be greater than or equal to 0, got -1");
      expect(inspected(asDouble(-1))).toBe(inspected(-1));
      expect(inspectedPositional(asDouble(-1))).toBe(inspectedPositional(-1));
    });

    it("non-integers still throw", () => {
      expect(inspected(1.5)).toBe("threw: expected depth to be an integer, got 1.5");
      expect(inspected(NaN)).toBe("threw: expected depth to be an integer, got NaN");
      expect(inspectedPositional(1.5)).toBe("threw: expected depth to be an integer, got 1.5");
    });
  });
  for (let base of [new Error("hi"), { a: "hi" }]) {
    it(`depth = Infinity works for ${base.constructor.name}`, () => {
      function createRecursiveObject(n: number): any {
        if (n === 0) {
          return { a: base };
        }
        return { a: createRecursiveObject(n - 1) };
      }

      const obj = createRecursiveObject(512);
      expect(Bun.inspect(obj, { depth: Infinity })).toContain("hi");
      // this gets converted to u16, which if just truncating, will turn into 0
      expect(Bun.inspect(obj, { depth: 0x0fff0000 })).toContain("hi");
    });
  }

  it("stack overflow is thrown when it should be for objects", () => {
    var object = { a: { b: { c: { d: 1 } } } };
    for (let i = 0; i < 16 * 1024; i++) {
      object = { a: object };
    }

    expect(() => Bun.inspect(object, { depth: Infinity })).toThrowErrorMatchingInlineSnapshot(
      `"Maximum call stack size exceeded."`,
    );
  });

  it("stack overflow is thrown when it should be for Error", () => {
    var object = { a: { b: { c: { d: 1 } } } };
    for (let i = 0; i < 16 * 1024; i++) {
      const err = new Error("hello");
      err.object = object;
      object = err;
    }

    expect(() => Bun.inspect(object, { depth: Infinity })).toThrowErrorMatchingInlineSnapshot(
      `"Maximum call stack size exceeded."`,
    );
  });

  it("depth = 0", () => {
    expect(Bun.inspect({ a: { b: { c: { d: 1 } } } }, { depth: 0 })).toEqual("{\n  a: [Object ...],\n}");
  });
});
