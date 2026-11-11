console.log(
  Bun.stringWidth("hello"),
  Bun.stringWidth("\u4f60\u597d"),
  Bun.stringWidth("\x1b[31mred\x1b[0m"),
  Bun.stringWidth("\x1b[31mred\x1b[0m", { countAnsiEscapeCodes: true }),
  Bun.stringWidth("\u{1f600}"),
  Bun.stringWidth("e\u0301"),
);
