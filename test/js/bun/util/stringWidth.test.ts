import { test, expect, describe } from "bun:test";

import npmStringWidth from "string-width";
import { stringWidth } from "bun";

expect.extend({
  toMatchNPMStringWidth(received: string) {
    const width = npmStringWidth(received);
    const bunWidth = stringWidth(received);
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
  toMatchNPMStringWidthExcludeANSI(received: string) {
    const width = npmStringWidth(received, { countAnsiEscapeCodes: false });
    const bunWidth = stringWidth(received, { countAnsiEscapeCodes: false });
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
});

test.skipIf(!stringWidth)("stringWidth", () => {
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
    test.skipIf(!stringWidth)("ansi colors", () => {
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
  test.todo("leading non-ansi characters in UTF-16 string seems to fail", () => {
    expect("\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎a")[matcher]();
  });
}
