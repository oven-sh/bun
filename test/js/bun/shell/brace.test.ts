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

// An unquoted `$(...)` whose output contains whitespace is IFS-split. Each
// field the split completes is flushed out of `current_out` mid assembly, and
// only the final field was ever brace-expanded, so a flushed field silently
// lost the `{...}` group it carried. When the word's *only* group went with it,
// `do_brace_expand` tokenized the remainder to zero groups and `braces::expand`
// indexed an empty output slice:
//   panic: index out of bounds: the len is 0 but the index is 0
// Every field is now brace-expanded as it is flushed, so the word expands the
// same way whichever side of the split its group lands on.
describe.concurrent("brace expansion after an IFS-split command substitution", () => {
  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Run in a subprocess so an unfixed build aborts the child, not the runner.
  test("group entirely in the flushed field", async () => {
    expect(await run("echo {a,b}$(echo x y)")).toEqual({
      stdout: "ax bx y\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The group straddles the split, so neither field holds a complete one and
  // both are emitted literally.
  test("split lands inside the group, before the comma", async () => {
    expect(await run("echo {$(echo a b),c}")).toEqual({
      stdout: "{a b,c}\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("split lands inside the group, after the comma", async () => {
    expect(await run("echo {a,$(echo x y)}")).toEqual({
      stdout: "{a,x y}\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Already worked: the group rides on the final field.
  test("group entirely after the split still expands", async () => {
    expect(await run("echo $(echo x y){a,b}")).toEqual({
      stdout: "x ya yb\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Same root cause, without the panic: the flushed field used to leak its
  // braces into argv literally (`{a,b}x yc yd`).
  test("a group on each side of the split", async () => {
    expect(await run("echo {a,b}$(echo x y){c,d}")).toEqual({
      stdout: "ax bx yc yd\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Each variant is its own argv word, not one word containing a space.
  test("the expanded fields are separate argv words", async () => {
    expect(await run(`printf "[%s]" {a,b}$(echo x y); echo`)).toEqual({
      stdout: "[ax][bx][y]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A quoted substitution is not field-split, so the whole word stays intact.
  test("a quoted substitution is not split", async () => {
    expect(await run(`echo {a,b}"$(echo x y)"`)).toEqual({
      stdout: "ax y bx y\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// `braces::expand` round-trips its input through the brace lexer, which
// consumes backslash escapes. `calculate_expanded_amount` returning 0 is what
// lets `$.braces()` hand back the raw word instead, so a word with no brace
// group must never be routed through `expand`.
test("$.braces preserves escapes in a word with no brace group", () => {
  expect(Bun.$.braces("a\\{b")).toEqual(["a\\{b"]);
  expect(Bun.$.braces("a\\,b")).toEqual(["a\\,b"]);
  // With a group present the lexer does consume them, which is why the
  // group-less word cannot take the same path.
  expect(Bun.$.braces("a\\{b{c,d}")).toEqual(["a{bc", "a{bd"]);
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
