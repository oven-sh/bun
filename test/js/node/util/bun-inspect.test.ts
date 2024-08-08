import { describe, it, expect } from "bun:test";

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
