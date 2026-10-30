import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
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
    expect(($.braces as any)("", { parse: true })).toBeString();
    expect(($.braces as any)("", { tokenize: true })).toBeString();
  });

  test("unicode", () => {
    const result = $.braces(`lol {😂,🫵,🤣}`);
    expect(result).toEqual(["lol 😂", "lol 🫵", "lol 🤣"]);
  });
});

// A brace or a comma inside a quoted span is text for `$.braces`, as it is for
// bash and for Bun's shell. The span comes back as written, with its quotes and
// its backslashes: a result is shell text again, and the shell that reads it
// needs them.
describe("$.braces leaves a quoted span as written", () => {
  // One shell word, what `$.braces` makes of it, and the words bash 5.2 makes of it.
  const words: [word: string, results: string[], bash: string[]][] = [
    ["a'{b,c}'", ["a'{b,c}'"], ["a{b,c}"]],
    ['a"{b,c}"', ['a"{b,c}"'], ["a{b,c}"]],
    ["'{a,b}'", ["'{a,b}'"], ["{a,b}"]],
    ["{a,'x,y'}", ["a", "'x,y'"], ["a", "x,y"]],
    ['{a,"x,y"}', ["a", '"x,y"'], ["a", "x,y"]],
    ["é'{b,c}'", ["é'{b,c}'"], ["é{b,c}"]],
    ["{é,'ü,ñ'}", ["é", "'ü,ñ'"], ["é", "ü,ñ"]],
    // A quoted brace does not open or close a group.
    ["{a,'{'}", ["a", "'{'"], ["a", "{"]],
    ["{'}',a}", ["'}'", "a"], ["}", "a"]],
    ["--ext='{js,ts}'", ["--ext='{js,ts}'"], ["--ext={js,ts}"]],
    // A quote of the other kind is part of the span.
    ['{a,"it\'s,x"}', ["a", '"it\'s,x"'], ["a", "it's,x"]],
    ["{a,'say\"b,c\"'}d", ["ad", "'say\"b,c\"'d"], ["ad", 'say"b,c"d']],
    // A backslash in a span stays.
    ["{a,'b\\c'}", ["a", "'b\\c'"], ["a", "b\\c"]],
    ['{a,"b\\\\c"}', ["a", '"b\\\\c"'], ["a", "b\\c"]],
    ['{a,"b\\",c"}', ["a", '"b\\",c"'], ["a", 'b",c']],
    // `$.escape` quotes a value, and `$.braces` leaves it whole.
    [$.escape("{a,b}") + "{1,2}", ['"{a,b}"1', '"{a,b}"2'], ["{a,b}1", "{a,b}2"]],
    ["{1," + $.escape("x,y") + "}", ["1", '"x,y"'], ["1", "x,y"]],
    [$.escape("$HOME") + "{1,2}", ['"\\$HOME"1', '"\\$HOME"2'], ["$HOME1", "$HOME2"]],
    // Spans beside a group.
    ["'a'{b,c}'d'", ["'a'b'd'", "'a'c'd'"], ["abd", "acd"]],
  ];

  test.each(words)("%s", async (word, results, bash) => {
    expect($.braces(word)).toEqual(results);
    // Bun's shell makes the same words of the results as of the word itself.
    const echoed = bash.join(" ") + "\n";
    expect({
      ofResults: await $`echo ${{ raw: results.join(" ") }}`.text(),
      ofWord: await $`echo ${{ raw: word }}`.text(),
    }).toEqual({ ofResults: echoed, ofWord: echoed });
  });

  test("a command line keeps its quoted arguments", () => {
    expect($.braces("grep -E 'a{2,3}' file.txt")).toEqual(["grep -E 'a{2,3}' file.txt"]);
    expect($.braces("echo 'a b' {1,2}")).toEqual(["echo 'a b' 1", "echo 'a b' 2"]);
    expect($.braces('cat "my dir/{a,b}.txt" {c,d}')).toEqual(['cat "my dir/{a,b}.txt" c', 'cat "my dir/{a,b}.txt" d']);
  });

  test("a quote with no closing partner is an ordinary character", () => {
    expect($.braces("it's {a,b}")).toEqual(["it's a", "it's b"]);
    expect($.braces("Bob's files/{a,b}.txt")).toEqual(["Bob's files/a.txt", "Bob's files/b.txt"]);
    expect($.braces('6" {a,b}')).toEqual(['6" a', '6" b']);
    expect($.braces('it\'s "{a,b}" {c,d}')).toEqual(['it\'s "{a,b}" c', 'it\'s "{a,b}" d']);
  });

  test("a word with no group outside quotes is returned itself", () => {
    // Not a copy that went through UTF-8: the lone surrogate is still there.
    expect($.braces("'{a,\ud800}'")).toEqual(["'{a,\ud800}'"]);
    expect(JSON.parse(($.braces as any)("'{a,b}'", { tokenize: true }))).toEqual([{ text: "'{a,b}'" }, "eof"]);
  });

  // Which braces and commas are syntax: `$.braces` against the lexer of Bun's shell, on generated words.
  test("the same braces and commas are syntax as for the shell lexer", () => {
    let seed = 0x9e3779b9;
    const below = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8) % n;
    const pick = (items: string[]) => items[below(items.length)];
    const many = (items: string[]) => Array.from({ length: below(5) }, () => pick(items)).join("");
    const text = ["a", "b", " ", "é", "日", "😂", "-", "/", "."];
    const escaped = ["{", "}", ",", "'", '"', "\\", "a", "é", "$", "#"];
    const inSingle = ["a", "{", "}", ",", '"', "\\", "é", "#", "$", "`"];
    const inDouble = ["a", "{", "}", ",", "'", '\\"', "\\\\", "\\a", "\\$", "\\{", "\\`", "#", "é"];
    // Every quote closes. Every brace outside quotes is part of a group with a comma:
    // the shell lexer makes a token of a lone brace, and `$.braces` makes it text.
    const piece = (depth: number): string => {
      switch (below(depth < 3 ? 7 : 6)) {
        case 0:
          return "\\" + pick(escaped);
        case 1:
          return "'" + many(inSingle) + "'";
        case 2:
          return '"' + many(inDouble) + '"';
        case 6:
          return "{" + Array.from({ length: 2 + below(2) }, () => word(depth + 1, 3)).join(",") + "}";
        default:
          return pick(text);
      }
    };
    const word = (depth: number, max: number): string =>
      Array.from({ length: below(max) }, () => piece(depth)).join("");
    const syntaxOfBraces = (s: string) =>
      (JSON.parse(($.braces as any)(s, { tokenize: true })) as any[])
        .map(token => (token === "comma" ? "," : token === "close" ? "}" : token.open ? "{" : ""))
        .join("");
    const syntaxOfShell = (s: string) =>
      (JSON.parse(shellInternals.lex(Object.assign([s], { raw: [s] }) as any)) as object[])
        .map(token => ("BraceBegin" in token ? "{" : "Comma" in token ? "," : "BraceEnd" in token ? "}" : ""))
        .join("");
    const differ: string[] = [];
    for (let round = 0; round < 500; round++) {
      const s = word(0, 10);
      if (syntaxOfBraces(s) !== syntaxOfShell(s)) differ.push(s);
    }
    expect(differ).toEqual([]);
  });

  // `$.braces` pairs quote characters only. The shell does not pair the ones of a comment or of `$(..)`.
  test.todo("a quote character in a comment or in a command substitution", () => {
    expect($.braces("# don't\necho {a,b} 'x'")).toEqual(["# don't\necho a 'x'", "# don't\necho b 'x'"]);
    expect($.braces('"$(echo "{a,b}")"')).toEqual(['"$(echo "{a,b}")"']);
  });

  // The backslash is dropped, and a shell reads each result as a quoted word.
  test.todo("a backslash before a quote stays when a group expands", () => {
    expect($.braces("\\'{a,b}\\'")).toEqual(["\\'a\\'", "\\'b\\'"]);
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

// In a shell word only the braces and commas written in the script are brace
// syntax. The same bytes from a quoted span, an interpolated value, a variable
// or a command substitution are text. `echo` is a builtin, so its output is the
// argv of the command. bash 5.2 gives the same words for every row of the table.
describe("shell: only braces and commas written in the script are brace syntax", () => {
  // `~` puts a comma and braces in front of the group.
  const home = "/h,{o}me";
  const homeEnv = { ...bunEnv, HOME: home, USERPROFILE: home };
  // Non-ASCII script text goes in as `{ raw }`: written in a tagged template it
  // reaches the shell as `\u` escapes (#30563).
  const cases: [string, () => $.ShellPromise, string[]][] = [
    ["interpolated {", () => $`echo {a,${"{"}}`, ["a", "{"]],
    ["interpolated }", () => $`echo {a,${"}"}}x`, ["ax", "}x"]],
    ["interpolated comma", () => $`echo {a,${"b,c"}}`, ["a", "b,c"]],
    ["interpolated backslash", () => $`echo {a,${"b\\c"}}`, ["a", "b\\c"]],
    ["interpolated backslash before {", () => $`echo {a,${"\\{"}}`, ["a", "\\{"]],
    ["interpolated trailing backslash", () => $`echo {a,${"b\\"}}`, ["a", "b\\"]],
    ["interpolated single quotes", () => $`echo {a,${"'x,y'"}}`, ["a", "'x,y'"]],
    ["interpolated double quotes", () => $`echo {a,${'"x,y"'}}`, ["a", '"x,y"']],
    ["interpolated group before a group", () => $`echo ${"{a,b}"}{1,2}`, ["{a,b}1", "{a,b}2"]],
    ["single-quoted comma", () => $`echo {a,'x,y'}`, ["a", "x,y"]],
    ["double-quoted comma", () => $`echo {a,"x,y"}`, ["a", "x,y"]],
    ["single-quoted group", () => $`echo a'{b,c}'d`, ["a{b,c}d"]],
    ["double-quoted group", () => $`echo a"{b,c}"d`, ["a{b,c}d"]],
    ["single-quoted {", () => $`echo {a,'{'}`, ["a", "{"]],
    ["single-quoted }", () => $`echo {'}',a}`, ["}", "a"]],
    ["backslash before a comma", () => $`echo {a,b\,c}`, ["a", "b,c"]],
    ["variable with a comma", () => $`echo {$V,c}`.env({ ...bunEnv, V: "a,b" }), ["a,b", "c"]],
    ["variable with a group", () => $`echo {$V,c}`.env({ ...bunEnv, V: "{x,y}" }), ["{x,y}", "c"]],
    ["variable with quotes", () => $`echo {$V,c}`.env({ ...bunEnv, V: "'q,r'" }), ["'q,r'", "c"]],
    ["command substitution with a comma", () => $`echo {$(echo a,b),c}`, ["a,b", "c"]],
    ["command substitution with a group", () => $`echo {$(echo '{x,y}'),c}`, ["{x,y}", "c"]],
    ["command substitution with quotes", () => $`echo {$(echo "'q,r'"),c}`, ["'q,r'", "c"]],
    ["non-ASCII word, interpolated comma", () => $`echo ${{ raw: "é{a," }}${"b,c"}${{ raw: "}ü" }}`, ["éaü", "éb,cü"]],
    ["non-ASCII word, interpolated {", () => $`echo ${{ raw: "{ñ," }}${"{"}${{ raw: "}" }}`, ["ñ", "{"]],
    [
      "non-ASCII word, interpolated backslash and comma",
      () => $`echo ${{ raw: "{日本," }}${"語\\,"}${{ raw: "}" }}`,
      ["日本", "語\\,"],
    ],
    ["non-ASCII word, interpolated emoji", () => $`echo ${{ raw: "{😂," }}${"🫵,🤣"}${{ raw: "}" }}`, ["😂", "🫵,🤣"]],
    ["non-ASCII word, quoted comma", () => $`echo ${{ raw: "{é,'ü,ñ'}" }}`, ["é", "ü,ñ"]],
    ["group after ~", () => $`echo ~/{a,b}`.env(homeEnv), [`${home}/a`, `${home}/b`]],
    ["group after ~, interpolated comma", () => $`echo ~/{a,${"x,y"}}`.env(homeEnv), [`${home}/a`, `${home}/x,y`]],
  ];

  test.each(cases)("%s", async (_name, run, expected) => {
    expect((await run().text()).slice(0, -1).split(" ")).toEqual(expected);
  });

  test("group, `*`, group with an interpolated comma", async () => {
    using dir = tempDir("shell-brace-star-offsets", { "ac": "", "bc": "", "ad,e": "", "bd,e": "" });
    const out = await $`echo {a,b}*{c,${"d,e"}}`.cwd(String(dir)).text();
    // The files that the pattern matches. The brace variants themselves come first today.
    const files = out
      .slice(0, -1)
      .split(" ")
      .filter(word => !word.includes("*"));
    expect(files.sort()).toEqual(["ac", "ad,e", "bc", "bd,e"]);
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

describe("$.braces arguments", () => {
  test("input is ToString", () => {
    expect($.braces(12 as any)).toEqual(["12"]);
    expect($.braces({ toString: () => "a{b,c}" } as any)).toEqual(["ab", "ac"]);
  });

  test("a word with nothing to expand comes back as it was", () => {
    expect($.braces("a\ud800b")).toEqual(["a\ud800b"]);
  });

  test("options are an object, null or undefined", () => {
    for (const options of [undefined, null, {}, [], () => {}]) {
      expect($.braces("a{b,c}", options as any)).toEqual(["ab", "ac"]);
    }
    for (const options of [5, "s", true, Symbol("s")]) {
      expect(() => $.braces("a{b,c}", options as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: "BracesOptions must be an object",
        }),
      );
    }
  });

  test("an argument that was not passed is undefined", () => {
    expect(($.braces as any)()).toEqual(["undefined"]);
    expect($.braces(undefined as any)).toEqual(["undefined"]);
  });
});
