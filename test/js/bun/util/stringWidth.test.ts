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

// Test for strings with control characters and binary data (from gist)
test("handles binary data with control characters", () => {
  // This string caused freezing issues in earlier versions
  const problematicString = `com.apple.lastuseddate#PS: S�\u000bi\ncom.apple.macl: \x07@��Y6�>J��'��\x03�FS\ncom.apple.metadata:kMDItemWhereFroms: bplist00�\x01\x02_\x11\x02\x04https://software.download.prss.microsoft.com/dbazure/Win11_25H2_English_Arm64.iso?t=984c522c-a10b-41d5-99ec-68cc848694c9&P1=1762014682&P2=601&P3=2&P4=G6eN0uFrG64Ft%2bDz061PD0rTvYV2UQjZUVtyS9Rn9Ytt0F%2bscgadBtf%2fUs5BKFyowVlDqPhEbTtqBsPEk21bgNAyRwBj%2fgnQcRhiIwEcqSJ9Wyf4ChE%2bYRuc0Eeha9IJakJwuBizc38a4qKsEIxihqroM01TM8iANCExlWWZKG3Gayc%2b18OcvGefTc1G%2bvtvd57AWmeK1kho00yTFtT1sqdS6OXV000YyaYoIVLjVypaoQj7MYJ46vCQb%2bVvn3QZgXaMVwbKjCMI15ezgpGptQPWBssWz9hYC9Fv1OuWcmBwvLGkvL1MczAWSuY3P0kqfezG%2fdkh2cX5NUo2G3zPtw%3d%3d_\x10\x1ahttps://www.microsoft.com/\ncom.apple.provenance: \x01\x02\n`;

  // Should not freeze and should return a reasonable width
  const width = Bun.stringWidth(problematicString);
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThan(problematicString.length + 100);

  // Also test with countAnsiEscapeCodes: false (the default)
  const width2 = Bun.stringWidth(problematicString, { countAnsiEscapeCodes: false });
  expect(width2).toBeGreaterThan(0);
  expect(width2).toBeLessThan(problematicString.length + 100);
});

// Test edge cases with malformed ANSI sequences
test("handles malformed ANSI sequences", () => {
  // ESC without [
  expect(Bun.stringWidth("\x1bHello")).toBeGreaterThan(0);

  // ESC [ without closing m
  expect(Bun.stringWidth("\x1b[31Hello")).toBeGreaterThan(0);

  // ESC [ with other characters but no m
  expect(Bun.stringWidth("\x1b[31;32;33Hello")).toBeGreaterThan(0);

  // Multiple unclosed sequences
  expect(Bun.stringWidth("\x1b[31\x1b[32\x1b[33Hello")).toBeGreaterThan(0);

  // Control characters mixed with text
  expect(Bun.stringWidth("\x01\x02\x03Hello\x07\x0b\x10\x1aWorld")).toBeGreaterThan(0);
});
