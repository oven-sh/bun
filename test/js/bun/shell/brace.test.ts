import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

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
    // The outer `{...}` has no comma of its own, so it is literal (bash 5.2).
    expect($.braces(`{{d,e}{g,h}}`)).toEqual(["{dg}", "{dh}", "{eg}", "{eh}"]);
  });

  test("nested sibling product with surrounding text", () => {
    expect($.braces(`pre{{a,b}{c,d}}post`)).toEqual(["pre{ac}post", "pre{ad}post", "pre{bc}post", "pre{bd}post"]);
  });

  test("nested sibling product mixed with variants", () => {
    expect($.braces(`{a,{b,c}{d,e},f}`)).toEqual(["a", "bd", "be", "cd", "ce", "f"]);
  });

  test("nested sibling product triple", () => {
    expect($.braces(`{{a,b}{c,d}{e,f}}`)).toEqual([
      "{ace}",
      "{acf}",
      "{ade}",
      "{adf}",
      "{bce}",
      "{bcf}",
      "{bde}",
      "{bdf}",
    ]);
  });

  // The nested-expansion parser consumed `}` via the outer loop guard after a
  // trailing `,`, so `{a,}` inside a nested group yielded one variant instead
  // of two and the last output slot was left empty.
  describe("nested with empty variant", () => {
    test.each([
      ["{x,a{,}b}", ["x", "ab", "ab"]],
      ["{x,{a,}}z", ["xz", "az", "z"]],
      ["{x,{,a}}z", ["xz", "z", "az"]],
      ["{x,{,}}z", ["xz", "z", "z"]],
      ["a{b,c{d,}}e", ["abe", "acde", "ace"]],
      ["a{b,c{,d}}e", ["abe", "ace", "acde"]],
      ["{x,{a,,b}}", ["x", "a", "", "b"]],
      ["{x,{a,b,}}", ["x", "a", "b", ""]],
      ["{{a,},x}", ["a", "", "x"]],
      ["p{q,{r,}{s,}}t", ["pqt", "prst", "prt", "pst", "pt"]],
    ])("%s", (pattern, expected) => {
      expect($.braces(pattern)).toEqual(expected);
    });
  });

  test("very deeply nested", () => {
    // The innermost `{17}` has no comma, so it is literal (bash 5.2).
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
      "{17}",
    ]);
  });

  test("literal outer group around hundreds of nested groups", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const inner = Buffer.alloc(256 * 3, "{a,").toString() + "b" + Buffer.alloc(256, "}").toString();
console.log(JSON.stringify(Bun.$.braces("{" + inner)));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const expected = [...Array.from({ length: 256 }, () => "{a"), "{b"];
    expect(stdout.trim()).toBe(JSON.stringify(expected));
    expect(exitCode).toBe(0);
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

// Brace expansion precedes pathname expansion, and each resulting word is
// globbed on its own. `{d1,d2}/*` used to emit the literal `d1/*` and `d2/*`
// words *in addition to* their matches, because the brace-expand state pushed
// every variant to argv and then globbed the un-expanded pattern.
describe.concurrent("brace + glob composition", () => {
  // The glob walker joins matched paths with the native separator on Windows,
  // and readdir order is not sorted, so normalize before asserting.
  const words = (out: string) => out.trim().replaceAll("\\", "/").split(" ").sort();

  test("src/*.{ts,tsx} globs each variant and drops the patterns", async () => {
    using dir = tempDir("shell-brace-glob", {
      "src/app.ts": "",
      "src/util.tsx": "",
    });
    const out = await $`echo src/*.{ts,tsx}`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["src/app.ts", "src/util.tsx"]);
  });

  test("src/**/*.test.{ts,tsx} keeps both * of a ** through brace expansion", async () => {
    // `**` records two adjacent metacharacter offsets, so each variant has to
    // come back out of brace expansion with both of them, or it stops recursing.
    using dir = tempDir("shell-brace-glob-doublestar", {
      "src/x.test.ts": "",
      "src/a/y.test.tsx": "",
      "src/a/b/z.test.ts": "",
      "src/skip.ts": "",
    });
    const out = await $`echo src/**/*.test.{ts,tsx}`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["src/a/b/z.test.ts", "src/a/y.test.tsx", "src/x.test.ts"]);
  });

  test("{src,lib}/*.ts composes a brace prefix with a glob", async () => {
    using dir = tempDir("shell-brace-glob2", {
      "src/a.ts": "",
      "lib/b.ts": "",
    });
    const out = await $`echo {src,lib}/*.ts`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["lib/b.ts", "src/a.ts"]);
  });

  test("a variant without a glob metacharacter stays literal", async () => {
    using dir = tempDir("shell-brace-glob4", {
      "aa": "",
      "ab": "",
    });
    // `nope` carries no `*`, so it is a plain word and never reaches the glob
    // walker (which would fail it as a no-match).
    const out = await $`echo {a*,nope}`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["aa", "ab", "nope"]);
  });

  test("a variant with no matches reports the expanded word", async () => {
    using dir = tempDir("shell-brace-glob5", {
      "d1/f1": "",
    });
    const { stdout, stderr, exitCode } = await $`echo {d1,nope}/*`.cwd(String(dir)).quiet().nothrow();
    // The matches `d1/*` already produced never reach argv: the word fails.
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe("bun: no matches found: nope/*\n");
    expect(exitCode).toBe(1);
  });

  test("an interpolated comma inside a brace group is one literal branch", async () => {
    using dir = tempDir("shell-brace-glob3", {
      "x.ts": "",
      "x.,foo": "",
      "x.]foo": "",
    });
    const out = await $`echo *.{ts,${",foo"}}`.cwd(String(dir)).text();
    // The interpolated `,foo` is matched as a single literal branch, and does
    // not split into a spurious `]foo` branch.
    expect(words(out)).toEqual(["x.,foo", "x.ts"]);
  });

  test("an interpolated * inside a brace variant is data, not a pattern", async () => {
    using dir = tempDir("shell-brace-glob6", {
      "a1.txt": "",
      "b1.txt": "",
    });
    // The template holds no `*`, so no variant is a glob: both stay literal
    // even though `a1.txt`/`b1.txt` would match.
    const out = await $`echo {a,b}${"*"}.txt`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["a*.txt", "b*.txt"]);
  });

  test("a literal * globs a variant while an interpolated metacharacter stays data", async () => {
    using dir = tempDir("shell-brace-glob7", {
      "a[c]1.txt": "",
      "ac1.txt": "",
      "b[c]2.txt": "",
    });
    // Each variant is neutralized on its own, so the recovered metacharacter
    // offsets must still point at the template `*` and not at the `[c]`.
    const out = await $`echo {a,b}${"[c]"}*`.cwd(String(dir)).text();
    expect(words(out)).toEqual(["a[c]1.txt", "b[c]2.txt"]);
  });
});

