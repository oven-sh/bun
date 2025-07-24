import { test, expect } from "bun:test";

test("YAML.stringify does not add anchors for non-circular objects", () => {
  const obj = { name: "test", value: 42 };
  const arr = [obj, obj]; // Same object referenced twice, but not circular
  
  const result = Bun.YAML.stringify(arr);
  
  // Should not contain anchor/alias syntax since it's not truly circular
  expect(result).not.toContain("&anchor");
  expect(result).not.toContain("*anchor");
  
  // Should just serialize normally (may duplicate the object)
  expect(result).toContain("name: test");
  expect(result).toContain("value: 42");
});

test("YAML.stringify handles true circular references", () => {
  const obj: any = { name: "test" };
  obj.self = obj; // True circular reference
  
  const result = Bun.YAML.stringify(obj);
  
  // Should contain anchor/alias syntax for circular reference
  expect(result).toContain("&anchor");
  expect(result).toContain("*anchor");
  expect(result).toContain("name: test");
});

test("YAML.stringify handles circular array references", () => {
  const arr: any = [1, 2];
  arr.push(arr); // Circular array reference
  
  const result = Bun.YAML.stringify(arr);
  
  // Should contain anchor/alias syntax for circular reference
  expect(result).toContain("&anchor");
  expect(result).toContain("*anchor");
  expect(result).toContain("- 1");
  expect(result).toContain("- 2");
});

test("YAML.stringify handles complex circular structures", () => {
  const a: any = { name: "a" };
  const b: any = { name: "b" };
  a.ref = b;
  b.ref = a; // Circular reference between two objects
  
  const result = Bun.YAML.stringify({ root: a });
  
  // Should handle the circular reference properly
  expect(result).toContain("&anchor");
  expect(result).toContain("*anchor");
  expect(result).toContain("name: a");
  expect(result).toContain("name: b");
});