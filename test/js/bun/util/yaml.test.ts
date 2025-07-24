import { test, expect } from "bun:test";

test("Bun.YAML exists", () => {
  expect(Bun.YAML).toBeDefined();
  expect(typeof Bun.YAML).toBe("object");
});

test("Bun.YAML.stringify exists", () => {
  expect(Bun.YAML.stringify).toBeDefined();
  expect(typeof Bun.YAML.stringify).toBe("function");
});

test("YAML.stringify basic values", () => {
  expect(Bun.YAML.stringify(null)).toBe("null");
  expect(Bun.YAML.stringify(undefined)).toBe("null");
  expect(Bun.YAML.stringify(true)).toBe("true");
  expect(Bun.YAML.stringify(false)).toBe("false");
  expect(Bun.YAML.stringify(42)).toBe("42");
  expect(Bun.YAML.stringify(3.14)).toBe("3.14");
  expect(Bun.YAML.stringify("hello")).toBe("hello");
});

test("YAML.stringify strings requiring quotes", () => {
  expect(Bun.YAML.stringify("true")).toBe('"true"');
  expect(Bun.YAML.stringify("false")).toBe('"false"');
  expect(Bun.YAML.stringify("null")).toBe('"null"');
  expect(Bun.YAML.stringify("123")).toBe('"123"');
  expect(Bun.YAML.stringify("hello: world")).toBe('"hello: world"');
  expect(Bun.YAML.stringify("- item")).toBe('"- item"');
  expect(Bun.YAML.stringify(" leading space")).toBe('" leading space"');
  expect(Bun.YAML.stringify("trailing space ")).toBe('"trailing space "');
});

test("YAML.stringify string escaping", () => {
  expect(Bun.YAML.stringify('hello "world"')).toBe('"hello \\"world\\""');
  expect(Bun.YAML.stringify("hello\\world")).toBe('"hello\\\\world"');
  expect(Bun.YAML.stringify("hello\\nworld")).toBe('"hello\\\\nworld"');
  expect(Bun.YAML.stringify("hello\nworld")).toBe('"hello\\nworld"');
  expect(Bun.YAML.stringify("hello\tworld")).toBe('"hello\\tworld"');
  expect(Bun.YAML.stringify("hello\rworld")).toBe('"hello\\rworld"');
});

test("YAML.stringify special numbers", () => {
  expect(Bun.YAML.stringify(NaN)).toBe(".nan");
  expect(Bun.YAML.stringify(Infinity)).toBe(".inf");
  expect(Bun.YAML.stringify(-Infinity)).toBe("-.inf");
});

test("YAML.stringify empty array", () => {
  expect(Bun.YAML.stringify([])).toBe("[]");
});

test("YAML.stringify simple array", () => {
  const result = Bun.YAML.stringify([1, 2, 3]);
  const expected = "- 1\n- 2\n- 3";
  expect(result).toBe(expected);
});

test("YAML.stringify nested array", () => {
  const result = Bun.YAML.stringify([1, [2, 3], 4]);
  const expected = "- 1\n- - 2\n  - 3\n- 4";
  expect(result).toBe(expected);
});

test("YAML.stringify empty object", () => {
  expect(Bun.YAML.stringify({})).toBe("{}");
});

test("YAML.stringify simple object", () => {
  const result = Bun.YAML.stringify({ a: 1, b: 2 });
  // Objects may have different property order, so check both possibilities
  expect(result === "a: 1\nb: 2" || result === "b: 2\na: 1").toBe(true);
});

test("YAML.stringify nested object", () => {
  const obj = { 
    name: "test", 
    nested: { 
      value: 42 
    } 
  };
  const result = Bun.YAML.stringify(obj);
  
  // Check that it contains the expected structure
  expect(result).toContain("name: test");
  expect(result).toContain("nested:");
  expect(result).toContain("  value: 42");
});

test("YAML.stringify array with objects", () => {
  const arr = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 }
  ];
  const result = Bun.YAML.stringify(arr);
  
  expect(result).toContain("- name: Alice");
  expect(result).toContain("  age: 30");
  expect(result).toContain("- name: Bob");
  expect(result).toContain("  age: 25");
});

test("YAML.stringify Date objects", () => {
  const date = new Date("2023-01-01T00:00:00.000Z");
  const result = Bun.YAML.stringify(date);
  expect(result).toBe("2023-01-01T00:00:00.000Z");
});

test("YAML.stringify invalid Date", () => {
  const invalidDate = new Date("invalid");
  const result = Bun.YAML.stringify(invalidDate);
  expect(result).toBe("null");
});

test("YAML.stringify circular reference", () => {
  const obj: any = { name: "test" };
  obj.self = obj;
  
  const result = Bun.YAML.stringify(obj);
  
  // Should contain anchor/alias syntax for circular reference
  expect(result).toContain("*anchor");
});

test("YAML.stringify circular reference in array", () => {
  const arr: any = [1, 2];
  arr.push(arr);
  
  const result = Bun.YAML.stringify(arr);
  
  // Should contain anchor/alias syntax for circular reference
  expect(result).toContain("*anchor");
});

test("YAML.stringify complex nested structure", () => {
  const complex = {
    users: [
      { name: "Alice", active: true, scores: [85, 92, 78] },
      { name: "Bob", active: false, scores: [90, 88, 95] }
    ],
    config: {
      version: "1.0",
      settings: {
        debug: true,
        timeout: 5000
      }
    }
  };
  
  const result = Bun.YAML.stringify(complex);
  
  // Verify basic structure is present
  expect(result).toContain("users:");
  expect(result).toContain("- name: Alice");
  expect(result).toContain("active: true");
  expect(result).toContain("scores:");
  expect(result).toContain("- 85");
  expect(result).toContain("config:");
  expect(result).toContain("version: \"1.0\"");
  expect(result).toContain("settings:");
  expect(result).toContain("debug: true");
  expect(result).toContain("timeout: 5000");
});

test("YAML.stringify with null and undefined values", () => {
  const obj = {
    nullValue: null,
    undefinedValue: undefined,
    normalValue: "test"
  };
  
  const result = Bun.YAML.stringify(obj);
  
  expect(result).toContain("nullValue: null");
  expect(result).toContain("undefinedValue: null");
  expect(result).toContain("normalValue: test");
});

test("YAML.stringify preserves array order", () => {
  const arr = ["first", "second", "third"];
  const result = Bun.YAML.stringify(arr);
  const lines = result.split('\n');
  
  expect(lines[0]).toBe("- first");
  expect(lines[1]).toBe("- second");
  expect(lines[2]).toBe("- third");
});

test("YAML.stringify handles special YAML characters in keys", () => {
  const obj = {
    "key:with:colons": "value1",
    "key-with-dashes": "value2",
    "key with spaces": "value3",
    "key[with]brackets": "value4"
  };
  
  const result = Bun.YAML.stringify(obj);
  
  expect(result).toContain('"key:with:colons": value1');
  expect(result).toContain('"key with spaces": value3');
  expect(result).toContain('"key[with]brackets": value4');
});

test("YAML.stringify error handling", () => {
  // Test with no arguments
  expect(() => Bun.YAML.stringify()).toThrow();
});