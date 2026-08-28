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

// The expansion collected its words into one buffer and recorded a word
// boundary only when that buffer was already non-empty, so an empty variant
// at the start of the list had no representation and was dropped: `{,b}`
// gave ["b"] while `{b,}` gave ["b", ""]. Every variant is an argv word.
describe("empty brace variants are argv words in every position", () => {
  // With `-e` there is no script path, so the user args start at argv[1].
  const printArgv = "console.log(JSON.stringify(process.argv.slice(1)))";
  const cases: [string, string[]][] = [
    ["{,b}", ["", "b"]],
    ["{b,}", ["b", ""]],
    ["{,}", ["", ""]],
    ["{,,,}", ["", "", "", ""]],
    ["{,,b}", ["", "", "b"]],
    ["{,a,b}", ["", "a", "b"]],
    ["{a,,b}", ["a", "", "b"]],
    ["{a,b,}", ["a", "b", ""]],
    ["x{,,}", ["x", "x", "x"]],
    ["{,}y", ["y", "y"]],
    ["{,b}{,c}", ["", "c", "b", "bc"]],
    ["{{,a},b}", ["", "a", "b"]],
    ["x {,b} y", ["x", "", "b", "y"]],
    // A quoted empty prefix belongs to the same word, it is not a word of its own.
    ['""{,b}', ["", "b"]],
    ['""{,,}', ["", "", ""]],
  ];

  test.concurrent.each(cases)("%s", async (words, expected) => {
    const { stdout, stderr, exitCode } = await $`${bunExe()} -e ${printArgv} ${{ raw: words }}`
      .env(bunEnv)
      .nothrow()
      .quiet();
    expect({ argv: JSON.parse(stdout.toString()), stderr: stderr.toString(), exitCode }).toEqual({
      argv: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  test("builtin echo prints the empty word", async () => {
    expect(await $`echo {,b}`.text()).toBe(" b\n");
    expect(await $`echo {,}`.text()).toBe(" \n");
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
});
