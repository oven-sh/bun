import { expect, test } from "bun:test";

test("a global match goes on behind an empty match at the end of the string", () => {
  expect("abc".match(/x*/g)).toEqual(["", "", "", ""]);
  expect("日本".match(/x*/g)).toEqual(["", "", ""]);
  expect("".match(/x*/g)).toEqual([""]);
  expect("abc".replace(/x*/g, "-")).toBe("-a-b-c-");
  expect("日本".replace(/x*/g, "-")).toBe("-日-本-");
  expect("abc".split(/x*/g)).toEqual(["a", "b", "c"]);
  expect(Array.from("abc".matchAll(/x*/g), match => match.index)).toEqual([0, 1, 2, 3]);
});
