import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/12276
test("toIncludeRepeated should check for exact count, not at least count", () => {
  // The bug: toIncludeRepeated was checking if string contains AT LEAST n occurrences
  // Instead of EXACTLY n occurrences

  // These should pass - exact match
  expect("hello hello world").toIncludeRepeated("hello", 2);
  expect("hello world").toIncludeRepeated("hello", 1);
  expect("world").toIncludeRepeated("hello", 0);

  // These should pass - not exact match with .not
  expect("hello hello world").not.toIncludeRepeated("hello", 1);
  expect("hello hello world").not.toIncludeRepeated("hello", 3);
  expect("hello hello hello").not.toIncludeRepeated("hello", 2);

  // Additional test cases
  expect("abc abc abc").toIncludeRepeated("abc", 3);
  expect("abc abc abc").not.toIncludeRepeated("abc", 1);
  expect("abc abc abc").not.toIncludeRepeated("abc", 2);
  expect("abc abc abc").not.toIncludeRepeated("abc", 4);

  // Edge cases - std.mem.count doesn't count overlapping occurrences
  expect("aaa").toIncludeRepeated("aa", 1); // "aa" appears once (non-overlapping)
  expect("aaaa").toIncludeRepeated("aa", 2); // "aa" appears twice (non-overlapping)
});
