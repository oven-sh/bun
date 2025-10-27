import { TOON } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.TOON", () => {
  test("TOON object exists", () => {
    expect(TOON).toBeDefined();
    expect(TOON.parse).toBeDefined();
    expect(TOON.stringify).toBeDefined();
  });

  describe("TOON.stringify", () => {
    test("stringify null", () => {
      expect(TOON.stringify(null)).toBe("null");
    });

    test("stringify boolean", () => {
      expect(TOON.stringify(true)).toBe("true");
      expect(TOON.stringify(false)).toBe("false");
    });

    test("stringify number", () => {
      expect(TOON.stringify(42)).toBe("42");
      expect(TOON.stringify(3.14)).toBe("3.14");
      expect(TOON.stringify(0)).toBe("0");
    });

    test("stringify string", () => {
      expect(TOON.stringify("hello")).toBe("hello");
      expect(TOON.stringify("hello world")).toBe("hello world");
    });

    test("stringify string with special characters", () => {
      expect(TOON.stringify("hello, world")).toBe('"hello, world"');
      expect(TOON.stringify("true")).toBe('"true"');
      expect(TOON.stringify("false")).toBe('"false"');
      expect(TOON.stringify("123")).toBe('"123"');
    });

    test("stringify empty string", () => {
      expect(TOON.stringify("")).toBe('""');
    });

    test("stringify simple object", () => {
      const result = TOON.stringify({ name: "Alice", age: 30 });
      // For now, just check it doesn't crash
      expect(result).toBeDefined();
    });

    test("stringify array", () => {
      const result = TOON.stringify(["a", "b", "c"]);
      // For now, just check it doesn't crash
      expect(result).toBeDefined();
    });
  });

  describe("TOON.parse", () => {
    test.todo("parse null", () => {
      expect(TOON.parse("null")).toBe(null);
    });

    test.todo("parse boolean", () => {
      expect(TOON.parse("true")).toBe(true);
      expect(TOON.parse("false")).toBe(false);
    });

    test.todo("parse number", () => {
      expect(TOON.parse("42")).toBe(42);
      expect(TOON.parse("3.14")).toBe(3.14);
    });

    test.todo("parse string", () => {
      expect(TOON.parse("hello")).toBe("hello");
      expect(TOON.parse('"hello, world"')).toBe("hello, world");
    });

    test.todo("parse simple object", () => {
      const result = TOON.parse("name: Alice\nage: 30");
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    test.todo("parse array", () => {
      const result = TOON.parse("items[3]: a,b,c");
      expect(result).toEqual({ items: ["a", "b", "c"] });
    });
  });

  describe("round-trip", () => {
    test.todo("null round-trip", () => {
      const value = null;
      expect(TOON.parse(TOON.stringify(value))).toEqual(value);
    });

    test.todo("simple values round-trip", () => {
      expect(TOON.parse(TOON.stringify(true))).toBe(true);
      expect(TOON.parse(TOON.stringify(42))).toBe(42);
      expect(TOON.parse(TOON.stringify("hello"))).toBe("hello");
    });
  });
});
