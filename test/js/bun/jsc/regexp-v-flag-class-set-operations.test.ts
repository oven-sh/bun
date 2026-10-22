import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JavaScriptCore computes each operation of a `v` class set (the union with a nested class or a class escape, `&&`,
// `--`, the complement of a nested class) by merging the sorted ranges of its operands (oven-sh/WebKit#855). Before
// that it walked the operands one code point at a time, and [^b], \D and \S cover U+0100 to U+10FFFF.

describe("RegExp v flag class set operations", () => {
  // 4,000 operands that each cover 1,113,856 code points. The walk over each code point took about 10 ms for each
  // operand each time the pattern was built, so these classes cannot be built inside the spawn timeout. The merge
  // takes under a second in a debug build.
  test("a class with thousands of wide operands is built in linear time", async () => {
    const fixture = `
      const operands = 4000;
      const union = new RegExp("^[" + Buffer.alloc(operands * 4, "[^b]").toString() + "]$", "v");
      const difference = new RegExp("^[\\\\D" + Buffer.alloc(operands * 6, "--[^a]").toString() + "]$", "v");
      console.log(JSON.stringify({
        union: ["a", "b", "\\u4e00"].map(string => union.test(string)),
        difference: ["a", "c", "\\u4e00"].map(string => difference.test(string)),
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), stderr: /error|panic|assert|abort/i.test(stderr) ? stderr : "", exitCode }).toEqual(
      {
        stdout: JSON.stringify({ union: [true, false, true], difference: [true, false, false] }),
        stderr: "",
        exitCode: 0,
      },
    );
    expect(proc.signalCode).toBeNull();
  }, 60_000);

  const matches = (source: string, flags: string, strings: string[]) => {
    const regexp = new RegExp(source, flags);
    return strings.map(string => regexp.test(string));
  };

  test("an operation with a wide operand holds the right code points", () => {
    expect(matches("^[a[^b]]$", "v", ["a", "c", "\u4e00", "\u{1f600}", "b", "ab"])).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(matches("^[\\q{ab}[^\\q{a}]]$", "v", ["ab", "b", "a", "abb"])).toEqual([true, true, false, false]);
    expect(matches("^[\\D--\u4e00]$", "v", ["a", "\u4e01", "\u4e00", "7"])).toEqual([true, true, false, false]);
    expect(matches("^[\\D&&\\S&&[^\u4e00]]$", "v", ["a", "\u{1f600}", "\u4e00", "7", " "])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(matches("^[a-z\\S]$", "v", ["a", "7", "\u4e00", " "])).toEqual([true, true, true, false]);
    expect(matches("^[a-zA-Z0-9_\\p{L}]$", "v", ["a", "7", "_", "\u4e00", "-"])).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(matches("^[\\p{L}--\\p{Lu}]$", "v", ["a", "\u4e00", "A", "7"])).toEqual([true, true, false, false]);
    expect(matches("^[\\p{L}--[a-z]]$", "v", ["A", "\u4e00", "a", "7"])).toEqual([true, true, false, false]);
    expect(matches("^[[^\\p{L}]\u4e00]$", "v", ["7", "\u4e00", "a", "\u4e01"])).toEqual([true, true, false, false]);
    expect(matches("^[\u4e00[^b]]$", "vi", ["a", "\u4e00", "b", "B"])).toEqual([true, true, false, false]);
    expect(matches("^[[^k]&&\\w]$", "vi", ["a", "_", "k", "K", "\u212a"])).toEqual([true, true, false, false, false]);
  });

  // With `i`, each alternative of \q{} adds its case variants after it: the operand lists code points out of order,
  // and more than once when the alternatives are case variants of each other.
  test("an operation with a \\q{} operand that ignores case holds the right code points", () => {
    expect(matches("^[\\q{\u0431}]$", "vi", ["\u0431", "\u0411", "\u0430"])).toEqual([true, true, false]);
    expect(matches("^[[\u4e00]\\q{\u0431}]$", "vi", ["\u0431", "\u0411", "\u4e00", "\u0430"])).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(matches("^[[\u0100-\u{10ffff}]&&\\q{\u0431}]$", "vi", ["\u0431", "\u0411", "\u0430", "\u4e00"])).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(matches("^[[\u0100-\u{10ffff}]--\\q{\u0431}]$", "vi", ["\u0430", "\u4e00", "\u0431", "\u0411"])).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(
      matches("^[[\u0100-\u{10ffff}]--\\q{\u0410|\u0411}]$", "vi", ["\u0432", "\u0412", "\u0430", "\u0410", "\u0411"]),
    ).toEqual([true, true, false, false, false]);
    expect(matches("^[\\q{\u03c3|\u03c2|\u03a3}--[^\u03a3]]$", "vi", ["\u03c3", "\u03c2", "\u03a3", "\u03b1"])).toEqual(
      [true, true, true, false],
    );
    expect(
      matches("^[[\u0100-\u{10ffff}]&&\\q{\u0431|\u0411|\u4e00}]$", "vi", ["\u0431", "\u0411", "\u4e00", "\u0430"]),
    ).toEqual([true, true, true, false]);
  });

  // JavaScriptCore accepts an operator after two operands, where the specification has a SyntaxError. The left side
  // is then built like a plain union: it lists the code points of \p{Lu} one by one, although they are inside the
  // ranges of \p{L}. While such a class is accepted, it holds the right code points.
  test("an operator after two operands holds the right code points, if the class is accepted", () => {
    const matchesIfAccepted = (source: string, strings: string[]) => {
      try {
        return matches(source, "v", strings);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return null;
      }
    };
    const strings = ["A", "a", "\u0100", "\u0101", "\u0102", "\u0103", "\u02c1", "\u02c2", "\u4e00"];
    expect(matchesIfAccepted("^[\\p{L}\\p{Lu}--[\\u{102}\\u{103}-\\u{2c1}]]$", strings)).toBeOneOf([
      null,
      [true, true, true, true, false, false, false, false, true],
    ]);
    expect(matchesIfAccepted("^[\\p{L}\\p{Lu}&&[\\u{102}\\u{103}-\\u{2c1}]]$", strings)).toBeOneOf([
      null,
      [false, false, false, false, true, true, true, false, false],
    ]);
    expect(matchesIfAccepted("^[[\\u{100}-\\u{17f}]\\p{Lu}--[\\u{100}\\u{104}\\u{106}-\\u{110}]]$", strings)).toBeOneOf(
      [null, [true, false, false, true, true, true, false, false, false]],
    );
  });
});
