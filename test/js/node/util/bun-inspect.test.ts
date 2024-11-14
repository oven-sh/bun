import { describe, expect, it } from "bun:test";
import stripAnsi from "strip-ansi";

describe("Bun.inspect", () => {
  it("reports error instead of [native code]", () => {
    expect(
      Bun.inspect({
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw new Error("custom inspect");
        },
      }),
    ).toBe("[custom formatter threw an exception]");
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

  it("depth < 0 throws", () => {
    expect(() => Bun.inspect({}, { depth: -1 })).toThrow();
    expect(() => Bun.inspect({}, { depth: -13210 })).toThrow();
  });
  it("depth = Infinity works", () => {
    function createRecursiveObject(n: number): any {
      if (n === 0) return { hi: true };
      return { a: createRecursiveObject(n - 1) };
    }

    const obj = createRecursiveObject(1000);

    expect(Bun.inspect(obj, { depth: Infinity })).toContain("hi");
    // this gets converted to u16, which if just truncating, will turn into 0
    expect(Bun.inspect(obj, { depth: 0x0fff0000 })).toContain("hi");
  });
  it("depth = 0", () => {
    expect(Bun.inspect({ a: { b: { c: { d: 1 } } } }, { depth: 0 })).toEqual("{\n  a: [Object ...],\n}");
  });
});
