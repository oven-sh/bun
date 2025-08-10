import { test, expect } from "bun:test";

function normalizeInspectError(e: any) {
  let str = Bun.inspect(e, { colors: true });

  str = str.slice(str.indexOf("error"));
  return str
    .replaceAll(import.meta.dirname, "<test-dir>")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .replaceAll(process.cwd(), "<cwd>");
}

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

test.todo("example 4 - ansi colors don't get printed to console", () => {
  expect("\x1b[31mhello\x1b[0m").toEqual("\x1b[32mhello\x1b[0m");
});

test("example 12 - large multiline diff", () => {
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

test("example 13 - simple multiline diff with sections", () => {
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

test("example 14 - single line diff", () => {
  const received = `"¡hello, world"`;
  const expected = `"hello, world!"`;
  expect(received).toEqual(expected);
});

test("example 15 - unicode char diff", () => {
  const received = `Hello 👋 世界 🌎!`;
  const expected = `Hello 👋 世界 🌍!`;
  expect(received).toEqual(expected);
});

test("example 16 - indentation change diff", () => {
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

test("example 17 - very long string", () => {
  const receivedLines: string[] = [];
  const expectedLines: string[] = [];
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

test("example 18 - very long single line string", () => {
  const expected = "a".repeat(1000000);
  const received = "a".repeat(1000001);
  expect(received).toEqual(expected);
});

test("not", () => {
  expect("Hello, World!").not.toEqual("Hello, World!");
});

test("has end newline vs doesn't", () => {
  expect("Hello, World!\n").toEqual("Hello, World!");
});

test("extremely float64array", () => {
  const length = 10000;
  const expected = new Float64Array(length);
  const received = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    expected[i] = i;
    received[i] = i + 1;
  }
  expect(received).toEqual(expected);
});

test("completely different long value does not truncate", () => {
  const length = 100;
  const expected = new Int32Array(length);
  const received = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    expected[i] = i;
    received[i] = length - i - 1;
  }
  expect(received).toEqual(expected);
});

test("whitespace-only difference", () => {
  expect("hello\nworld ").toEqual("hello\nworld");
});

test.skipIf(!Bun.enableANSIColors)("whitespace-only difference (ANSI)", () => {
  try {
    expect("hello\nworld ").toEqual("hello\nworld");
  } catch (e) {
    expect(normalizeInspectError(e)).toMatchInlineSnapshot(`
      "error\x1B[0m\x1B[2m:\x1B[0m \x1B[1m\x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

        \x1B[0m\x1B[2m"hello\x1B[0m
      \x1B[32m- \x1B[0m\x1B[32mworld\x1B[0m\x1B[32m"\x1B[0m
      \x1B[31m+ \x1B[0m\x1B[31mworld\x1B[0m\x1B[31m\x1B[7m \x1B[0m\x1B[31m"\x1B[0m

      \x1B[32m- Expected  - 1\x1B[0m
      \x1B[31m+ Received  + 1\x1B[0m
      \x1B[0m
      \x1B[0m      \x1B[2mat \x1B[0m\x1B[0m\x1B[2m<anonymous>\x1B[0m\x1B[2m (\x1B[0m\x1B[0m\x1B[36m<test-dir>/diffexample.fixture.ts\x1B[0m\x1B[2m:\x1B[0m\x1B[33m317\x1B[0m\x1B[2m:\x1B[33m29\x1B[0m\x1B[2m)\x1B[0m
      "
    `);
  }
});

test("mix of whitespace-only and non-whitespace-only differences", () => {
  expect("hello\nworld ").toEqual("Hello\nworld ");
});

test.skipIf(!Bun.enableANSIColors)("mix of whitespace-only and non-whitespace-only differences (ANSI)", () => {
  try {
    expect("hello\nworld ").toEqual("Hello\nworld ");
  } catch (e) {
    expect(normalizeInspectError(e)).toMatchInlineSnapshot(`
      "error\x1B[0m\x1B[2m:\x1B[0m \x1B[1m\x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[32m- \x1B[0m\x1B[32m"\x1B[0m\x1B[32mH\x1B[0m\x1B[32mello\x1B[0m
      \x1B[31m+ \x1B[0m\x1B[31m"\x1B[0m\x1B[31mh\x1B[0m\x1B[31mello\x1B[0m
        \x1B[0m\x1B[2mworld "\x1B[0m

      \x1B[32m- Expected  - 1\x1B[0m
      \x1B[31m+ Received  + 1\x1B[0m
      \x1B[0m
      \x1B[0m      \x1B[2mat \x1B[0m\x1B[0m\x1B[2m<anonymous>\x1B[0m\x1B[2m (\x1B[0m\x1B[0m\x1B[36m<test-dir>/diffexample.fixture.ts\x1B[0m\x1B[2m:\x1B[0m\x1B[33m341\x1B[0m\x1B[2m:\x1B[33m29\x1B[0m\x1B[2m)\x1B[0m
      "
    `);
  }
});
