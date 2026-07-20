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
        `const pattern = Buffer.alloc(50000, "{").toString() + Buffer.alloc(50000, "}").toString();
try {
  Bun.$.braces(pattern);
  console.log("expanded");
} catch (e) {
  console.log("rejected: " + e.message);
}
// A reasonable pattern still expands normally.
console.log(JSON.stringify(Bun.$.braces("echo {a,b}")));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "rejected: Too many braces in brace expansion
      ["echo a","echo b"]"
    `);
    expect(exitCode).toBe(0);
  });
});

// An unquoted empty brace alternative must not become an argv word (bash null
// argument removal). Bun kept non-leading empties and dropped leading ones only
// by accident, so `printf '[%s]' {a,}` emitted `[a][]` instead of `[a]`.
describe("brace expansion drops empty argv words", () => {
  // Observe argv directly via a spawned process so the assertion is on argc,
  // not on `echo` rendering.
  const script = "console.log(JSON.stringify(process.argv.slice(1)))";
  const argv = async (pattern: string): Promise<string[]> => {
    const out = await $`${bunExe()} -e ${script} -- ${{ raw: pattern }}`.env(bunEnv).nothrow().text();
    return JSON.parse(out.trim());
  };

  const cases: Array<[string, string[]]> = [
    // trailing / middle / leading unquoted empties all drop
    ["{a,}", ["a"]],
    ["{,a}", ["a"]],
    ["{a,,b}", ["a", "b"]],
    ["{a,,}", ["a"]],
    ["{,a,}", ["a"]],
    // all-empty expands to zero argv words
    ["{,}", []],
    ["{,,}", []],
    // affixed: the variant is non-empty so nothing is dropped
    ["x{,}y", ["xy", "xy"]],
    ["x{a,}", ["xa", "x"]],
    ["{a,}x", ["ax", "x"]],
    // products: only the one fully-empty variant drops
    ["{a,}{b,}", ["ab", "a", "b"]],
    ["{,a}{,b}", ["b", "a", "ab"]],
    ["{,}{,}", []],
    // nested
    ["{a,{b,}}", ["a", "b"]],
    ["{{a,},b}", ["a", "b"]],
    // a quoted empty in the compound word keeps empty variants as real words
    ['""{a,}', ["a", ""]],
    ['""{,a}', ["", "a"]],
    ['{a,}""', ["a", ""]],
    ['{"",a}', ["", "a"]],
    ['{a,""}', ["a", ""]],
    // a quoted cmd-subst producing no output is a quoted empty
    ['"$(true)"', [""]],
    ['"$(true)"{a,}', ["a", ""]],
    ['"$(true)"{,a}', ["", "a"]],
    // non-empty cases stay unchanged
    ["{a,b}", ["a", "b"]],
  ];

  for (const [pattern, expected] of cases) {
    test.concurrent(`${pattern} -> ${JSON.stringify(expected)}`, async () => {
      expect(await argv(pattern)).toEqual(expected);
    });
  }

  // The phantom empty word was a real operand, not just rendering: without the
  // fix `echo {a,}` prints "a \n" (trailing space) instead of "a\n".
  test("echo {a,} has no trailing space", async () => {
    const out = await $`echo {a,}`.nothrow().text();
    expect(out).toBe("a\n");
  });
});

// A quoted empty word as argv[0] is a real (empty) command name and fails,
// rather than silently exiting 0 or shifting to the next arg. An unquoted
// `$(...)` producing no output leaves argv empty and keeps the POSIX rule.
describe("empty argv[0] is command-not-found", () => {
  const run = async (s: string) => {
    const r = await $`${{ raw: s }}`.nothrow().quiet();
    return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode };
  };

  for (const s of ['""', '"$(true)"', '"" echo hi', '"$(true)" echo hi']) {
    test(s, async () => {
      expect(await run(s)).toEqual({
        stdout: "",
        stderr: "bun: command not found: \n",
        exitCode: 1,
      });
    });
  }

  test("$(true) alone exits 0", async () => {
    expect(await run("$(true)")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
  test("$(false) alone exits 1", async () => {
    expect(await run("$(false)")).toEqual({ stdout: "", stderr: "", exitCode: 1 });
  });
  test("$(true) echo hi runs echo", async () => {
    expect(await run("$(true) echo hi")).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
  });
});
