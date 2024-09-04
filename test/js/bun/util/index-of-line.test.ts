import { indexOfLine } from "bun";
import { expect, test } from "bun:test";

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
