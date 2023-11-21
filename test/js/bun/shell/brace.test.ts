import { braces } from "bun";
import { redirect } from "./util";
import { expect, describe, test } from "bun:test";

describe("brace_expansion", () => {
  test("basic", () => {
    const expected = [
      { "text": "LMAO" },
      { "open": {} },
      { "text": "js" },
      { "comma": {} },
      { "text": "jsx" },
      { "close": {} },
      { "text": "NICE" },
      { "open": {} },
      { "text": "ts" },
      { "comma": {} },
      { "text": "tsx" },
      { "comma": {} },
      { "text": "zig" },
      { "close": {} },
      { "text": "LOL" },
    ];
    const value = braces("LMAO{js,jsx}NICE{ts,tsx,zig}LOL", { tokenize: true });
    // console.log("Value", value);
    expect(JSON.parse(value)).toEqual(expected);
  });

  test("unclosed", () => {
    const expected = [
      { text: "{js,jsx,hi" },
      { open: {} },
      { text: "ts" },
      { comma: {} },
      { text: "tsx" },
      { close: {} },
    ];
    const value = braces("{js,jsx,hi{ts,tsx}", { tokenize: true });
    console.log("Value", value);
    expect(JSON.parse(value)).toEqual(expected);
  });
});
