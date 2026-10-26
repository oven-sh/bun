import { describe, expect, test } from "bun:test";

// https://github.com/tc39/proposal-structs: `export default struct` and the anonymous forms.

describe("export default struct", () => {
  test("an anonymous struct is the default export", async () => {
    const mod = await import("./fixtures/default-struct");
    const p = new mod.default(1, 2);
    expect(p.sum()).toBe(3);
    expect(Object.keys(p)).toEqual(["a", "b"]);
    expect(Object.isExtensible(p)).toBe(false);
  });

  test("an anonymous struct can extend another struct", async () => {
    const mod = await import("./fixtures/default-extends-struct");
    const base = await import("./fixtures/default-struct");
    const p = new mod.default();
    expect(Object.keys(p)).toEqual(["a", "b", "c"]);
    expect(p instanceof base.default).toBe(true);
  });

  test("an anonymous shared struct is the default export", async () => {
    const mod = await import("./fixtures/default-shared-struct");
    const s = new mod.default();
    expect(Object.getPrototypeOf(s)).toBeNull();
    s.count = 3;
    expect(Atomics.load(s, "count")).toBe(3);
    expect(Reflect.canBeShared(s)).toBe(true);
  });

  test("a named default struct binds its name", async () => {
    const mod = await import("./fixtures/default-named-struct");
    expect(mod.default.name).toBe("Named");
  });

  test("struct stays an identifier when no declaration follows `export default`", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });
    expect(() => transpiler.transformSync("var struct = 1; export default struct;")).not.toThrow();
    expect(() => transpiler.transformSync("var shared = 1; export default shared + 1;")).not.toThrow();
    // A newline after `struct` ends the expression, so the `{` that follows is not a struct body.
    expect(() => transpiler.transformSync("var struct = 1; export default struct\n{}")).not.toThrow();
  });
});
