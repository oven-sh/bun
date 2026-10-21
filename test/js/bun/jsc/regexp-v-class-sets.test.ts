import { parse } from "acorn";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JavaScriptCore's RegExp parser decides which `v` class sets are a SyntaxError. acorn implements the same grammar
// and early errors on its own, so it says what each set should be. Every set is tried alone and in a pattern of more
// than 64 characters, which JavaScriptCore only syntax-checks when it creates the RegExp.

const operands = ["a", "\\x61", "\\d", "\\q{ab}", "\\q{}", "\\q{a|b}", "\\p{Emoji_Keycap_Sequence}", "[\\q{ab}]"];
const thirdOperands = ["a", "\\d", "\\q{ab}", "\\q{}"];
const padding = "(?:" + Buffer.alloc(70, "z").toString() + ")?";

function acornAccepts(set: string) {
  try {
    parse(`/${set}/v`, { ecmaVersion: "latest" });
    return true;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return false;
  }
}

function engineVerdict(source: string) {
  let regExp: RegExp;
  try {
    regExp = new RegExp(source, "v");
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return "refused";
  }
  try {
    regExp.test("a");
  } catch (e) {
    return `created, then ${(e as Error).name} at the first match`;
  }
  return "accepted";
}

// Every case where JavaScriptCore and the grammar disagree about one of `sets`.
function differences(sets: string[]) {
  const different: string[] = [];
  for (const set of sets) {
    const expected = acornAccepts(set) ? "accepted" : "refused";
    for (const [form, source] of [
      ["alone", set],
      ["in a long pattern", set + padding],
    ]) {
      const verdict = engineVerdict(source);
      if (verdict !== expected) different.push(`${set} ${form}: ${verdict}, the grammar says ${expected}`);
    }
  }
  return different;
}

describe("v class sets are a SyntaxError when the grammar says so, at any pattern length", () => {
  // A negated class is a SyntaxError when it may contain strings. What its operands say depends on the operator.
  test.each([
    ["operands that follow one another", "", 136],
    ["an intersection", "&&", 128],
    ["a subtraction", "--", 128],
  ])("a negated class of %s", (_, operator, count) => {
    const sets: string[] = [];
    for (const first of operands) {
      if (operator === "") sets.push(`[^${first}]`);
      for (const second of operands) {
        sets.push(`[^${first}${operator}${second}]`);
        if (!thirdOperands.includes(first) || !thirdOperands.includes(second)) continue;
        for (const third of thirdOperands) sets.push(`[^${first}${operator}${second}${operator}${third}]`);
      }
    }

    expect(sets.length).toBe(count);
    expect(differences(sets)).toEqual([]);
  });

  test("a negated class inside another class", () => {
    // Only a few: JavaScriptCore takes milliseconds to build one negated class that is nested in a `v` class.
    const sets: string[] = [];
    for (const operand of ["\\q{ab}", "\\q{}", "\\p{Emoji_Keycap_Sequence}", "[\\q{ab}]", "a", "\\q{a|b}"]) {
      sets.push(`[[^${operand}]]`, `[a[^${operand}]]`);
    }

    expect(sets.length).toBe(12);
    expect(differences(sets)).toEqual([]);
  });

  // A class is a union, an intersection or a subtraction, and never a mix. The grammar has no operator after
  // operands with nothing between them, and no second operand after the operand of an operator.
  test("a union with an operator", () => {
    const sets = [
      "[\\p{L}\\p{N}--\\p{Lu}]",
      "[a\\q{ab}&&b]",
      "[\\d\\w&&a]",
      "[a[b]&&c]",
      "[^a\\q{ab}&&\\d]",
      "[a&&\\da]",
      "[a&&b[c]]",
    ];

    expect(sets.filter(acornAccepts)).toEqual([]);
    expect(differences(sets)).toEqual([]);
  });

  // A nested class is a class of its own, whatever is before it in the class around it.
  test("a nested class after another operand", () => {
    const valid = [
      "[\\d[a&&b]]",
      "[\\q{ab}[a&&b]]",
      "[a-z[\\p{Lu}--[A-Z]]]",
      // What oniguruma-to-es writes for the Oniguruma class [a-z[:graph:]].
      "[a-z[\\P{space}&&\\P{Cc}&&\\P{Cn}&&\\P{Cs}]]",
    ];
    const invalid = ["[\\d[--b]]", "[\\d[&&b]]", "[[a&&]]", "[a[b--]]"];

    expect([...valid, ...invalid].filter(acornAccepts)).toEqual(valid);
    expect(differences([...valid, ...invalid])).toEqual([]);
  });

  test("a literal gets the same verdict when its module loads", async () => {
    const run = async (source: string) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, error: stderr.match(/SyntaxError: .*/)?.[0], exitCode };
    };

    expect(
      await Promise.all([
        run(String.raw`console.log(/^[a-z[\p{Lu}--[A-Z]]]$/v.test("\u00c9"))`),
        run(String.raw`console.log(/^[\p{L}\p{N}--\p{Lu}]$/v.test("a"))`),
      ]),
    ).toEqual([
      { stdout: "true\n", error: undefined, exitCode: 0 },
      { stdout: "", error: "SyntaxError: Invalid regular expression: invalid operation in class set", exitCode: 1 },
    ]);
  });
});
