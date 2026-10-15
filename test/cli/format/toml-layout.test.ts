// Tests for Bun's own TOML layout, which applies when there's no oxfmt config. `toml.test.ts` covers TOML under an oxfmt config.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function run(cwd: string, args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "fmt", "--log-level=warn", ...args],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const cases: [name: string, input: string, output: string][] = [
  [
    "keeps a hugged table with a trailing comment as it is",
    `[lint.rules]
"prefer-const" = ["warn", {
  destructuring = "any", # "any" or "all"
  ignoreReadBeforeAssign = false,
}]
`,
    `[lint.rules]
"prefer-const" = ["warn", {
  destructuring = "any", # "any" or "all"
  ignoreReadBeforeAssign = false,
}]
`,
  ],
  [
    "puts one entry per line when an inline table has a comment",
    `a = ["warn",{destructuring="any", # c
b=false}]
`,
    `a = ["warn", {
  destructuring = "any", # c
  b = false,
}]
`,
  ],
  [
    "keeps a comment after the opening brace on that line",
    `a = { # first
  b = 1,
}
`,
    `a = { # first
  b = 1,
}
`,
  ],
  [
    "keeps a comment before the closing brace",
    `a = {
  b = 1,
  # last
}
`,
    `a = {
  b = 1,
  # last
}
`,
  ],
  [
    "keeps a comment after the last entry and its trailing comma",
    `a = {
  b = 1, # c
}
`,
    `a = {
  b = 1, # c
}
`,
  ],
  [
    "adds the trailing comma before a comment after the last entry",
    `a = {
  b = 1 # c
}
`,
    `a = {
  b = 1, # c
}
`,
  ],
  [
    "keeps a comment on its own line between entries",
    `a = {
  b = 1,
  # about c
  c = 2,
}
`,
    `a = {
  b = 1,
  # about c
  c = 2,
}
`,
  ],
  [
    "keeps a table that only holds a comment",
    `a = {
  # nothing
}
b = { # nothing
}
c = [{
  # nothing
}]
`,
    `a = {
  # nothing
}
b = { # nothing
}
c = [{
  # nothing
}]
`,
  ],
  [
    "collapses an empty table with line breaks",
    `a = {
}
b = {

}
`,
    `a = {}
b = {}
`,
  ],
  [
    "handles tables in arrays in tables",
    `a = {
  b = [
    { c = 1 }, # one
    {
      d = [1, 2], # two
      e = { f = 1, # three
      },
    },
  ],
}
`,
    `a = {
  b = [
    { c = 1 }, # one
    {
      d = [1, 2], # two
      e = {
        f = 1, # three
      },
    },
  ],
}
`,
  ],
  [
    "breaks an array that has its own comment next to a multi-line table",
    `a = [
  "x", # about x
  {
    b = 1, # about b
  },
]
c = ["x", {
  b = 1,
}, # after the table
]
d = [ # first
  {
    b = 1,
  }
]
`,
    `a = [
  "x", # about x
  {
    b = 1, # about b
  },
]
c = [
  "x",
  {
    b = 1,
  }, # after the table
]
d = [ # first
  {
    b = 1,
  },
]
`,
  ],
  [
    "breaks an array whose multi-line table isn't last",
    `a = [{
  b = 1,
}, "x"]
`,
    `a = [
  {
    b = 1,
  },
  "x",
]
`,
  ],
  [
    "breaks an array with two multi-line tables",
    `a = [{
  b = 1,
}, {
  c = 2,
}]
`,
    `a = [
  {
    b = 1,
  },
  {
    c = 2,
  },
]
`,
  ],
  [
    "joins a table whose first entry is on the brace's line, if it fits",
    `a = { b = 1,
  c = 2 }
`,
    `a = { b = 1, c = 2 }
`,
  ],
  [
    "puts one entry per line when a table with line breaks doesn't fit",
    `a = { bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = 1,
  ccccccccccccccccccccccccccccccccccccccccccccccccccc = 2 }
`,
    `a = {
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = 1,
  ccccccccccccccccccccccccccccccccccccccccccccccccccc = 2,
}
`,
  ],
  [
    "never adds line breaks to a one-line table, because TOML 1.0 rejects them",
    `a = { bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = 1, ccccccccccccccccccccccccccccccccccccccccccccccccccc = 2 }
`,
    `a = { bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = 1, ccccccccccccccccccccccccccccccccccccccccccccccccccc = 2 }
`,
  ],
  [
    "breaks only the array in the last entry of a one-line table that's too long",
    `serde = { version = "1.0.200", default-features = false, features = ["derive", "rc", "alloc", "std"] }
`,
    `serde = { version = "1.0.200", default-features = false, features = [
  "derive",
  "rc",
  "alloc",
  "std",
] }
`,
  ],
  [
    "handles CRLF",
    `a = ["warn", {\r
  b = "any", # c\r
  d = false,\r
}]\r
`,
    `a = ["warn", {
  b = "any", # c
  d = false,
}]
`,
  ],
  [
    "removes empty lines next to the braces and keeps at most two between entries",
    `a = {

  b = 1,



  c = 2,

}
`,
    `a = {
  b = 1,


  c = 2,
}
`,
  ],
  [
    "doesn't take a # in a key or a string for a comment",
    `a = {
  "b#c".d = "# not a comment", # comment
  e = '#',
}
`,
    `a = {
  "b#c".d = "# not a comment", # comment
  e = '#',
}
`,
  ],
  [
    "keeps a multi-line string in a table as it is",
    `a = {
  b = """
x # y
""",
  c = 1,
}
`,
    `a = {
  b = """
x # y
""",
  c = 1,
}
`,
  ],
  [
    "doesn't hug when the first line would be too long",
    `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" = ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
  c = 1,
}]
`,
    `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" = [
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  {
    c = 1,
  },
]
`,
  ],
  [
    "hugs at every level",
    `a = ["x", {
  b = ["y", {
    c = 1,
  }],
}]
`,
    `a = ["x", {
  b = ["y", {
    c = 1,
  }],
}]
`,
  ],
  [
    "keeps a comment after a hugged array",
    `a = ["x", {
  b = 1,
}] # after
`,
    `a = ["x", {
  b = 1,
}] # after
`,
  ],
  [
    "works under an array-of-tables header",
    `[[x]]
a = { # c
 b = 1 }
`,
    `[[x]]
a = { # c
  b = 1,
}
`,
  ],
  [
    "removes empty lines next to an array's brackets",
    `a = [

  1, # c



  2,

]
`,
    `a = [
  1, # c


  2,
]
`,
  ],
  [
    "keeps an array on the line when more entries follow it in a one-line table",
    `a = { features = ["derive", "rc", "alloc", "std", "unstable"], version = "1.0.200", default-features = false }
`,
    `a = { features = ["derive", "rc", "alloc", "std", "unstable"], version = "1.0.200", default-features = false }
`,
  ],
  [
    "doesn't break arrays in a one-line table that's too long before they start",
    `"react/sort-comp" = ["error", { order = ["lifecycle", "everything-else", "handlers", "rendering"], groups = { handlers = ["/^handle.+$/"], rendering = ["/^render.+$/", "render"] } }]
`,
    `"react/sort-comp" = [
  "error",
  { order = ["lifecycle", "everything-else", "handlers", "rendering"], groups = { handlers = ["/^handle.+$/"], rendering = ["/^render.+$/", "render"] } },
]
`,
  ],
  [
    "lets each array decide whether it fits",
    `a = {
  short = [1, 2],
  long = ["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccc", "dddd"],
  empty = [],
}
`,
    `a = {
  short = [1, 2],
  long = [
    "aaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccc",
    "dddd",
  ],
  empty = [],
}
`,
  ],
];

