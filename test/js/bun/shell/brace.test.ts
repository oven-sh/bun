import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isRoot, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join, sep } from "path";

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

// Brace expansion precedes pathname expansion, and each resulting word is
// globbed on its own. `{d1,d2}/*` used to emit the literal `d1/*` and `d2/*`
// words *in addition to* their matches, because the brace-expand state pushed
// every variant to argv and then globbed the un-expanded pattern. Released
// versions of Bun did that too, and a test here asserted it for parity; the
// command then got words that name no file, so `ls {d1,d2}/*` failed.
describe.concurrent("brace + glob composition", () => {
  // The glob walker joins matched paths with the native separator on Windows.
  const list = (out: string) => out.trim().replaceAll("\\", "/").split(" ");
  // The variants keep their order. The matches of one variant are in the order
  // of the walker, which bash would sort, so a test with more than one sorts.
  const sorted = (out: string) => list(out).sort();
  const run = async (dir: string, script: string) => {
    const { stdout, stderr, exitCode } = await $`${{ raw: script }}`.cwd(dir).quiet().nothrow();
    return { stdout: stdout.toString().replaceAll("\\", "/"), stderr: stderr.toString(), exitCode };
  };

  test("src/*.{ts,tsx} globs each variant and drops the patterns", async () => {
    using dir = tempDir("shell-brace-glob", {
      "src/app.ts": "",
      "src/util.tsx": "",
    });
    const out = await $`echo src/*.{ts,tsx}`.cwd(String(dir)).text();
    expect(list(out)).toEqual(["src/app.ts", "src/util.tsx"]);
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
    expect(sorted(out)).toEqual(["src/a/b/z.test.ts", "src/a/y.test.tsx", "src/x.test.ts"]);
  });

  test("{src,lib}/*.ts gives the matches in the order of the variants", async () => {
    using dir = tempDir("shell-brace-glob2", {
      "src/a.ts": "",
      "lib/b.ts": "",
    });
    const out = await $`echo {src,lib}/*.ts`.cwd(String(dir)).text();
    expect(list(out)).toEqual(["src/a.ts", "lib/b.ts"]);
  });

  test("two groups and a nested group expand in brace order", async () => {
    using dir = tempDir("shell-brace-glob-order", {
      "d1/a.ts": "",
      "d1/b.js": "",
      "d2/c.ts": "",
      "d2/d.js": "",
    });
    expect(list(await $`echo {d1,d2}/*.{ts,js}`.cwd(String(dir)).text())).toEqual([
      "d1/a.ts",
      "d1/b.js",
      "d2/c.ts",
      "d2/d.js",
    ]);
    expect(list(await $`echo {d1/*.ts,d{2,1}/*.js}`.cwd(String(dir)).text())).toEqual([
      "d1/a.ts",
      "d2/d.js",
      "d1/b.js",
    ]);
  });

  test("a file that two variants match is a word for each of them", async () => {
    using dir = tempDir("shell-brace-glob-twice", {
      "aba": "",
    });
    expect(await run(String(dir), "echo {a*,*a}")).toEqual({ stdout: "aba aba\n", stderr: "", exitCode: 0 });
  });

  test("a variant without a glob metacharacter stays literal", async () => {
    using dir = tempDir("shell-brace-glob4", {
      "aa": "",
    });
    // `nope` carries no `*`, so it is a plain word and never reaches the glob
    // walker: it is a word whether or not a file has that name.
    const out = await $`echo {a*,nope}`.cwd(String(dir)).text();
    expect(list(out)).toEqual(["aa", "nope"]);
  });

  test("a variant with no match stays as written beside a variant with a match", async () => {
    using dir = tempDir("shell-brace-glob5", {
      "d1/f1": "",
    });
    // The word has a match, so it does not fail. `nope/*` was in argv on main too.
    expect(await run(String(dir), "echo {d1,nope}/*")).toEqual({
      stdout: "d1/f1 nope/*\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a variant with no match stays as written beside a variant with no *", async () => {
    using dir = tempDir("shell-brace-glob-plain", {
      "x1.bak": "",
      "z.bak": "",
      "keep.bak": "",
      "xa": "",
    });
    expect(await run(String(dir), "echo {x,y}{a,*.bak}")).toEqual({
      stdout: "xa x1.bak ya y*.bak\n",
      stderr: "",
      exitCode: 0,
    });
    // No variant has a match, but `plain` is a word without one.
    expect(await run(String(dir), "echo {nope*,plain}")).toEqual({
      stdout: "nope* plain\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a variant with no match keeps its place among variants that share a walk", async () => {
    using dir = tempDir("shell-brace-glob-place", {
      "a.ts": "",
      "b.tsx": "",
    });
    expect(await run(String(dir), "echo *.{ts,nope,tsx}")).toEqual({
      stdout: "a.ts *.nope b.tsx\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), "echo {a,zz,b}*")).toEqual({ stdout: "a.ts zz* b.tsx\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(isWindows)("rm -rf {dist,build}/* fails the second time, when no variant has a match", async () => {
    // bash exits 0 both times. What a word with no match at all does is #10581.
    using dir = tempDir("shell-brace-glob-rm", {
      "dist/a.js": "",
      "dist/b.js": "",
      "build/.keep": "",
    });
    expect(await run(String(dir), "rm -rf {dist,build}/*")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "dist"))).toEqual([]);
    expect(await run(String(dir), "rm -rf {dist,build}/*")).toEqual({
      stdout: "",
      stderr: "bun: no matches found: {dist,build}/*\n",
      exitCode: 1,
    });
  });

  test("a word fails when each variant is a pattern with no match", async () => {
    using dir = tempDir("shell-brace-glob-miss", {
      "d1/f1": "",
    });
    // The rule of a word with no brace: the message names the word as written.
    expect(await run(String(dir), "echo {nope1,nope2}/*")).toEqual({
      stdout: "",
      stderr: "bun: no matches found: {nope1,nope2}/*\n",
      exitCode: 1,
    });
  });

  test("a redirect to a match and a variant with no match stays ambiguous", async () => {
    using dir = tempDir("shell-brace-glob-redirect", {
      "d1/x1": "keep",
    });
    // Were the variant with no match dropped, `d1/x1` would be the one target and be truncated.
    expect(await run(String(dir), "echo hi > {d1,nope}/x*")).toEqual({
      stdout: "",
      stderr: "bun: ambiguous redirect: at `echo`\n",
      exitCode: 1,
    });
    expect(await Bun.file(join(String(dir), "d1", "x1")).text()).toBe("keep");
  });

  test("a redirect to a group with an empty item and one match writes the match", async () => {
    using dir = tempDir("shell-brace-glob-redirect-empty", {
      "x1": "keep",
    });
    // The empty item is no word, as in bash. On main the pattern words beside the match made this ambiguous.
    expect(await run(String(dir), "echo hi > {,x*}")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await Bun.file(join(String(dir), "x1")).text()).toBe("hi\n");
  });

  // A first word that is empty is lost, so `""` and the match are one word. #40709 and #30998 change that.
  test.todo("a redirect to a quoted empty word and a match is ambiguous", async () => {
    using dir = tempDir("shell-brace-glob-redirect-quoted", {
      "x1": "keep",
    });
    expect(await run(String(dir), 'echo hi > ""{,x*}')).toEqual({
      stdout: "",
      stderr: "bun: ambiguous redirect: at `echo`\n",
      exitCode: 1,
    });
    expect(await Bun.file(join(String(dir), "x1")).text()).toBe("keep");
  });

  test("a group can hold a path separator or name a dot directory", async () => {
    // The glob walker splits a pattern at each separator before it reads a
    // brace, and matches a dot entry only against a component that starts with
    // a dot. A variant has no brace, so neither limit applies to it.
    using dir = tempDir("shell-brace-glob-sep", {
      "src/a/1.ts": "",
      "src/c/2.ts": "",
      ".hid/h1": "",
      "d2/f3": "",
    });
    expect(list(await $`echo {src/a,src/c}/*.ts`.cwd(String(dir)).text())).toEqual(["src/a/1.ts", "src/c/2.ts"]);
    expect(list(await $`echo {.hid,d2}/*`.cwd(String(dir)).text())).toEqual([".hid/h1", "d2/f3"]);
  });

  test.skipIf(isWindows)("a group can name a symlink to a directory", async () => {
    // The walker follows a symlink only when a literal component names it.
    using dir = tempDir("shell-brace-glob-symlink", {
      "d1/f1": "",
      "d2/f3": "",
    });
    symlinkSync("d1", join(String(dir), "l1"));
    expect(list(await $`echo {l1,d2}/*`.cwd(String(dir)).text())).toEqual(["l1/f1", "d2/f3"]);
  });

  test("a comma-less group in a variant is pattern syntax, as in a word with no brace expansion", async () => {
    // The brace lexer leaves `{x}` as text. The script wrote those braces, so
    // the glob matcher reads them, as a group of one branch.
    using dir = tempDir("shell-brace-glob-demoted", {
      "xa1": "",
      "xb2": "",
    });
    expect(list(await $`echo {x}{a,b}*`.cwd(String(dir)).text())).toEqual(["xa1", "xb2"]);
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
    expect(list(out)).toEqual(["x.ts", "x.,foo"]);
  });

  test("an interpolated * inside a brace variant is data, not a pattern", async () => {
    using dir = tempDir("shell-brace-glob6", {
      "a1.txt": "",
      "b1.txt": "",
    });
    // The template holds no `*`, so no variant is a glob: both stay literal
    // even though `a1.txt`/`b1.txt` would match.
    const out = await $`echo {a,b}${"*"}.txt`.cwd(String(dir)).text();
    expect(list(out)).toEqual(["a*.txt", "b*.txt"]);
  });

  test("a literal * globs a variant while an interpolated metacharacter stays data", async () => {
    using dir = tempDir("shell-brace-glob7", {
      "a[c]1.txt": "",
      "ac1.txt": "",
      "b[c]2.txt": "",
      "azc3.txt": "",
      "bzc4.txt": "",
    });
    // Each variant is neutralized on its own, so its metacharacter offsets
    // must point at the template `*` and not at a byte of the value.
    expect(list(await $`echo {a,b}${"[c]"}*`.cwd(String(dir)).text())).toEqual(["a[c]1.txt", "b[c]2.txt"]);
    // The `*` of the value matches only a `*`, so no variant has a match.
    const { stdout, stderr, exitCode } = await $`echo {a,b}${"*c"}*`.cwd(String(dir)).quiet().nothrow();
    expect({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode }).toEqual({
      stdout: "",
      stderr: "bun: no matches found: {a,b}*c*\n",
      exitCode: 1,
    });
  });

  test("the last field of a word is not a pattern when the script wrote no * in it", async () => {
    using dir = tempDir("shell-brace-glob-field", {
      "d1": "",
    });
    // `$(echo 1 zz)` ends the field `d*1` and starts the field `zz`. The glob
    // hint is for the whole word, but `zz` has no `*`, with or without a brace.
    const plain = await run(String(dir), "echo d*$(echo 1 zz)");
    expect({ last: list(plain.stdout).at(-1), stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({
      last: "zz",
      stderr: "",
      exitCode: 0,
    });
    const braced = await run(String(dir), "echo d*$(echo 1 z){y,z}");
    expect({ last: list(braced.stdout).at(-1), stderr: braced.stderr, exitCode: braced.exitCode }).toEqual({
      last: "zz",
      stderr: "",
      exitCode: 0,
    });
  });

  test("in an assignment each variant with no match stays as written", async () => {
    using dir = tempDir("shell-brace-glob-assign", {
      "d1/f1": "",
    });
    const noMatchFirst = await $`FOO={nope,d1}/*; echo $FOO`.cwd(String(dir)).text();
    expect(list(noMatchFirst)).toEqual(["nope/*", "d1/f1"]);
    const noMatchLast = await $`FOO={d1,nope}/*; echo $FOO`.cwd(String(dir)).text();
    expect(list(noMatchLast)).toEqual(["d1/f1", "nope/*"]);
    // The word does not fail in an assignment, and the un-expanded word is not a value beside its variants.
    const noMatch = await $`FOO={n1,n2}/*; echo $FOO`.cwd(String(dir)).text();
    expect(list(noMatch)).toEqual(["n1/*", "n2/*"]);
  });

  test("a variant keeps a byte that is not UTF-8", async () => {
    using dir = tempDir("shell-brace-glob-bytes", {
      "xa": "",
    });
    // The variant is the glob pattern, so the brace lexer has to give back the
    // bytes it got. `y\xe9*` matches no file and stays as written.
    const script = String.raw`echo {x,$(echo -e 'y\xe9')}*`;
    const { stdout } = await $`${{ raw: script }}`.cwd(String(dir)).quiet();
    expect(stdout.toString("latin1")).toBe("xa y\xe9*\n");
  });

  test("a brace word gives the words of its variants written one by one", async () => {
    using dir = tempDir("shell-brace-glob-table", {
      "a.ts": "",
      "b.tsx": "",
      "c.js": "",
      "x.ts": "",
      ".dot.ts": "",
      "src/a.ts": "",
      "src/x1.ts": "",
      "src/b.tsx": "",
      "src/sub/c.ts": "",
      "src/sub/x2.tsx": "",
      "src/sub/deep/d.ts": "",
      "lib/e.ts": "",
      "lib/f.tsx": "",
      "x,a1": "",
      "x,b2": "",
      "x{a1": "",
      "x{b2": "",
      "x}a1": "",
      "x}b2": "",
      "!a1": "",
      "!b2": "",
      "@(a1": "",
      "@(b2": "",
      "[d]/a.ts": "",
      "[d]/b.tsx": "",
      "d/c.ts": "",
      ...(isWindows ? {} : { "x\\a1": "", "x\\b2": "", "x?a1": "", "x?b2": "", "x|a1": "", "x|b2": "" }),
    });
    // One walk can serve the variants that differ only in their last path
    // component. Each row has to give the same words with it and without it.
    // [a word with a brace group, the same words with no brace]
    const rows: [string, string][] = [
      ["*.{ts,tsx}", "*.ts *.tsx"],
      ["*.{ts,tsx,js}", "*.ts *.tsx *.js"],
      ["src/*.{ts,tsx}", "src/*.ts src/*.tsx"],
      ["src/**/*.{ts,tsx}", "src/**/*.ts src/**/*.tsx"],
      ["{src,lib}/*.ts", "src/*.ts lib/*.ts"],
      ["{src,lib}/**/*.{ts,tsx}", "src/**/*.ts src/**/*.tsx lib/**/*.ts lib/**/*.tsx"],
      // Two variants match `x.ts`.
      ["{*.ts,x*}", "*.ts x*"],
      ["src/**/{*.ts,x*}", "src/**/*.ts src/**/x*"],
      // A dot file is a match only for the variant that starts with a dot.
      ["{.*,*}.ts", ".*.ts *.ts"],
      // `**` goes down the tree only as a whole component.
      ["src/{*,**}", "src/* src/**"],
      ["src/*/{c,x2}*", "src/*/c* src/*/x2*"],
      // A `,` that the script wrote outside a group would split a group put around it.
      ["x,{a,b}*", "x,a* x,b*"],
      // An empty item leaves a word that ends in a separator.
      ["src/*/{,}", "src/*/ src/*/"],
      // A `*` of a group beside a `*` of the word is a `**`.
      ["{x,*}*", "x* **"],
      ["*{x,}*", "*x* **"],
      ["src/{*,s}*/c.ts", "src/**/c.ts src/s*/c.ts"],
      // Quoted text is not pattern syntax, alone or in a walk that variants share.
      ['"x{"{a,b}*', '"x{"a* "x{"b*'],
      ['"x}"{a,b}*', '"x}"a* "x}"b*'],
      ['"!"{a,b}*', '"!"a* "!"b*'],
      ['"@("{a,b}*', '"@("a* "@("b*'],
      ['"[d]"/*.{ts,tsx}', '"[d]"/*.ts "[d]"/*.tsx'],
      ...(isWindows
        ? []
        : ([
            ["'x\\'{a,b}*", "'x\\'a* 'x\\'b*"],
            ['"x?"{a,b}*', '"x?"a* "x?"b*'],
            ['"x|"{a,b}*', '"x|"a* "x|"b*'],
          ] as [string, string][])),
    ];
    for (const [braced, plain] of rows) {
      const [a, b] = await Promise.all([run(String(dir), `echo ${braced}`), run(String(dir), `echo ${plain}`)]);
      expect({ word: braced, ...a }).toEqual({ word: braced, ...b });
      expect(a.exitCode).toBe(0);
    }
  });

  // A variant written as a word of its own does not go through brace expansion, so nothing has to carry
  // which of its bytes the script wrote. Each word of script text, values and groups has to agree with that.
  test.skipIf(isWindows)("a random brace word gives the words of its variants written one by one", async () => {
    const names = ["a", "b", "aa", "ab", "ba", "bb", "aab", "aba", "abb", "baa", "bab", "bba"];
    names.push(",a", "a,", "{a", "a}", "[a", "a]", "?a", "a?", "!a", "a!", "*a", "a*", "\\a", "a\\", "a,b", "{a,b}");
    using dir = tempDir("shell-brace-glob-random", Object.fromEntries(names.map(name => [name, ""])));

    type Text = { script: string } | { value: string };
    type Part = Text | { group: Part[][] };
    // mulberry32, so that the words are the same in each run
    let seed = 1;
    const random = (below: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * below);
    };
    const pick = (from: string[]) => from[random(from.length)];
    const scripts = ["a", "b", "*", "*a", "b*"];
    const values = ["a", "*", "{", "}", ",", "\\", "[", "]", "?", "!", "*a", ",b", "{*"];
    const word = (depth: number): Part[] =>
      Array.from({ length: 1 + random(3) }, (): Part => {
        const kind = random(10);
        if (kind < 4 || (kind >= 7 && depth === 2)) return { script: pick(scripts) };
        if (kind < 7) return { value: pick(values) };
        return { group: Array.from({ length: 2 + random(2) }, () => word(depth + 1)) };
      });
    // The word as the script writes it, and its variants in brace order.
    const written = (parts: Part[]): Text[] =>
      parts.flatMap(part =>
        "group" in part
          ? [
              { script: "{" },
              ...part.group.flatMap((item, i) => [...(i ? [{ script: "," }] : []), ...written(item)]),
              { script: "}" },
            ]
          : [part],
      );
    const variants = (parts: Part[]): Text[][] =>
      parts.reduce<Text[][]>(
        (words, part) => {
          const next = "group" in part ? part.group.flatMap(variants) : [[part]];
          return words.flatMap(word => next.map(rest => [...word, ...rest]));
        },
        [[]],
      );
    const text = (parts: Text[], star = "*") =>
      parts.map(part => ("script" in part ? part.script.replaceAll("*", star) : part.value)).join("");
    const echo = async (parts: Text[]) => {
      const strings = ["echo "];
      const interpolated: string[] = [];
      for (const part of parts) {
        if ("script" in part) strings[strings.length - 1] += part.script;
        else {
          interpolated.push(part.value);
          strings.push("");
        }
      }
      const template = Object.assign(strings, { raw: strings }) as unknown as TemplateStringsArray;
      const { stdout, exitCode } = await $(template, ...interpolated)
        .cwd(String(dir))
        .quiet()
        .nothrow();
      return { words: stdout.toString().trim().split(" "), exitCode };
    };

    for (let row = 0; row < 40;) {
      const parts = word(0);
      const each = variants(parts);
      // A word with no group has one variant. Two `*` of the script side by side are a `**`.
      const adjacent = [written(parts), ...each].some(word => text(word, "\0").includes("\0\0"));
      if (each.length < 2 || each.length > 8 || adjacent) continue;
      row++;
      // A variant that fails alone is a pattern with no match. In the word it stays as written.
      const alone = await Promise.all(each.map(echo));
      const fails = alone.every(({ exitCode }) => exitCode !== 0);
      const expected = alone.map(({ words, exitCode }, i) => (exitCode === 0 ? words.sort() : [text(each[i])]));
      const { words, exitCode } = await echo(written(parts));
      let at = 0;
      const got = expected.map(({ length }) => words.slice(at, (at += length)).sort());
      expect({ word: written(parts), words: fails ? [] : [...got, words.slice(at)], exitCode }).toEqual({
        word: written(parts),
        words: fails ? [] : [...expected, []],
        exitCode: fails ? 1 : 0,
      });
    }
  });

  test("variants share a walk only when the same bytes before the last component are pattern syntax", async () => {
    using dir = tempDir("shell-brace-glob-prefix", {
      "d1/x1": "",
    });
    // Both variants are `d*/x*`. The `*` of the value matches only a `*`.
    const out = await $`echo {d*/,d${"*"}/}x*`.cwd(String(dir)).text();
    expect(list(out)).toEqual(["d1/x1", "d*/x*"]);
  });

  test.skipIf(isWindows)("a group of plain items after a * matches from the directory listing", async () => {
    using dir = tempDir("shell-brace-glob-literal", {
      "d/x/real": "",
    });
    // A link to nothing is in the listing of its directory. That is where main and bash find it.
    symlinkSync("nothing", join(String(dir), "d", "x", "broken"));
    expect(await run(String(dir), "echo d/*/{broken,real}")).toEqual({
      stdout: "d/x/broken d/x/real\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), "echo d/*/{broken,nope}")).toEqual({
      stdout: "d/x/broken d/*/nope\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A dot item shares no walk, so `broken` walks alone. The walker then asks the file system for the name,
  // which follows the link, as for `echo d/*/broken` with no brace group.
  test.todo("a link to nothing is a match of a plain item that shares no walk", async () => {
    using dir = tempDir("shell-brace-glob-literal-alone", {
      "d/x/.dot": "",
    });
    symlinkSync("nothing", join(String(dir), "d", "x", "broken"));
    expect(await run(String(dir), "echo d/*/{broken,.dot}")).toEqual({
      stdout: "d/x/broken d/x/.dot\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!isLinux)("a file name that is not UTF-8 is a match with or without a brace group", async () => {
    using dir = tempDir("shell-brace-glob-names", {
      "a.ts": "",
      "b.tsx": "",
    });
    for (const name of [Buffer.from("caf\xe9.ts", "latin1"), Buffer.from("y\xc3.tsx", "latin1")]) {
      writeFileSync(Buffer.concat([Buffer.from(String(dir) + "/"), name]), "");
    }
    const names = async (script: string) => {
      const { stdout } = await $`${{ raw: script }}`.cwd(String(dir)).quiet();
      return stdout.toString("latin1").trim().split(" ").sort();
    };
    expect(await names("echo *.{ts,tsx}")).toEqual(["a.ts", "b.tsx", "caf\xe9.ts", "y\xc3.tsx"]);
    expect(await names("echo *.ts *.tsx")).toEqual(["a.ts", "b.tsx", "caf\xe9.ts", "y\xc3.tsx"]);
  });

  // The walker and the shell log in debug builds only.
  test.skipIf(!isDebug)("a word is one task on the work pool, and a trailing group is one walk", async () => {
    using dir = tempDir("shell-brace-glob-walks", {
      "src/a.ts": "",
      "src/b.tsx": "",
      "src/sub/c.ts": "",
      "lib/d.ts": "",
    });
    const logged = async (word: string) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "exec", `echo ${word}`],
        env: { ...bunEnv, BUN_DEBUG_Glob: "1", BUN_DEBUG_SHELL: "1" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = (stdout + stderr).split("\n");
      const walk = "[glob] Iterator init pattern=";
      return {
        walks: lines.filter(line => line.startsWith(walk)).map(line => line.slice(walk.length)),
        tasks: lines.filter(line => line.endsWith("ShellTask schedule")).length,
        exitCode,
      };
    };
    expect(await logged("src/**/*.{ts,tsx}")).toEqual({ walks: ["src/**/{*.ts,*.tsx}"], tasks: 1, exitCode: 0 });
    expect(await logged("{src,lib}/*.{ts,tsx}")).toEqual({
      walks: ["src/{*.ts,*.tsx}", "lib/{*.ts,*.tsx}"],
      tasks: 1,
      exitCode: 0,
    });
    expect(await logged("{src,lib}/*.ts")).toEqual({ walks: ["src/*.ts", "lib/*.ts"], tasks: 1, exitCode: 0 });
    expect(await logged("src/*.ts")).toEqual({ walks: ["src/*.ts"], tasks: 1, exitCode: 0 });
    expect(await logged("*/{a.ts,d.ts}")).toEqual({ walks: ["*/{a.ts,d.ts}"], tasks: 1, exitCode: 0 });
  });

  test("a * of a group beside a * of the word is a **, which goes down the tree", async () => {
    // Brace expansion comes first, so `{*,b}*` has the variant `**`, as in bash with globstar.
    using dir = tempDir("shell-brace-glob-globstar", {
      "a/c": "",
      "a/x/c": "",
      "a/b1/c": "",
      "ax": "",
    });
    const middle = list((await run(String(dir), "echo a/{*,b}*/c")).stdout);
    expect({ "a/**/c": middle.slice(0, -1).sort(), "a/b*/c": middle.slice(-1) }).toEqual({
      "a/**/c": ["a/b1/c", "a/c", "a/x/c"],
      "a/b*/c": ["a/b1/c"],
    });
    const empty = list((await run(String(dir), "echo *{,x}*")).stdout);
    expect({ "**": empty.slice(0, -1).sort(), "*x*": empty.slice(-1) }).toEqual({
      "**": ["a", "a/b1", "a/b1/c", "a/c", "a/x", "a/x/c", "ax"],
      "*x*": ["ax"],
    });
  });

  test("a command gets the matches of **/*.{md,yml} and not the patterns", async () => {
    // The walk does not go into a dot directory. A command that reads patterns itself needs the word in quotes.
    using dir = tempDir("shell-brace-glob-tool", {
      ".github/ci.yml": "",
      "docs/a.md": "",
      "compose.yml": "",
    });
    expect(await run(String(dir), "echo **/*.{md,yml}")).toEqual({
      stdout: "docs/a.md compose.yml\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), 'echo "**/*.{md,yml}"')).toEqual({
      stdout: "**/*.{md,yml}\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a brace, a comma or a backslash of a value leaves the * of each variant in its place", async () => {
    using dir = tempDir("shell-brace-glob-mask", {
      "a{1": "",
      "b{2": "",
      "a}1": "",
      "b}2": "",
      "a,1": "",
      "b,2": "",
      "{a3": "",
      "{b4": "",
      "a1": "",
      ...(isWindows ? {} : { "a\\1": "", "b\\2": "" }),
    });
    const cwd = String(dir);
    expect(list(await $`echo {a,b}${"{"}*`.cwd(cwd).text())).toEqual(["a{1", "b{2"]);
    expect(list(await $`echo {a,b}${"}"}*`.cwd(cwd).text())).toEqual(["a}1", "b}2"]);
    expect(list(await $`echo {a,b}${","}*`.cwd(cwd).text())).toEqual(["a,1", "b,2"]);
    expect(list(await $`echo ${"{"}{a,b}*`.cwd(cwd).text())).toEqual(["{a3", "{b4"]);
    if (!isWindows) {
      expect((await $`echo {a,b}${"\\"}*`.cwd(cwd).text()).trim().split(" ")).toEqual(["a\\1", "b\\2"]);
    }
  });

  test("a variant that the file system cannot name is a variant with no match", async () => {
    // On Windows a name with a `:` or a control character makes the directory read fail.
    using dir = tempDir("shell-brace-glob-names", {
      "d1/f1": "",
    });
    const cwd = String(dir);
    expect(await run(cwd, "echo {plain,lint:*}")).toEqual({ stdout: "plain lint:*\n", stderr: "", exitCode: 0 });
    expect(await run(cwd, "echo {a:b,d1}/*")).toEqual({ stdout: "a:b/* d1/f1\n", stderr: "", exitCode: 0 });
    expect(await run(cwd, "echo {nul,d1}/*")).toEqual({ stdout: "nul/* d1/f1\n", stderr: "", exitCode: 0 });
    expect(list(await $`echo {a${"\t"}*,d1}`.cwd(cwd).text())).toEqual(["a\t*", "d1"]);
  });

  test("variants with an absolute path", async () => {
    using dir = tempDir("shell-brace-glob-abs", {
      "d1/f1": "",
      "d1/s1": "",
      "d2/f3": "",
      "d2/s2": "",
      "d2/g.ts": "",
      "a.ts": "",
    });
    // No `.cwd()`: each word names the fixture by its full path, with the separators of the platform.
    const root = String(dir);
    const slashed = (path: string) => path.replaceAll("\\", "/");
    const at = (...words: string[]) => words.map(word => `<root>/${word}`);
    // The path of the temporary folder can have a space, so it leaves the output before `list` splits it.
    const words = async (command: ReturnType<typeof $>) =>
      list(slashed((await command.quiet()).stdout.toString()).replaceAll(slashed(root), "<root>"));
    expect(await words($`echo ${root}/{d1,d2}/f*`)).toEqual(at("d1/f1", "d2/f3"));
    expect(await words($`echo ${root}/d1/{f*,s*}`)).toEqual(at("d1/f1", "d1/s1"));
    expect(await words($`echo ${root + sep + "d1" + sep}{f*,s*}`)).toEqual(at("d1/f1", "d1/s1"));
    // A directory that is not there, or that is a file, gives its variant no match.
    expect(await words($`echo {${root},${root + "-nope"}}/d1/s*`)).toEqual([...at("d1/s1"), "<root>-nope/d1/s*"]);
    expect(await words($`echo ${root}/{nope,d1}/f*`)).toEqual(at("nope/f*", "d1/f1"));
    expect(await words($`echo ${root}/{a.ts,d1}/f*`)).toEqual(at("a.ts/f*", "d1/f1"));
    expect(await words($`echo ${root}/{nope,d2}/*.{ts,zz}`)).toEqual(
      at("nope/*.ts", "nope/*.zz", "d2/g.ts", "d2/*.zz"),
    );
    expect(await words($`FOO=${root}/{nope,d1}/f*; echo $FOO`)).toEqual(at("nope/f*", "d1/f1"));
    const home = { ...bunEnv, HOME: root, USERPROFILE: root };
    expect(await words($`echo ~/{d1,d2}/s*`.env(home))).toEqual(at("d1/s1", "d2/s2"));
    expect(await words($`echo ~/d1/{f*,s*}`.env(home))).toEqual(at("d1/f1", "d1/s1"));
  });

  // root can read a directory of any mode
  test.skipIf(isWindows || isRoot)("a variant whose walk fails is a variant with no match", async () => {
    using dir = tempDir("shell-brace-glob-eacces", {
      "base/work/d1/f1": "",
      "base/work/.secret/s": "",
      "walk/placeholder.txt": "",
    });
    const root = String(dir);
    const noaccess = join(root, "noaccess");
    const locked = join(root, "walk", "locked");
    const base = join(root, "base");
    const secret = join(base, "work", ".secret");
    mkdirSync(noaccess);
    mkdirSync(locked);
    chmodSync(noaccess, 0o000);
    chmodSync(locked, 0o000);
    chmodSync(secret, 0o000);
    chmodSync(base, 0o111);
    // The path of the temporary folder can have a space, so it is a value in each script and `<root>` in the output.
    const result = async (command: ReturnType<typeof $>) => {
      const { stdout, stderr, exitCode } = await command.quiet().nothrow();
      const text = (output: Buffer) => output.toString().replaceAll(root, "<root>");
      return { stdout: text(stdout), stderr: text(stderr), exitCode };
    };
    try {
      // The other variant has a match, so the word does not fail, as in bash.
      const words = ["<root>/base", "<root>/noaccess", "<root>/noaccess/*", "<root>/walk"];
      const braced = await result($`echo {${root},${noaccess}}/*`);
      expect({ ...braced, stdout: braced.stdout.trim().split(" ").sort() }).toEqual({
        stdout: words,
        stderr: "",
        exitCode: 0,
      });
      const assigned = await result($`FOO={${root},${noaccess}}/*; echo $FOO`);
      expect({ ...assigned, stdout: assigned.stdout.trim().split(" ").sort() }).toEqual({
        stdout: words,
        stderr: "",
        exitCode: 0,
      });
      // One walk of the word as written never opened a dot directory or `..`, so these did not fail before.
      const cwd = join(base, "work");
      expect(await run(cwd, "echo {.secret,d1}/*")).toEqual({ stdout: ".secret/* d1/f1\n", stderr: "", exitCode: 0 });
      expect(await run(cwd, "echo {..,d1}/*")).toEqual({ stdout: "../* d1/f1\n", stderr: "", exitCode: 0 });

      // When no variant has a match, the word fails with the error of the walk.
      expect(await result($`echo {${noaccess},${noaccess}}/*`)).toEqual({
        stdout: "",
        stderr: "bun: Permission denied: <root>/noaccess/\n",
        exitCode: 1,
      });
      // `walk` has one file that matches and one directory that cannot be read. The matches that a walk
      // finds before it fails are not used, with or without a brace.
      const failed = { stdout: "", stderr: "bun: Permission denied: <root>/walk/locked\n", exitCode: 1 };
      expect(await result($`echo ${root}/walk/**/placeholder*`)).toEqual(failed);
      expect(await result($`echo ${root}/walk/**/{placeholder*,nope*}`)).toEqual(failed);
      expect(await result($`FOO=${root}/walk/**/placeholder*; echo $FOO`)).toEqual({
        stdout: "<root>/walk/**/placeholder*\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      chmodSync(base, 0o755);
      chmodSync(secret, 0o755);
      chmodSync(locked, 0o755);
      chmodSync(noaccess, 0o755);
    }
  });

  // One glob task walks each brace variant of a word. Every variant here has a walk of its own over 1000
  // directories, because a last component that starts with a dot shares no walk. The teardown of the
  // worker waits for the task, and the process cannot exit before the worker is closed.
  test.skipIf(isWindows)(
    "a terminated worker does not wait for the brace variants that are not walked yet",
    async () => {
      const groups = isDebug || isASAN ? 12 : 16;
      using dir = tempDir("shell-brace-glob-terminate", {
        "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const { promise, resolve, reject } = Promise.withResolvers();
        worker.onmessage = resolve;
        worker.onerror = e => reject(e.error ?? e.message);
        await promise;
        const closed = new Promise(resolve => worker.addEventListener("close", resolve));
        worker.terminate();
        await closed;
        console.log("closed");
      `,
        "worker.ts": `
        import { mkdirSync } from "node:fs";
        for (let i = 0; i < 1000; i++) mkdirSync("tree/d" + i, { recursive: true });
        const word = "tree" + Buffer.alloc(${groups} * 3, "{,}").toString() + "/**/.nomatch*";
        // run() starts the interpreter now. The promise alone would start it at the first await.
        Bun.$\`echo \${{ raw: word }}\`.nothrow().quiet().run().catch(() => {});
        postMessage("ok");
      `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "closed\n", stderr: "", exitCode: 0 });
    },
  );

  test("bun exec and a package.json script glob each variant", async () => {
    // Both run on the mini event loop, not on the loop of a JavaScript VM.
    using dir = tempDir("shell-brace-glob-cli", {
      "package.json": JSON.stringify({ scripts: { words: "echo {d1,nope,d2}/*" } }),
      "d1/f1": "",
      "d2/f3": "",
    });
    for (const args of [
      ["exec", "echo {d1,nope,d2}/*"],
      ["run", "--shell=bun", "words"],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ args, stdout: list(stdout), stderr, exitCode }).toEqual({
        args,
        stdout: ["d1/f1", "nope/*", "d2/f3"],
        stderr: args[0] === "run" ? "$ echo {d1,nope,d2}/*\n" : "",
        exitCode: 0,
      });
    }
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
