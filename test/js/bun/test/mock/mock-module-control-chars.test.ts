import { expect, mock, test } from "bun:test";

test("mock.module does not crash on specifiers containing control characters", () => {
  const specifiers = ["function f() {}\nfunction g() {}", "foo\rbar", "foo\u0000bar", "line1\nline2\nline3"];
  for (const specifier of specifiers) {
    expect(() => mock.module(specifier, () => ({ default: 1 }))).not.toThrow();
  }
});
