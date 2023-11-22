import { braces } from "bun";
import { redirect } from "./util";
import { expect, describe, test } from "bun:test";

describe("brace_expansion", () => {
  test("unclosed", () => {
    const value = braces("{js,jsx,hi{ts,tsx}");
    expect(new Set(value)).toEqual(new Set(["{js,jsx,hits", "{js,jsx,hitsx"]));
  });

  test("multi1", () => {
    const value = braces("{a,b,c}{d,e,f}");
    expect(new Set(value)).toEqual(new Set(["ad", "ae", "af", "bd", "be", "bf", "cd", "ce", "cf"]));
  });

  test("multi2", () => {
    const value = braces("WOW{a,b,c}NICE{d,e,f}GREAT");
    // expect(new Set(value)).toEqual(new Set(["{js,jsx,hits", "{js,jsx,hitsx"]));
  });

  describe("lex", () => {
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
        { eof: {} },
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
        { eof: {} },
      ];
      const value = braces("{js,jsx,hi{ts,tsx}", { tokenize: true });
      console.log("Value", value);
      expect(JSON.parse(value)).toEqual(expected);
    });
  });
});
