import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Yarr compiles a RegExp to bytecode when the JIT declines it, for example a
// pattern nested deeper than the JIT's recursion limit. The bytecode compiler
// used to emit an AlternativeBegin term for every group and remove it again
// when the group turned out to have one alternative. The removal shifted every
// term emitted inside the group, so nested groups compiled in quadratic time
// (oven-sh/WebKit#574).
//
// BUN_JSC_useRegExpJIT=0 sends every pattern to the bytecode compiler, so the
// cases do not depend on where the JIT gives up.
const interpreterEnv = { ...bunEnv, BUN_JSC_useRegExpJIT: "0" };

async function runInInterpreter(source: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: interpreterEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe.concurrent("Yarr bytecode compiler", () => {
  test("nested groups around a long literal compile in linear time", async () => {
    // The old compiler shifts depth * width terms. The depth stays well under
    // the compiler's own recursion limit in debug builds (about 2000). A flat
    // pattern with the same literal is the baseline, so the bound does not
    // depend on the speed of the machine. Unfixed, the ratio is about 7 in a
    // debug build and about 80 in a release build. Fixed, it is below 2.
    const result = (await runInInterpreter(`
      const width = 200000;
      const body = Buffer.alloc(width - 1, "a").toString();

      // The last character differs per run so the RegExp cache does not hand
      // back an already compiled RegExp.
      function compileAndMatch(depth, salt) {
        const open = Buffer.alloc(depth * 3, "(?:").toString();
        const close = Buffer.alloc(depth, ")").toString();
        const pattern = open + body + close + salt;
        const input = body + salt;
        const start = performance.now();
        const match = new RegExp(pattern).exec(input);
        const elapsed = performance.now() - start;
        if (match?.[0].length !== width) throw new Error("bad match at depth " + depth + ": " + match?.[0].length);
        return elapsed;
      }

      const flat = [];
      const deep = [];
      for (const salt of ["b", "c"]) {
        flat.push(compileAndMatch(1, salt));
        deep.push(compileAndMatch(1000, salt));
      }
      console.log(JSON.stringify({ flat: Math.min(...flat), deep: Math.min(...deep) }));
    `)) as { flat: number; deep: number };

    expect(result.deep / result.flat).toBeLessThan(4);
  });

  test("groups with one or more alternatives still match", async () => {
    // One case per group kind the bytecode compiler emits (once, terminal,
    // subpattern, lookahead, lookbehind), with a single alternative and with
    // several, so both layouts of the emitted bytecode are checked.
    const cases = [
      ["(?:ab)c", "xabc"],
      ["(?:ab|cd)e", "xcde"],
      ["(?:a|b|c)+$", "xbca"],
      ["(?:ab)*$", "xabab"],
      ["(?:ab|cd)*$", "xabcd"],
      ["(?:ab)+c", "xababc"],
      ["(?:ab|cd)+e", "xabcde"],
      ["(ab|cd){2,3}e", "abcdabe"],
      ["(?=ab)a", "cab"],
      ["(?=ab|cd)c", "abcd"],
      ["(?!ab|cd)[a-d]", "abcdx"],
      ["(?<=ab)c", "abc"],
      ["(?<=ab|cd)e", "cde"],
      ["(?<!ab|cd)e", "abexe"],
      ["(?:(?:a|b)(?:c))+", "acbcad"],
      ["(?:(?:(?:x)))y", "xy"],
      ["(?:)a(?:b|)", "ab"],
      ["()(?:)x", "x"],
      ["(?=)(?<=)y", "y"],
    ] as const;

    const result = await runInInterpreter(`
      const cases = ${JSON.stringify(cases)};
      console.log(JSON.stringify(cases.map(([pattern, input]) => {
        const match = new RegExp(pattern).exec(input);
        return match ? [match.index, ...match] : null;
      })));
    `);

    expect(result).toEqual([
      [1, "abc"],
      [1, "cde"],
      [1, "bca"],
      [1, "abab"],
      [1, "abcd"],
      [1, "ababc"],
      [1, "abcde"],
      [0, "abcdabe", "ab"],
      [1, "a"],
      [2, "c"],
      [1, "b"],
      [2, "c"],
      [2, "e"],
      [4, "e"],
      [0, "acbc"],
      [0, "xy"],
      [0, "ab"],
      [0, "x", ""],
      [0, "y"],
    ]);
  });
});
