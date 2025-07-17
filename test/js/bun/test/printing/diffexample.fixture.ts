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

test("example 4 - ansi colors don't get printed to console", () => {
  expect("\x1b[31mhello\x1b[0m").toEqual("\x1b[32mhello\x1b[0m");
});

test("example 5 - Unicode characters", () => {
  expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
});

test("example 6 - Unicode with line breaks", () => {
  expect("Line 1: 你好\nLine 2: مرحبا\nLine 3: Здравствуйте").toEqual("Line 1: 你好\nLine 2: مرحبا\nLine 3: Привет");
});

test("example 7 - Mixed Unicode in objects", () => {
  expect({
    emoji: "🔥💧🌊",
    chinese: "测试字符串",
    arabic: "اختبار",
    mixed: "Hello 世界 🌍",
  }).toEqual({
    emoji: "🔥💧🌊",
    chinese: "测试文本",
    arabic: "اختبار",
    mixed: "Hello 世界 🌎",
  });
});

test("example 8 - Latin-1 characters", () => {
  expect("café résumé naïve").toEqual("café resumé naive");
});

test("example 9 - Latin-1 extended characters", () => {
  expect("© ® ™ £ € ¥ § ¶").toEqual("© ® ™ £ € ¥ § ¶");
});

test("example 10 - Latin-1 with line breaks", () => {
  expect("Línea 1: ñoño\nLínea 2: àèìòù\nLínea 3: äëïöü").toEqual("Línea 1: ñoño\nLínea 2: àèìòù\nLínea 3: aeiou");
});

test("example 11 - Latin-1 in objects", () => {
  expect({
    french: "crème brûlée",
    spanish: "niño español",
    special: "½ ¼ ¾ ± × ÷",
  }).toEqual({
    french: "crème brulée",
    spanish: "niño español",
    special: "½ ¼ ¾ ± × ÷",
  });
});
