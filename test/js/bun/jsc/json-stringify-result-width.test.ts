// JSON.stringify holds its result in 8 bits whenever every character of the result fits, whatever the call before it made.
import { jscDescribe } from "bun:jsc";
import { expect, test } from "bun:test";

const heldIn16Bits = (text: string) => Buffer.from(text, "utf16le").toString("utf16le");
const widthOf = (text: string) => (/8Bit:\((\d)\)/.exec(jscDescribe(text))![1] === "1" ? 8 : 16);

const callsBefore: Record<string, () => unknown> = {
  "nothing": () => undefined,
  "a narrow result": () => JSON.stringify({ a: "abc" }),
  "a wide result": () => JSON.stringify({ a: "中" }),
  "a large wide result": () => JSON.stringify({ a: "中".repeat(20000) }),
  "a large narrow result": () => JSON.stringify({ a: "a".repeat(20000) }),
};
const texts: Record<string, string> = {
  ascii: "abcdefgh",
  latin1: "éàüabcdefgh",
  escapes: 'a"b\\c\n',
  long: "abcdefgh".repeat(40),
  large: "abcdefgh".repeat(4000),
  wide: "中abc",
};
const places: Record<string, (text: string) => unknown> = {
  member: text => ({ a: text }),
  element: text => [text],
  nested: text => ({ a: [{ b: text }] }),
  alone: text => text,
  second: text => ({ a: "x", b: text }),
  twice: text => ({ a: text, b: text }),
  besideWide: text => ({ a: text, b: "中" }),
};

for (const before in callsBefore) {
  test(`after ${before}`, () => {
    const widths: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const text in texts) {
      for (const place in places) {
        callsBefore[before]();
        const value = places[place](heldIn16Bits(texts[text]));
        const result = JSON.stringify(value);
        expect(JSON.parse(result)).toEqual(value);
        widths[`${text} ${place}`] = widthOf(result);
        expected[`${text} ${place}`] = text === "wide" || place === "besideWide" ? 16 : 8;
      }
    }
    expect(widths).toEqual(expected);
  });
}
