import { test, expect } from "bun:test";

test("example 1", () => {
  expect("a\nb\nc\n d\ne").toEqual("a\nd\nc\nd\ne");
});
test("example 2", () => {
  expect({
    object1: "a",
    object2: "b",
    object3: "c\nd\ne",
  }).toEqual({
    object1: "a",
    object2: " b",
    object3: "c\nd",
  });
});

test("example 3 - very long string with few changes", () => {
  // Create a 1000 line string with only a few differences
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
  const originalString = lines.join("\n");

  // Create expected string with only a few changes
  const expectedLines = [...lines];
  expectedLines[499] = "line 500 - CHANGED"; // Change line 500
  expectedLines[750] = "line 751 - MODIFIED"; // Change line 751
  expectedLines[900] = "line 901 - DIFFERENT"; // Change line 901
  expectedLines.splice(100, 0, "line 101 - INSERTED");
  const expectedString = expectedLines.join("\n");

  expect(originalString).toEqual(expectedString);
});
