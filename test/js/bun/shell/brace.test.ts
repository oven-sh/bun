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

// `{`, `,`, `}` inside `'…'`/`"…"`/`$'…'` are literal and the quote chars are
// dropped; the `$` shell already got this right (it quote-parses first). Each
// expected value is the `printf '[%s]\n' <input>` output under bash 5.2.
describe("$.braces is quote-aware (bash 5.2)", () => {
  const cases: [string, string[]][] = [
    // Single-quoted span: literal content, quote characters dropped.
    ["a'{b,c}'", ["a{b,c}"]],
    ["'{a,b}'", ["{a,b}"]],
    ["{a,'x,y'}", ["a", "x,y"]],
    ["{a,'{b,c}'}", ["a", "{b,c}"]],
    ["pre{a,'b,c','d,e'}post", ["preapost", "preb,cpost", "pred,epost"]],
    ["{a,''}", ["a", ""]],
    ["'a'\"b\"{c,d}", ["abc", "abd"]],
    ["'a\\b'", ["a\\b"]],
    // Double-quoted span: literal content, `\` escapes only `"`/`\`/`$`/`` ` ``/LF.
    ['a"{b,c}"', ["a{b,c}"]],
    ['{a,"x,y"}', ["a", "x,y"]],
    ['"a\\"b"', ['a"b']],
    ['"a\\\\b"', ["a\\b"]],
    ['"a\\nb"', ["a\\nb"]],
    ['"a\\{b,c\\}"', ["a\\{b,c\\}"]],
    ['"a\\\nb"', ["ab"]],
    // `$'…'`: literal content for brace purposes, `$` consumed along with the
    // quotes. `\'` does not terminate the span.
    ["$'{a,b}'", ["{a,b}"]],
    ["{x,$'a,b'}", ["x", "a,b"]],
    ["$'\\'{a,b}'", ["'{a,b}"]],
    ["$'{a,\\'b}'", ["{a,'b}"]],
    // `$"…"`: treated like `"…"` with the `$` consumed.
    ['$"{a,b}"', ["{a,b}"]],
    ['a$"{b,c}"d', ["a{b,c}d"]],
    // `${…}`: inhibits brace expansion until the depth-matched `}` (bash §3.5.1;
    // parameter expansion itself is not performed here).
    ["${a,b}", ["${a,b}"]],
    ["{x,${a,b}}", ["x", "${a,b}"]],
    ["${x:-{a,b}}", ["${x:-{a,b}}"]],
    ["${a}{b,c}", ["${a}b", "${a}c"]],
    ["\\${a,b}", ["$a", "$b"]],
    // Backslash outside quotes removes itself and makes the next char literal,
    // or both characters for `\<newline>` (line continuation).
    ["a\\{b,c\\}", ["a{b,c}"]],
    ["\\'{a,b}\\'", ["'a'", "'b'"]],
    ['\\"{a,b}\\"', ['"a"', '"b"']],
    ["a\\\nb", ["ab"]],
    // Unicode content inside a quoted span.
    ["{😂,'🫵,🤣'}", ["😂", "🫵,🤣"]],
    // No brace group: the quote-stripped text is returned, not the raw input.
    ["'hello'", ["hello"]],
    ["x\\y", ["xy"]],
    // An unterminated quote consumes to end of input (no throw).
    ["'{a,b}", ["{a,b}"]],
  ];

  for (const [input, expected] of cases) {
    test(`$.braces(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      expect($.braces(input)).toEqual(expected);
    });
  }

  test("the shell still treats a literal quote byte inside a brace word as data", async () => {
    // `\'` in shell source is a literal `'` byte in the expanded word. The
    // brace expander must not start a quote span at that byte (the shell path
    // backslash-escapes it before handing it to the brace lexer).
    const out = (await $`echo ${{ raw: "{a,\\'x,y\\'}" }}`.text()).trim();
    expect(out.split(" ")).toEqual(["a", "'x", "y'"]);
    // And a quote byte arriving via JS interpolation is data too.
    const out2 = (await $`echo {a,${"'x,y'"}}`.text()).trim();
    expect(out2.split(" ")).toEqual(["a", "'x,y'"]);
    // `$` inside a brace variant survives expansion.
    const out3 = (await $`echo {a,${"$b"}}c`.text()).trim();
    expect(out3.split(" ")).toEqual(["ac", "$bc"]);
  });
});

// A shell word combining brace + glob (`src/*.{ts,tsx}`, `{src,lib}/*.ts`) was
// brace-expanded but the resulting `*` patterns were never globbed (the
// brace-expand state always transitioned to Done instead of re-entering glob).
describe("brace + glob composition", () => {
  test("src/*.{ts,tsx} globs after brace expansion", async () => {
    using dir = tempDir("shell-brace-glob", {
      "src/app.ts": "",
      "src/util.tsx": "",
    });
    // The glob walker joins matched paths with the native separator on
    // Windows, so normalize before asserting.
    const out = (await $`echo src/*.{ts,tsx}`.cwd(String(dir)).text()).trim().replaceAll("\\", "/");
    const words = out.split(" ");
    // Zig composes both the literal brace variants and the glob matches.
    expect(words).toContain("src/app.ts");
    expect(words).toContain("src/util.tsx");
    expect(words).toContain("src/*.ts");
    expect(words).toContain("src/*.tsx");
  });

  test("{src,lib}/*.ts composes a brace prefix with a glob", async () => {
    using dir = tempDir("shell-brace-glob2", {
      "src/a.ts": "",
      "lib/b.ts": "",
    });
    const out = (await $`echo {src,lib}/*.ts`.cwd(String(dir)).text()).trim().replaceAll("\\", "/");
    const words = out.split(" ");
    expect(words).toContain("src/a.ts");
    expect(words).toContain("lib/b.ts");
  });

  test("an interpolated comma inside a brace group is one literal branch", async () => {
    using dir = tempDir("shell-brace-glob3", {
      "x.ts": "",
      "x.,foo": "",
      "x.]foo": "",
    });
    // `echo` rather than `ls`: the literal brace variants (`*.ts`, `*.,foo`)
    // are also emitted as argv words and do not exist as files.
    const out = (await $`echo *.{ts,${",foo"}}`.cwd(String(dir)).text()).trim();
    const words = out.split(" ");
    expect(words).toContain("x.ts");
    // The interpolated `,foo` is matched as a single literal branch...
    expect(words).toContain("x.,foo");
    // ...and does not split into a spurious `]foo` branch.
    expect(words).not.toContain("x.]foo");
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
});
