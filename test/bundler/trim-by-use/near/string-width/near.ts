console.log(
  "\u4f60\u597d".length,
  [..."\u{1f600}"].length,
  Bun.stripANSI("\x1b[31mred\x1b[0m"),
  "abc".padEnd(5, ".") + "|",
);
try {
  (undefined as any).x;
} catch (error) {
  console.log(String(error).length > 0);
}