describe("TOML layout", () => {
  // All cases share one directory: format, check, format again.
  const name = (index: number) => `${index}.toml`;
  const done = (async () => {
    using dir = tempDir("bun-format-toml", Object.fromEntries(cases.map((it, index) => [name(index), it[1]])));
    const read = () => cases.map((_, index) => readFileSync(join(String(dir), name(index)), "utf8"));
    const first = await run(String(dir), ["."]);
    const files = read();
    const check = await run(String(dir), ["--check", "."]);
    const second = await run(String(dir), ["."]);
    return { first, files, check, second, again: read() };
  })();

  test("formats every case without errors, and --check passes afterwards", async () => {
    const { first, check, second } = await done;
    expect([first.stderr, check.stderr, second.stderr]).toEqual(["", "", ""]);
    expect([first.exitCode, check.exitCode, second.exitCode]).toEqual([0, 0, 0]);
  });

  test.each(cases.map((it, index) => [it[0], index] as const))("%s", async (_, index) => {
    const { files, again } = await done;
    const [, input, output] = cases[index];
    expect(files[index]).toBe(output);
    // A second run changes nothing.
    expect(again[index]).toBe(output);
    expect(Bun.TOML.parse(output)).toEqual(Bun.TOML.parse(input));
  });

  test("respects trailingComma, useTabs and endOfLine in a multi-line table", async () => {
    using dir = tempDir("bun-format-toml", {
      "bunfig.toml": `[fmt]\ntrailingComma = "none"\nuseTabs = true\nendOfLine = "crlf"\n`,
      "a.toml": `a = ["x", {\n  b = 1, # c\n  d = 2,\n}]\n`,
    });
    const result = await run(String(dir), ["a.toml"]);
    expect(result.stderr).toBe("");
    expect(readFileSync(join(String(dir), "a.toml"), "utf8")).toBe(`a = ["x", {\r\n\tb = 1, # c\r\n\td = 2\r\n}]\r\n`);
  });
});

