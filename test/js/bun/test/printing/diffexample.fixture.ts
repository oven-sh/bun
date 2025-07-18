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

test("example 12 - zig large multiline diff", () => {
  const received = `line one
line two
line three!
line four
line five
!-!six
line seven
line eight
line ten
line 11
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20
line 21
line 22
line 23
line 24
line 25
line 26
line 27
line 28!
line 29
line 30
line 31
line 32
line 33
line 34
line 35
line 36
line 37
line 38
line 39`;
  const expected = `line one
line two
line three
line four
line five
line six
line seven
line eight
line nine (inserted only)
line ten
line 11
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20
line 21
line 22
line 23
line 24
line 25
line 26
line 27
line 28
line 29
line 30
line 31
line 32
line 33
line 34
line 35
line 36
line 37
line 38
line 39`;
  expect(received).toEqual(expected);
});

test("example 13 - zig simple multiline diff with sections", () => {
  const received = `=== diffdiff ===
line one
line two!
line six
line seven

=== each line changed ===
line one?
line two
line three?
line four?

=== deleted ===
line one
line two
line three
line four
line five
line six
line seven

=== inserted ===
line one
line two
line six
line seven

=== inserted newline ===
line one
line two
line three
line four
line five
line six
line seven

=== has newline at end vs doesn't ===`;
  const expected = `=== diffdiff ===
line one
line two
line three
line four
line five
line six
line seven

=== each line changed ===
line one
line two!
line three
line four!

=== deleted ===
line one
line two
line six
line seven

=== inserted ===
line one
line two
line three
line four
line five
line six
line seven

=== inserted newline ===
line one
line two

line three
line four
line five
line six
line seven

=== has newline at end vs doesn't ===
`;
  expect(received).toEqual(expected);
});

test("example 14 - zig single line diff", () => {
  const received = `"¡hello, world"`;
  const expected = `"hello, world!"`;
  expect(received).toEqual(expected);
});

test("example 15 - zig unicode char diff", () => {
  const received = `Hello 👋 世界 🌎!`;
  const expected = `Hello 👋 世界 🌍!`;
  expect(received).toEqual(expected);
});

test("example 16 - zig indentation change diff", () => {
  const received = `function main() {
    if (true) {
        print("Hello, world!");
        print("Goodbye, world!");
    }
}`;
  const expected = `function main() {
    print("Hello, world!");
    print("Goodbye, world!");
}`;
  expect(received).toEqual(expected);
});

test("example 17 - zig very long string", () => {
  const receivedLines = [];
  const expectedLines = [];
  for (let i = 0; i < 1000; i++) {
    if (i === 100) {
      receivedLines.push(`line ${i} - inserted`);
      expectedLines.push(`line ${i}`);
      continue;
    }
    if (i === 200) {
      receivedLines.push(`line ${i}`);
      expectedLines.push(`line ${i} - deleted`);
      continue;
    }
    if (i === 300) {
      receivedLines.push(`line ${i} - modified`);
      expectedLines.push(`modified - line ${i}`);
      continue;
    }
    if (i === 400) {
      receivedLines.push(`line ${i}`);
      receivedLines.push(`extra line!`);
      expectedLines.push(`line ${i}`);
      continue;
    }

    receivedLines.push(`line ${i}`);
    expectedLines.push(`line ${i}`);
  }

  // The Zig code adds a trailing newline to each string.
  const receivedString = receivedLines.join("\n") + "\n";
  const expectedString = expectedLines.join("\n") + "\n";
  expect(receivedString).toEqual(expectedString);
});
