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

// Brace expansion precedes pathname expansion, and each resulting word is
// globbed on its own. `{d1,d2}/*` used to emit the literal `d1/*` and `d2/*`
// words *in addition to* their matches, because the brace-expand state pushed
// every variant to argv and then globbed the un-expanded pattern.
describe("brace + glob composition", () => {
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
    const { stderr, exitCode } = await $`echo {d1,nope}/*`.cwd(String(dir)).quiet().nothrow();
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