describe.concurrent("a table with a comment", () => {
  // oxfmt 0.72 joins these lines, which comments out the second entry: `{ b = 1 # c, d = 2 },`.
  const commented = `a = ["x", {\n  b = 1, # c\n  d = 2,\n}]\n`;
  const expanded = `a = [\n  "x",\n  {\n    b = 1, # c\n    d = 2,\n  },\n]\n`;

  test("with an oxfmt config it has one entry per line", async () => {
    using dir = tempDir("bun-format-toml", { ".oxfmtrc.json": "{}\n", "a.toml": commented, "b.toml": expanded });
    const result = await run(String(dir), ["."]);
    expect(result.stderr).toBe("");
    expect(readFileSync(join(String(dir), "a.toml"), "utf8")).toBe(expanded);
    expect(readFileSync(join(String(dir), "b.toml"), "utf8")).toBe(expanded);
    expect(result.exitCode).toBe(0);
  });

  // The table, what Bun makes of it, and what oxfmt 0.72 makes of it.
  test.each([
    ["a = { # c\n b = 1 }\n", "a = { # c\n  b = 1,\n}\n", "a = { # c b = 1 }\n"],
    ["a = { b = 1 # c\n, d = 2 }\n", "a = {\n  b = 1, # c\n  d = 2,\n}\n", "a = { b = 1 # c, d = 2 }\n"],
    ["a = { b = 1,\n # c\n d = 2 }\n", "a = {\n  b = 1,\n  # c\n  d = 2,\n}\n", "a = { b = 1 # c, d = 2 }\n"],
    ["a = { b = 1, d = 2 # c\n }\n", "a = {\n  b = 1,\n  d = 2, # c\n}\n", "a = { b = 1, d = 2 # c }\n"],
  ])("wherever the comment is: %j", async (before, after, ofOxfmt) => {
    expect(after).not.toBe(ofOxfmt);
    using dir = tempDir("bun-format-toml", { ".oxfmtrc.json": "{}\n", "a.toml": before, "b.toml": after });
    const checked = await run(String(dir), ["--debug-check", "."]);
    expect(checked.stderr).toBe("");
    expect(checked.exitCode).toBe(0);
    const result = await run(String(dir), ["."]);
    expect(result.stderr).toBe("");
    expect(readFileSync(join(String(dir), "a.toml"), "utf8")).toBe(after);
    expect(readFileSync(join(String(dir), "b.toml"), "utf8")).toBe(after);
    expect(result.exitCode).toBe(0);
  });

  test("--debug-check has nothing to say about it", async () => {
    using dir = tempDir("bun-format-toml", { ".oxfmtrc.json": "{}\n", "a.toml": commented });
    const result = await run(String(dir), ["--debug-check", "."]);
    expect(result.stderr).toBe("");
    expect(readFileSync(join(String(dir), "a.toml"), "utf8")).toBe(commented);
    expect(result.exitCode).toBe(0);
  });

  test("without an oxfmt config the same file is already formatted", async () => {
    using dir = tempDir("bun-format-toml", { "a.toml": commented });
    const result = await run(String(dir), ["--check", "."]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
