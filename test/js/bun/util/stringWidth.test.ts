import { describe, expect, test } from "bun:test";
import npmStringWidth from "string-width";

expect.extend({
  toMatchNPMStringWidth(received: string) {
    const width = npmStringWidth(received, { countAnsiEscapeCodes: true });
    const bunWidth = Bun.stringWidth(received, { countAnsiEscapeCodes: true });
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
  toMatchNPMStringWidthExcludeANSI(received: string) {
    const width = npmStringWidth(received, { countAnsiEscapeCodes: false });
    const bunWidth = Bun.stringWidth(received, { countAnsiEscapeCodes: false });
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
});

test("stringWidth", () => {
  expect(undefined).toMatchNPMStringWidth();
  expect("").toMatchNPMStringWidth();
  expect("a").toMatchNPMStringWidth();
  expect("ab").toMatchNPMStringWidth();
  expect("abc").toMatchNPMStringWidth();
  expect("😀").toMatchNPMStringWidth();
  expect("😀😀").toMatchNPMStringWidth();
  expect("😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
});

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  describe(matcher, () => {
    test("ansi colors", () => {
      expect("\u001b[31m")[matcher]();
      expect("\u001b[31ma")[matcher]();
      expect("\u001b[31mab")[matcher]();
      expect("\u001b[31mabc")[matcher]();
      expect("\u001b[31m😀")[matcher]();
      expect("\u001b[31m😀😀")[matcher]();
      expect("\u001b[31m😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀😀😀")[matcher]();

      expect("a\u001b[31m")[matcher]();
      expect("ab\u001b[31m")[matcher]();
      expect("abc\u001b[31m")[matcher]();
      expect("😀\u001b[31m")[matcher]();
      expect("😀😀\u001b[31m")[matcher]();
      expect("😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀😀😀\u001b[31m")[matcher]();

      expect("a\u001b[31mb")[matcher]();
      expect("ab\u001b[31mc")[matcher]();
      expect("abc\u001b[31m😀")[matcher]();
      expect("😀\u001b[31m😀😀")[matcher]();
      expect("😀😀\u001b[31m😀😀😀")[matcher]();
      expect("😀😀😀\u001b[31m😀😀😀😀")[matcher]();
      expect("😀😀😀😀\u001b[31m😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀\u001b[31m😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀😀😀")[matcher]();
    });
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("leading non-ansi characters in UTF-16 string seems to fail", () => {
    expect("\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎a")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("upstream", () => {
    expect("abcde")[matcher]();
    expect("古池や")[matcher]();
    expect("あいうabc")[matcher]();
    expect("あいう★")[matcher]();
    expect("±")[matcher]();
    expect("ノード.js")[matcher]();
    expect("你好")[matcher]();
    expect("안녕하세요")[matcher]();
    expect("A\uD83C\uDE00BC")[matcher]();
    expect("\u001B[31m\u001B[39m")[matcher]();
    // expect("\u001B]8;;https://github.com\u0007Click\u001B]8;;\u0007")[matcher]();
    expect("\u{231A}")[matcher]();
    expect("\u{2194}\u{FE0F}")[matcher]();
    expect("\u{1F469}")[matcher]();
    expect("\u{1F469}\u{1F3FF}")[matcher]();
    expect("\u{845B}\u{E0100}")[matcher]();
    expect("ปฏัก")[matcher]();
    expect("_\u0E34")[matcher]();
    expect("\u001B[31m\u001B[39m")[matcher]();
  });
}

test("ambiguousIsNarrow=false", () => {
  for (let countAnsiEscapeCodes of [false, true]) {
    for (let string of ["⛣", "あいう★", "“"]) {
      const actual = Bun.stringWidth(string, { countAnsiEscapeCodes, ambiguousIsNarrow: false });
      expect(actual).toBe(npmStringWidth(string, { countAnsiEscapeCodes, ambiguousIsNarrow: false }));
    }
  }
});

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("ignores control characters", () => {
    expect(String.fromCodePoint(0))[matcher]();
    expect(String.fromCodePoint(31))[matcher]();
    expect(String.fromCodePoint(127))[matcher]();
    expect(String.fromCodePoint(134))[matcher]();
    expect(String.fromCodePoint(159))[matcher]();
    expect("\u001B")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("handles combining characters", () => {
    expect("x\u0300")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("handles ZWJ characters", () => {
    expect("👶")[matcher]();
    expect("👶🏽")[matcher]();
    expect("aa👶🏽aa")[matcher]();
    expect("👩‍👩‍👦‍👦")[matcher]();
    expect("👨‍❤️‍💋‍👨")[matcher]();
  });
}
