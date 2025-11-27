import { indexOfLine } from "bun";
import { expect, test } from "bun:test";

test("indexOfLine handles non-number offset", () => {
  // Regression test: passing a non-number offset should not crash
  expect(indexOfLine(new Uint8ClampedArray(), {})).toBe(-1);
  expect(indexOfLine(new Uint8Array(), {})).toBe(-1);

  // Various non-number offsets should coerce properly
  expect(indexOfLine(new Uint8Array(), null)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), undefined)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), NaN)).toBe(-1);

  // With actual content
  const buf = new Uint8Array([104, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100]); // "hello\nworld"
  expect(indexOfLine(buf, {})).toBe(5); // {} coerces to NaN -> 0
  expect(indexOfLine(buf, "2")).toBe(5); // "2" coerces to 2, newline is at 5
});

test("indexOfLine", () => {
  const source = `
        const a = 1;

        const b = 2;

        😋const c = 3; // handles unicode

        😋 Get Emoji — All Emojis to ✂️

        const b = 2;

        const c = 3;
`;
  var i = 0;
  var j = 0;
  const buffer = Buffer.from(source);
  var nonEmptyLineCount = 0;
  while (i < buffer.length) {
    const prev = j;
    j = source.indexOf("\n", j);
    i = indexOfLine(buffer, i);

    const delta = Buffer.byteLength(source.slice(0, j), "utf8") - j;
    console.log(source.slice(prev + 1, j));
    if (i === -1) {
      expect(j).toBe(-1);
      expect(nonEmptyLineCount).toBe(6);
      break;
    }
    expect(i++ - delta).toBe(j++);
    nonEmptyLineCount++;
  }
});
