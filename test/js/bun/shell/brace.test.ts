import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("$.braces", () => {
  test("no-op", () => {
    const result = $.braces(`echo 123`);
    expect(result).toEqual(["echo 123"]);
  });

  test("2", () => {
    const result = $.braces(`echo {123,456}`);
    expect(result).toEqual(["echo 123", "echo 456"]);
  });

  test("3", () => {
    const result = $.braces(`echo {123,456,789}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789"]);
  });

  test("nested", () => {
    const result = $.braces(`echo {123,{456,789}}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789"]);
  });

  test("nested 2", () => {
    const result = $.braces(`echo {123,{456,789},abc}`);
    expect(result).toEqual(["echo 123", "echo 456", "echo 789", "echo abc"]);
  });

  test("nested sibling product", () => {
    expect($.braces(`{{d,e}{g,h}}`)).toEqual(["dg", "dh", "eg", "eh"]);
  });

  test("nested sibling product with surrounding text", () => {
    expect($.braces(`pre{{a,b}{c,d}}post`)).toEqual(["preacpost", "preadpost", "prebcpost", "prebdpost"]);
  });

  test("nested sibling product mixed with variants", () => {
    expect($.braces(`{a,{b,c}{d,e},f}`)).toEqual(["a", "bd", "be", "cd", "ce", "f"]);
  });

  test("nested sibling product triple", () => {
    expect($.braces(`{{a,b}{c,d}{e,f}}`)).toEqual(["ace", "acf", "ade", "adf", "bce", "bcf", "bde", "bdf"]);
  });

  test("very deeply nested", () => {
    const result = $.braces(`{1,{2,{3,{4,{5,{6,{7,{8,{9,{10,{11,{12,{13,{14,{15,{16,{17}}}}}}}}}}}}}}}}}`);
    expect(result).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
    ]);
  });

  test("empty string", () => {
    expect($.braces("")).toEqual([""]);
    expect($.braces("", { parse: true })).toBeString();
    expect($.braces("", { tokenize: true })).toBeString();
  });

  test("unicode", () => {
    const result = $.braces(`lol {😂,🫵,🤣}`);
    expect(result).toEqual(["lol 😂", "lol 🫵", "lol 🤣"]);
  });
});

// A brace expansion whose leading variants are empty must still emit one argv
// word per variant. The shell collapsed a run of empty variants (`{,,,}` ->
// 1 word instead of 4) because the word-boundary check used "buffer non-empty"
// as a proxy for "a prior word exists", which is false when prior variants are
// empty.
describe("brace expansion emits one argv word per variant (including empty)", () => {
  const cases: Array<[string, string]> = [
    ["{,,,}", "[][][][]"],
    ["{,a,b}", "[][a][b]"],
    ["{,a}", "[][a]"],
    ["{a,,b}", "[a][][b]"],
    ["{a,b,}", "[a][b][]"],
    ["x{,,}", "[x][x][x]"],
    ["{,}y", "[y][y]"],
    // A quoted-empty prefix is part of the *same* compound word, not a prior
    // word in the output — `""{,a}` is 2 words, not 3.
    ['""{,a}', "[][a]"],
    ['""{,,}', "[][][]"],
  ];
  for (const [pattern, expected] of cases) {
    test(pattern, async () => {
      const out = await $`printf "[%s]" ${{ raw: pattern }}`.text();
      expect(out).toBe(expected);
    });
  }
});