// $.braces() recursed once per `{` group (parse_atom <-> parse_expansion /
// expand_nested), so a word made of tens of thousands of nested braces drove
// the parser that many native stack frames deep. The parser now rejects words
// with more brace groups than it can safely recurse through, surfacing a
// catchable JS error instead.
describe("$.braces input bounds", () => {
  test("rejects a word with an excessive number of brace groups instead of crashing", async () => {
    // Run in a subprocess: on builds without the bound this input kills the
    // process via native stack overflow rather than throwing.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const deep = Buffer.alloc(100000, "{,").toString() + Buffer.alloc(50000, "}").toString();
try {
  Bun.$.braces(deep);
  console.log("expanded");
} catch (e) {
  console.log("rejected: " + e.message);
}
// The same shape with no commas is one literal word, not a brace expansion.
const literal = Buffer.alloc(50000, "{").toString() + Buffer.alloc(50000, "}").toString();
console.log(JSON.stringify(Bun.$.braces(literal)) === JSON.stringify([literal]));
// A reasonable pattern still expands normally.
console.log(JSON.stringify(Bun.$.braces("echo {a,b}")));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "rejected: Too many braces in brace expansion
      true
      ["echo a","echo b"]"
    `);
    expect(exitCode).toBe(0);
  });

  // The expander hands out output slots from a counter that is bumped once per
  // slot, so after the last of N slots it holds N. The expansion cap admits
  // N = 65536, one more than the old u16 counter could hold, so a word with
  // exactly 65536 variants tripped the overflow check in debug builds.
  // Each case runs in a subprocess because that check aborts the process. The
  // child prints [count, first, last]; the last variant lives in the slot whose
  // claim used to overflow.
  describe("exactly 65536 variants", () => {
    async function expandInChild(script: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    test.concurrent("shell word with 16 flat groups (2^16)", async () => {
      const result = await expandInChild(`
        const word = Buffer.alloc(16 * "{a,b}".length, "{a,b}").toString();
        const words = (await Bun.$\`echo \${{ raw: word }}\`.text()).trimEnd().split(" ");
        console.log(JSON.stringify([words.length, words[0], words.at(-1)]));
      `);
      expect(result).toEqual({
        stdout: JSON.stringify([65536, "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]),
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("$.braces() with 8 nested groups (4^8)", async () => {
      const result = await expandInChild(`
        const word = Buffer.alloc(8 * "{{a,b},{c,d}}".length, "{{a,b},{c,d}}").toString();
        const out = Bun.$.braces(word);
        console.log(JSON.stringify([out.length, out[0], out.at(-1)]));
      `);
      expect(result).toEqual({
        stdout: JSON.stringify([65536, "aaaaaaaa", "dddddddd"]),
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// A `{...}` group with no top-level comma is literal text in bash. The brace
// lexer used to tokenize it as Open/Close regardless, so a nested `{}` became
// a zero-variant expansion and the expander dropped the rest of the word.
describe("comma-less brace group is literal (bash 5.2)", () => {
  const cases: [string, string[]][] = [
    // Regressions: the `{}` (and the tail after it) was truncated.
    ["x{a,{}}y", ["xay", "x{}y"]],
    ["p{q{},r}s", ["pq{}s", "prs"]],
    ["{a,b{}}z", ["az", "b{}z"]],
    ["{a,{}}z", ["az", "{}z"]],
    ["a{{,}}b", ["a{}b", "a{}b"]],
    // `{foo}` with no comma is literal at any depth.
    ["{a,{b}}", ["a", "{b}"]],
    ["{a{b,c}}", ["{ab}", "{ac}"]],
    ["{{a,}{b,}}", ["{ab}", "{a}", "{b}", "{}"]],
    // A comma outside every `{...}` does not make one expand.
    ["{foo},x", ["{foo},x"]],
    ["{a},{b}", ["{a},{b}"]],
    // Controls that were already correct.
    ["a{b,{c,d}}e", ["abe", "ace", "ade"]],
    ["{a,b}", ["a", "b"]],
  ];

  for (const [input, expected] of cases) {
    test(`$.braces(${JSON.stringify(input)})`, () => {
      expect($.braces(input)).toEqual(expected);
    });
  }

  test("shell: literal {} inside an expanding group keeps the tail", async () => {
    // Subprocess so the pre-fix `}{,` panic is observed as a non-zero exit;
    // `echo` is a builtin so argv is observed exactly on every platform.
    const script = `
      const { $ } = require("bun");
      $.nothrow();
      const cases = ${JSON.stringify([...cases, ["}{,", ["}{,"]]])};
      for (const [input] of cases) {
        const { stdout } = await $\`echo \${{ raw: input }}\`.quiet();
        console.log(JSON.stringify([input, stdout.toString().slice(0, -1)]));
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const lines = stdout
      .trim()
      .split("\n")
      .map(l => JSON.parse(l));
    expect(lines).toEqual([...cases.map(([input, expected]) => [input, expected.join(" ")]), ["}{,", "}{,"]]);
    expect(exitCode).toBe(0);
  });

  test("a word with a comma-less brace group and a glob keeps its pattern", async () => {
    // `{x},*.txt` sets both the brace and glob hints; after the lexer demotes
    // `{x}` to text the brace-expand count is 0. The original pattern must
    // still reach the glob walker rather than being taken as the literal word.
    using dir = tempDir("shell-brace-literal-glob", { "a.txt": "" });
    const { stderr, exitCode } = await $`echo {x},*.txt`.cwd(String(dir)).nothrow().quiet();
    expect({ stderr: stderr.toString(), exitCode }).toEqual({
      stderr: "bun: no matches found: {x},*.txt\n",
      exitCode: 1,
    });
  });

  test("a zero-variant word with a matching glob emits only the matches", async () => {
    // The trailing comma sets the brace hint (a word needs `{`, `}` and a `,`
    // anywhere), the lexer then demotes the comma-less `{x}`, and the expand
    // count is 0. The unchanged word must keep its metacharacter offsets: the
    // template `*` globs (the walker reads `{x}` as a one-branch group, hence
    // the `x,` fixtures) and the literal pattern is not emitted next to the
    // matches. With an interpolated `*` there is no glob hint, so the word is
    // emitted as the literal text it is.
    using dir = tempDir("shell-brace-literal-glob2", {
      "x,a.txt": "",
      "x,b.txt": "",
    });
    const words = (out: string) => out.trim().split(" ").sort();
    const globbed = await $`echo {x},*.txt`.cwd(String(dir)).text();
    expect(words(globbed)).toEqual(["x,a.txt", "x,b.txt"]);
    const interpolated = await $`echo {x},${"*"}.txt`.cwd(String(dir)).text();
    expect(interpolated.trim()).toBe("{x},*.txt");
  });
});
