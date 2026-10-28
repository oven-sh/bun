// Prints in how many bits JSON.stringify holds its result, for texts held in 16 bits, after calls that made narrow, wide and large results.
import { jscDescribe } from "bun:jsc";

const heldIn16Bits = text => Buffer.from(text, "utf16le").toString("utf16le");
const widthOf = text => (/8Bit:\((\d)\)/.exec(jscDescribe(text))[1] === "1" ? 8 : 16);
const callsBefore = {
  "nothing": () => {},
  "a narrow result": () => JSON.stringify({ a: "abc" }),
  "a wide result": () => JSON.stringify({ a: "中" }),
  "a large wide result": () => JSON.stringify({ a: "中".repeat(20000) }),
  "a large narrow result": () => JSON.stringify({ a: "a".repeat(20000) }),
};
const texts = {
  ascii: "abcdefgh",
  latin1: "éàüabcdefgh",
  escapes: 'a"b\\c\n',
  long: "abcdefgh".repeat(40),
  large: "abcdefgh".repeat(4000),
  wide: "中abc",
};
const places = {
  member: text => ({ a: text }),
  element: text => [text],
  nested: text => ({ a: [{ b: text }] }),
  alone: text => text,
  second: text => ({ a: "x", b: text }),
  twice: text => ({ a: text, b: text }),
  besideWide: text => ({ a: text, b: "中" }),
};
for (const before in callsBefore)
  for (const text in texts)
    for (const place in places) {
      callsBefore[before]();
      const result = JSON.stringify(places[place](heldIn16Bits(texts[text])));
      console.log(before, "|", text, "|", place, "|", widthOf(result), result.length);
    }
