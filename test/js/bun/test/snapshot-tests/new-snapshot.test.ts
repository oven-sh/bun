import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

test("it will create a snapshot file and directory if they don't exist", () => {
  const tempDir = tmpdirSync();
  fs.rmSync(tempDir, { force: true, recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  fs.copyFileSync(import.meta.dir + "/new-snapshot.ts", tempDir + "/new-snapshot.test.ts");
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);

  // remove the snapshot file but leave the directory and test again.
  fs.rmSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap", { force: true });
  const { exitCode: exitCode2 } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode2).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);
});

test("--update-snapshots keeps the old file until the new contents are written", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const before = header + '\nexports[`one 1`] = `"old"`;\n\nexports[`removed 1`] = `"old"`;\n';
  using dir = tempDir("snapshot-update-bail", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("one", () => { expect("new").toMatchSnapshot(); });
      test("fails", () => { expect(process.env.FAIL).toBeUndefined(); });
    `,
    "__snapshots__/a.test.ts.snap": before,
  });
  async function update(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", "--bail"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exitCode: await proc.exited, snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8") };
  }
  expect(await update({ FAIL: "1" })).toEqual({ exitCode: 1, snap: before });
  expect(await update({})).toEqual({ exitCode: 0, snap: header + '\nexports[`one 1`] = `"new"`;\n' });
});

// bun test reads a .snap file as data, so a macro in it must not run. Such a file is one that does not parse.
test.concurrent.each([
  ["the call of a named import", 'import { fn } from "../macro.ts" with { type: "macro" };', "fn()"],
  ["the call of a member of a namespace import", 'import * as m from "../macro.ts" with { type: "macro" };', "m.fn()"],
  ["the tag of a template", 'import { fn } from "macro:../macro.ts";', "fn`x`"],
])(
  "a .snap file with a macro as %s fails the test, and --update-snapshots replaces it",
  async (_, importLine, call) => {
    const withMacro = `${importLine}\nexports[\`a 1\`] = ${call};\n`;
    using dir = tempDir("snapshot-macro", {
      "a.test.ts": `
      import { test, expect } from "bun:test";
      test("a", () => { expect("hello").toMatchSnapshot(); });
    `,
      "macro.ts": `
      import { writeFileSync } from "fs";
      import { join } from "path";
      export function fn() {
        writeFileSync(join(import.meta.dir, "ran"), "");
        return '"hello"';
      }
    `,
      "__snapshots__/a.test.ts.snap": withMacro,
    });
    async function run(...args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args],
        cwd: String(dir),
        env: { ...bunEnv, CI: "false" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return {
        stderr,
        ranTheMacro: fs.existsSync(join(String(dir), "ran")),
        snapshot: fs.readFileSync(join(String(dir), "__snapshots__", "a.test.ts.snap"), "utf8"),
        exitCode,
        signalCode: proc.signalCode,
      };
    }

    expect(await run()).toEqual({
      stderr: expect.stringContaining("error: Failed to parse snapshot file for: "),
      ranTheMacro: false,
      snapshot: withMacro,
      exitCode: 1,
      signalCode: null,
    });
    expect(await run("--update-snapshots")).toEqual({
      stderr: expect.stringContaining("snapshots: +1 added"),
      ranTheMacro: false,
      snapshot: '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`a 1`] = `"hello"`;\n',
      exitCode: 0,
      signalCode: null,
    });
  },
);

// What a person wrote into a file in Bun's format that has no entry yet.
const textWithNoEntry: [string, string][] = [
  ["the first line alone", "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n"],
  [
    "the first line and a note",
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n// a note that a person wrote\n",
  ],
  ["a note and no first line", "// a note that a person wrote\n"],
  [
    "a note of three lines",
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n// line one\n// line two\n// line three\n",
  ],
];

describe.concurrent("--update-snapshots", () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const snap = (entries: Record<string, string>) =>
    header +
    Object.entries(entries)
      .map(([key, value]) => `\nexports[\`${key}\`] = \`${value}\`;\n`)
      .join("");

  /** Runs `bun test --update-snapshots` on the files. Returns every `.snap` file as it is after the run. */
  async function update(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("update-snapshots", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", ...args],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const snapshots: Record<string, string> = {};
    for (const name of fs.readdirSync(join(String(dir), "__snapshots__")).sort()) {
      // Not `Bun.file().text()`: that drops a BOM.
      snapshots[name] = fs.readFileSync(join(String(dir), "__snapshots__", name), "utf8");
    }
    return { snapshots, stderr, exitCode };
  }

  /** The same for one test file, `a.test.ts`, and the `.snap` file it has before the run. Returns the `.snap` file. */
  async function updateOne(tests: string, snapshot: string | undefined, ...args: string[]) {
    const { snapshots, ...rest } = await update(
      {
        "a.test.ts": `import { afterAll, beforeAll, describe, expect, test } from "bun:test";\n${tests}`,
        ...(snapshot !== undefined && { "__snapshots__/a.test.ts.snap": snapshot }),
      },
      ...args,
    );
    return { snapshot: snapshots["a.test.ts.snap"], ...rest };
  }

  // https://github.com/oven-sh/bun/issues/42969
  test("keeps the order of the file, replaces a value in its place, puts a new entry at the end", async () => {
    const object = (key: string, value: number) => `\n{\n  "${key}": ${value},\n}\n`;
    const result = await updateOne(
      `describe("suite", () => {
         test("zeta", () => { expect({ z: 1 }).toMatchSnapshot(); });
         test("mid", () => { expect({ m: 1 }).toMatchSnapshot(); });
         test("alpha", () => { expect({ a: 2 }).toMatchSnapshot(); });
       });`,
      snap({ "suite alpha 1": object("a", 1), "suite zeta 1": object("z", 1) }),
    );
    expect(result).toMatchObject({
      snapshot: snap({
        "suite alpha 1": object("a", 2),
        "suite zeta 1": object("z", 1),
        "suite mid 1": object("m", 1),
      }),
      stderr: expect.stringContaining("snapshots: 1 passed, 2 added"),
      exitCode: 0,
    });
  });

  test("keeps the entries of the tests that -t filters out", async () => {
    const result = await updateOne(
      `test("alpha", () => { expect("a").toMatchSnapshot(); });
       test("beta", () => { expect("new").toMatchSnapshot(); });
       describe("grp", () => { test("gamma", () => { expect("g").toMatchSnapshot(); }); });`,
      snap({ "alpha 1": `"a"`, "beta 1": `"old"`, "grp gamma 1": `"g"` }),
      "-t",
      "beta",
    );
    expect(result).toMatchObject({
      snapshot: snap({ "alpha 1": `"a"`, "beta 1": `"new"`, "grp gamma 1": `"g"` }),
      exitCode: 0,
    });
  });

  test("keeps the entries of a test that fails before it takes its snapshot", async () => {
    const result = await updateOne(
      `test("ok", () => { expect("ok").toMatchSnapshot(); });
       test("throws", () => { throw new Error("boom"); expect("t").toMatchSnapshot(); });`,
      snap({ "ok 1": `"ok"`, "throws 1": `"t"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "ok 1": `"ok"`, "throws 1": `"t"` }),
      exitCode: 1,
    });
  });

  test("keeps the entries of the tests that test.only leaves out", async () => {
    const result = await updateOne(
      `test("first", () => { expect("1").toMatchSnapshot(); });
       test.only("second", () => { expect("new").toMatchSnapshot(); });`,
      snap({ "first 1": `"1"`, "second 1": `"old"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "first 1": `"1"`, "second 1": `"new"` }),
      exitCode: 0,
    });
  });

  test("keeps the entries of skip, todo and failing tests, with a hint too", async () => {
    const entries = {
      "skipped: a: hint 1": `"s"`,
      "todo 1": `"t"`,
      "suite inner 1": `"i"`,
      "wip 1": `"w"`,
      "ran 1": `"r"`,
    };
    const result = await updateOne(
      `test.skip("skipped", () => { expect("s").toMatchSnapshot("a: hint"); });
       test.todo("todo", () => { expect("t").toMatchSnapshot(); });
       describe.skip("suite", () => { test("inner", () => { expect("i").toMatchSnapshot(); }); });
       test.failing("wip", () => { throw new Error("boom"); expect("w").toMatchSnapshot(); });
       test("ran", () => { expect("r").toMatchSnapshot(); });`,
      snap(entries),
    );
    expect(result).toMatchObject({ snapshot: snap(entries), exitCode: 0 });
  });

  test("removes the entries that no test takes", async () => {
    const result = await updateOne(
      `test("renamed", () => { expect("r").toMatchSnapshot(); });
       test("once", () => { expect("1").toMatchSnapshot(); });`,
      snap({ "old name 1": `"r"`, "once 1": `"1"`, "once 2": `"2"`, "once more 1": `"x"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "once 1": `"1"`, "renamed 1": `"r"` }),
      exitCode: 0,
    });
  });

  // What a person or another tool did to the layout of a file in Bun's format.
  const layouts: [string, string][] = [
    ["a first line of nobody", '// something else\n\nexports[`a 1`] = `"old"`;\n\nexports[`b 1`] = `"b"`;\n'],
    ["a BOM", "\uFEFF" + header + '\nexports[`a 1`] = `"old"`;\n\nexports[`b 1`] = `"b"`;\n'],
    ["no line break at the end", header + '\nexports[`a 1`] = `"old"`;\n\nexports[`b 1`] = `"b"`'],
    [
      "all entries on one line, quoted with ' and \"",
      header + "exports['a 1'] = '\"old\"'; exports[\"b 1\"] = '\"b\"'\n",
    ],
    [
      "comments",
      header + '// about a\nexports[`a 1`] = `"old"`; // more about a\n\n/* about b */ exports[`b 1`] = `"b"`;\n',
    ],
    [
      "no first line and a key that is there twice",
      'exports[`a 1`] = `"first"`;\nexports[`a 1`] = `"old"`;\nexports[`b 1`] = `"b"`;\n',
    ],
    ["CRLF line ends", (header + '\nexports[`a 1`] = `"old"`;\n\nexports[`b 1`] = `"b"`;\n').replaceAll("\n", "\r\n")],
  ];
  const testsOfLayouts = (a: string, more = "") =>
    `test("a", () => { expect("${a}").toMatchSnapshot(); });
     test("b", () => { expect("b").toMatchSnapshot(); });
     ${more}`;

  test.each(layouts)("leaves a file with %s as it is when no entry changes", async (_, before) => {
    const result = await updateOne(testsOfLayouts("old"), before);
    expect(result).toMatchObject({ snapshot: before, exitCode: 0 });
  });

  test.each(layouts)("puts a new entry behind the text of a file with %s", async (_, before) => {
    const more = `test("c", () => { expect("c").toMatchSnapshot(); });`;
    const result = await updateOne(testsOfLayouts("old", more), before);
    expect(result).toMatchObject({ snapshot: before + '\nexports[`c 1`] = `"c"`;\n', exitCode: 0 });
  });

  test.each(textWithNoEntry)("puts the first entry behind the text of a file with %s", async (_, before) => {
    const result = await updateOne(`test("a", () => { expect("a").toMatchSnapshot(); });`, before);
    expect(result).toMatchObject({ snapshot: before + '\nexports[`a 1`] = `"a"`;\n', exitCode: 0 });
  });

  // A changed or removed entry prints the file from its entries, in the order of the file. Comments and the layout go.
  test.each(layouts)("prints a file with %s again when an entry changes", async (_, before) => {
    const result = await updateOne(testsOfLayouts("new"), before);
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"new"`, "b 1": `"b"` }), exitCode: 0 });
  });

  test("escapes a replaced value", async () => {
    const value = "tick ` dollar ${x} back \\ slash";
    const result = await updateOne(
      `test("a", () => { expect(${JSON.stringify(value)}).toMatchSnapshot(); });
       test("b", () => { expect("b").toMatchSnapshot(); });`,
      snap({ "a 1": `"old"`, "b 1": `"b"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "a 1": '"tick \\` dollar \\${x} back \\\\ slash"', "b 1": `"b"` }),
      exitCode: 0,
    });
  });

  test.each([
    ["", []],
    [", also when the file runs twice", ["./a.test.ts", "./a.test.ts"]],
  ])("removes nothing when a describe callback throws%s", async (_, args) => {
    const result = await updateOne(
      `test("top", () => { expect("new").toMatchSnapshot(); });
       describe("suite", () => {
         throw new Error("boom");
         test("late", () => { expect("l").toMatchSnapshot(); });
       });`,
      snap({ "top 1": `"old"`, "suite late 1": `"l"` }),
      ...args,
    );
    expect(result).toMatchObject({
      snapshot: snap({ "top 1": `"new"`, "suite late 1": `"l"` }),
      exitCode: 1,
    });
  });

  test("keeps the entries of the tests whose beforeAll fails", async () => {
    const result = await updateOne(
      `test("top", () => { expect("new").toMatchSnapshot(); });
       describe("suite", () => {
         beforeAll(() => { throw new Error("boom"); });
         test("inner", () => { expect("i").toMatchSnapshot(); });
       });`,
      snap({ "top 1": `"old"`, "suite inner 1": `"i"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "top 1": `"new"`, "suite inner 1": `"i"` }),
      exitCode: 1,
    });
  });

  test("keeps the entries of a beforeAll or afterAll hook that did not run to a pass", async () => {
    const entries = { "top 1": `"t"`, "not run (unnamed) 1": `"b"`, "throws (unnamed) 1": `"a"` };
    const result = await updateOne(
      `test("top", () => { expect("t").toMatchSnapshot(); });
       describe("not run", () => {
         beforeAll(() => { expect("b").toMatchSnapshot(); });
         test("left out", () => {});
       });
       describe("throws", () => {
         afterAll(() => { throw new Error("boom"); expect("a").toMatchSnapshot(); });
         test("top too", () => {});
       });`,
      snap(entries),
      "-t",
      "top",
    );
    expect(result).toMatchObject({ snapshot: snap(entries), exitCode: 1 });
  });

  test("keeps the entry of an afterAll hook that throws when every test passes", async () => {
    const result = await updateOne(
      `test("top", () => { expect("t").toMatchSnapshot(); });
       describe("throws", () => {
         afterAll(() => { throw new Error("boom"); expect("a").toMatchSnapshot(); });
         test("passes", () => {});
       });`,
      snap({ "top 1": `"t"`, "throws (unnamed) 1": `"a"`, "gone 1": `"g"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "top 1": `"t"`, "throws (unnamed) 1": `"a"` }),
      exitCode: 1,
    });
  });

  test("keeps the entries of a skipped test when the test file runs twice", async () => {
    const entries = { "skipped 1": `"s"`, "ran 1": `"r"` };
    const result = await updateOne(
      `test("ran", () => { expect("r").toMatchSnapshot(); });
       test.skip("skipped", () => { expect("s").toMatchSnapshot(); });`,
      snap(entries),
      "./a.test.ts",
      "./a.test.ts",
    );
    expect(result).toMatchObject({ snapshot: snap(entries), exitCode: 0 });
  });

  test("--rerun-each keeps the entries of a skipped test that an imported module has", async () => {
    const entries = snap({ "shared 1": `"s"`, "ran 1": `"r"` });
    const result = await update(
      {
        "shared.ts": `import { expect, test } from "bun:test";
          test.skip("shared", () => { expect("s").toMatchSnapshot(); });`,
        "a.test.ts": `import "./shared";
          import { expect, test } from "bun:test";
          test("ran", () => { expect("r").toMatchSnapshot(); });`,
        "__snapshots__/a.test.ts.snap": entries,
      },
      "--rerun-each=2",
    );
    expect(result).toMatchObject({ snapshots: { "a.test.ts.snap": entries }, exitCode: 0 });
  });

  test("writes a new file in the order in which the tests run", async () => {
    const result = await updateOne(
      `test("zeta", () => { expect("z").toMatchSnapshot(); });
       test("alpha", () => { expect("a").toMatchSnapshot(); });`,
      undefined,
    );
    expect(result).toMatchObject({ snapshot: snap({ "zeta 1": `"z"`, "alpha 1": `"a"` }), exitCode: 0 });
  });

  test("replaces a file that does not parse when every test ran to the end", async () => {
    const result = await updateOne(
      `test("a", () => { expect("a").toMatchSnapshot(); });
       test("b", () => { expect("new").toMatchSnapshot(); });`,
      header + '\nexports[`b 1`] = `"old\n',
    );
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"a"`, "b 1": `"new"` }), exitCode: 0 });
  });

  const unreadable =
    header + '\n<<<<<<< ours\nexports[`b 1`] = `"ours"`;\n=======\nexports[`b 1`] = `"theirs"`;\n>>>>>>> theirs\n';

  // A todo with no body takes no snapshot, so the run has every entry without it.
  test("replaces a file that does not parse when test.only leaves out only a todo with no body", async () => {
    const result = await updateOne(
      `test.only("a", () => { expect("a").toMatchSnapshot(); });
       test.todo("b");`,
      unreadable,
    );
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"a"` }), exitCode: 0 });
  });

  // Such a run can't tell which entries of the file to keep.
  test.each([
    ["-t leaves a test out", `test("b", () => { expect("new").toMatchSnapshot(); });`, ["-t", "a"]],
    ["a test fails", `test("b", () => { throw new Error("boom"); });`, []],
    ["a test is skipped", `test.skip("b", () => { expect("new").toMatchSnapshot(); });`, []],
    ["an afterAll hook throws", `afterAll(() => { throw new Error("boom"); });\ntest("b", () => {});`, []],
    [
      "a test is skipped and the test file is named twice",
      `test.skip("b", () => { expect("new").toMatchSnapshot(); });`,
      ["./a.test.ts", "./a.test.ts"],
    ],
  ])("leaves a file that does not parse when %s", async (_, b, args) => {
    const result = await updateOne(`test("a", () => { expect("a").toMatchSnapshot(); });\n${b}`, unreadable, ...args);
    expect(result).toMatchObject({
      snapshot: unreadable,
      stderr: expect.stringContaining(
        `error: --update-snapshots left "${join("__snapshots__", "a.test.ts.snap")}" as it is: the file doesn't parse\n` +
          "note: A run replaces a snapshot file that doesn't parse only when every test and hook of its test file runs to the end. " +
          "A test that is skipped, filtered out, test.failing or a todo with a body does not.\n" +
          "note: Fix the snapshot file, or delete it and run --update-snapshots again.\n",
      ),
      exitCode: 1,
    });
    // The snapshot of "a" is not in the file, so it does not count as added.
    expect(result.stderr).toContain("\n 1 snapshots, 1 expect() calls\n");
  });

  // No test asks the file for an entry, so the run has nothing to put in its place. The second file is not Bun's.
  const inline = `test("a", () => { expect("a").toMatchInlineSnapshot(\`"a"\`); });`;
  test.each([
    ["a test is skipped", `${inline}\ntest.skip("b", () => { expect("b").toMatchSnapshot(); });`, unreadable],
    ["every test ran to the end", inline, unreadable],
    [
      "every test ran to the end, and the file is of another tool",
      inline,
      "AVA Snapshot v3\n\u0001\u0002{{{ not JavaScript",
    ],
  ])("leaves a file that does not parse, with no error, when no test asks for it and %s", async (_, tests, before) => {
    const result = await updateOne(tests, before);
    expect(result).toMatchObject({ snapshot: before, exitCode: 0 });
    expect(result.stderr).not.toContain("error");
  });

  test("--rerun-each keeps what a run of every test wrote over a file that does not parse when a later run fails", async () => {
    const result = await updateOne(
      `globalThis.runs = (globalThis.runs ?? 0) + 1;
       test("a", () => { expect("a").toMatchSnapshot(); });
       test("b", () => { if (globalThis.runs === 2) throw new Error("boom"); expect("b").toMatchSnapshot(); });`,
      unreadable,
      "--rerun-each=2",
    );
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"a"`, "b 1": `"b"` }), exitCode: 1 });
    expect(result.stderr).not.toContain("the file doesn't parse");
  });

  // The parser reads the first statement and finds no entry in it. What -u does with such a statement is not decided here.
  test("keeps the entry of a skipped test in a file that has a statement that is no entry", async () => {
    const result = await updateOne(
      `test("ran", () => { expect("r").toMatchSnapshot(); });
       test.skip("skipped", () => { expect("s").toMatchSnapshot(); });`,
      header + '\nexports[`z 1`] = `x ${1} y`;\n\nexports[`skipped 1`] = `"s"`;\n',
    );
    expect(result.snapshot).toContain('\nexports[`skipped 1`] = `"s"`;\n');
    expect(result.exitCode).toBe(0);
  });

  // The comment shows that the run put the entry behind the text of the file and did not print the file again.
  const twice = (options: string, afterTheSnapshot = "") => `
    test("one", () => { expect("1").toMatchSnapshot(); });
    test("two", () => {
      globalThis.tries = (globalThis.tries ?? 0) + 1;
      expect("try " + globalThis.tries).toMatchSnapshot();
      ${afterTheSnapshot}
    }${options});`;
  test.each([
    [
      "{ retry: 1 }",
      twice(", { retry: 1 }", `if (globalThis.tries === 1) throw new Error("again");`),
      [],
      "1 passed, 1 added",
    ],
    ["{ repeats: 1 }", twice(", { repeats: 1 }"), [], "1 passed, 1 added"],
    ["--rerun-each=2", twice(""), ["--rerun-each=2"], "2 passed, 1 added"],
  ])(
    "puts a new entry that %s asks for twice behind the text of the file, with its last value",
    async (_, tests, args, counts) => {
      const before = header + '\n// about one\nexports[`one 1`] = `"1"`;\n';
      const result = await updateOne(tests, before, ...args);
      expect(result).toMatchObject({
        snapshot: before + '\nexports[`two 1`] = `"try 2"`;\n',
        stderr: expect.stringContaining(`snapshots: ${counts}\n`),
        exitCode: 0,
      });
    },
  );

  test("--rerun-each keeps the value of the last run", async () => {
    const result = await updateOne(
      `globalThis.runs = (globalThis.runs ?? 0) + 1;
       test("stable", () => { expect("new").toMatchSnapshot(); });
       test("changes", () => { expect("run " + globalThis.runs).toMatchSnapshot(); });
       test.skip("skipped", () => { expect("s").toMatchSnapshot(); });`,
      snap({ "skipped 1": `"s"`, "changes 1": `"old"`, "stable 1": `"old"` }),
      "--rerun-each=2",
    );
    expect(result).toMatchObject({
      snapshot: snap({ "skipped 1": `"s"`, "changes 1": `"run 2"`, "stable 1": `"new"` }),
      exitCode: 0,
    });
  });

  test("leaves the file as it is when no test can take its snapshot", async () => {
    const entries = snap({ "one 1": `"1"`, "two 1": `"2"` });
    // Snapshot matchers throw in concurrent tests.
    const result = await updateOne(
      `test.concurrent("one", () => { expect("1").toMatchSnapshot(); });
       test.concurrent("two", () => { expect("2").toMatchSnapshot(); });`,
      entries,
    );
    expect(result).toMatchObject({ snapshot: entries, exitCode: 1 });
  });

  test("--parallel keeps the entries of the tests that a worker leaves out", async () => {
    const tests = (name: string) =>
      `import { expect, test } from "bun:test";
       test("run ${name}", () => { expect("new").toMatchSnapshot(); });
       test.skip("skipped ${name}", () => { expect("s").toMatchSnapshot(); });`;
    const before = (name: string) => snap({ [`skipped ${name} 1`]: `"s"`, [`run ${name} 1`]: `"old"` });
    const after = (name: string) => snap({ [`skipped ${name} 1`]: `"s"`, [`run ${name} 1`]: `"new"` });
    const result = await update(
      {
        "a.test.ts": tests("a"),
        "b.test.ts": tests("b"),
        "__snapshots__/a.test.ts.snap": before("a"),
        "__snapshots__/b.test.ts.snap": before("b"),
      },
      "--parallel=2",
    );
    expect(result).toMatchObject({
      snapshots: { "a.test.ts.snap": after("a"), "b.test.ts.snap": after("b") },
      exitCode: 0,
    });
  });

  test("--parallel --bail keeps the entries of a test that fails", async () => {
    const result = await update(
      {
        "a.test.ts": `import { expect, test } from "bun:test";
          test("one", () => { expect("new").toMatchSnapshot(); });
          test("two", () => { throw new Error("boom"); });
          test("three", () => { expect("3").toMatchSnapshot(); });`,
        "b.test.ts": `import { test } from "bun:test";
          test("b", () => {});`,
        "__snapshots__/a.test.ts.snap": snap({ "one 1": `"old"`, "two 1": `"2"`, "three 1": `"3"` }),
      },
      "--parallel=2",
      "--bail",
    );
    expect(result).toMatchObject({
      snapshots: { "a.test.ts.snap": snap({ "one 1": `"new"`, "two 1": `"2"`, "three 1": `"3"` }) },
      exitCode: 1,
    });
  });

  test("applies the results of each test file to its own .snap file", async () => {
    const tests = (name: string) =>
      `import { expect, test } from "bun:test";
       test("run ${name}", () => { expect("new").toMatchSnapshot(); });
       test("other ${name}", () => { expect("o").toMatchSnapshot(); });`;
    const before = (name: string) => snap({ [`other ${name} 1`]: `"o"`, "gone 1": `"g"`, [`run ${name} 1`]: `"old"` });
    const after = (name: string) => snap({ [`other ${name} 1`]: `"o"`, [`run ${name} 1`]: `"new"` });
    const result = await update(
      {
        "a.test.ts": tests("a"),
        // No snapshot here. The test "gone" that the filter leaves out must not keep `gone 1` of the other files.
        "b.test.ts": `import { test } from "bun:test";
          test("run b", () => {});
          test("gone", () => {});`,
        "c.test.ts": tests("c"),
        "__snapshots__/a.test.ts.snap": before("a"),
        "__snapshots__/c.test.ts.snap": before("c"),
      },
      "-t",
      "run",
    );
    expect(result).toMatchObject({
      snapshots: { "a.test.ts.snap": after("a"), "c.test.ts.snap": after("c") },
      exitCode: 0,
    });
  });
});

describe.concurrent("a run without --update-snapshots", () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const stored = header + '\n// about one\nexports[`one 1`] = `"1"`;\n';
  const one = `test("one", () => { expect("1").toMatchSnapshot(); });`;
  const file = (dir: unknown) => join(String(dir), "__snapshots__", "a.test.ts.snap");

  async function run(dir: unknown, CI: string, env: Record<string, string> = {}, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: String(dir),
      env: { ...bunEnv, CI, ...env },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  test("does not write a file whose entries all match", async () => {
    using dir = tempDir("snapshot-clean", { "a.test.ts": one, "__snapshots__/a.test.ts.snap": stored });
    const longAgo = new Date("2001-01-01T00:00:00Z");
    fs.utimesSync(file(dir), longAgo, longAgo);
    const { stderr, exitCode } = await run(dir, "false");
    expect(stderr).toContain(" 1 pass");
    expect({ contents: fs.readFileSync(file(dir), "utf8"), modified: fs.statSync(file(dir)).mtime }).toEqual({
      contents: stored,
      modified: longAgo,
    });
    expect(exitCode).toBe(0);
  });

  test("puts a new entry behind the text of the file", async () => {
    using dir = tempDir("snapshot-append", {
      "a.test.ts": one + `\ntest("two", () => { expect("2").toMatchSnapshot(); });`,
      "__snapshots__/a.test.ts.snap": stored,
    });
    const { stderr, exitCode } = await run(dir, "false");
    expect(stderr).toContain("snapshots: 1 passed, 1 added");
    expect(fs.readFileSync(file(dir), "utf8")).toBe(stored + '\nexports[`two 1`] = `"2"`;\n');
    expect(exitCode).toBe(0);
  });

  test.each(textWithNoEntry)("puts the first entry behind the text of a file with %s", async (_, before) => {
    using dir = tempDir("snapshot-first-entry", { "a.test.ts": one, "__snapshots__/a.test.ts.snap": before });
    const { stderr, exitCode } = await run(dir, "false");
    expect(stderr).toContain("snapshots: +1 added");
    expect(fs.readFileSync(file(dir), "utf8")).toBe(before + '\nexports[`one 1`] = `"1"`;\n');
    expect(exitCode).toBe(0);
  });

  // The run loads the file at its first matcher and writes it after the tests. If the file has another length by then, the run prints it from its entries.
  const oneAndTwo = header + '\nexports[`one 1`] = `"1"`;\n\nexports[`two 1`] = `"2"`;\n';
  const withZero = header + '\nexports[`zero 1`] = `"0"`;\n\nexports[`one 1`] = `"1"`;\n';
  test.each([
    ["makes it shorter", "write", header + '\nexports[`one 1`] = `"1"`;\n'],
    ["puts an entry in front", "write", withZero],
    ["replaces it with a rename", "rename", withZero],
    ["empties it", "write", ""],
    ["removes it", "remove", ""],
  ])("prints the file from its entries when another writer %s", async (_, how, contents) => {
    using dir = tempDir("snapshot-other-writer", {
      "a.test.ts": `
        import fs from "fs";
        ${one}
        test("another writer", () => {
          const file = import.meta.dir + "/__snapshots__/a.test.ts.snap";
          const contents = process.env.CONTENTS ?? "";
          if (process.env.HOW === "write") fs.writeFileSync(file, contents);
          if (process.env.HOW === "rename") {
            fs.writeFileSync(file + ".tmp", contents);
            fs.renameSync(file + ".tmp", file);
          }
          if (process.env.HOW === "remove") fs.rmSync(file);
        });
        test("two", () => { expect("2").toMatchSnapshot(); });
      `,
      "__snapshots__/a.test.ts.snap": stored,
    });
    const { stderr, exitCode } = await run(dir, "false", { HOW: how, CONTENTS: contents });
    expect(stderr).toContain("snapshots: 1 passed, 1 added");
    expect(fs.readFileSync(file(dir), "utf8")).toBe(oneAndTwo);
    expect(exitCode).toBe(0);

    // The next run finds both entries, and CI lets it write none.
    const next = await run(dir, "true");
    expect(next.stderr).toContain(" 2 snapshots, ");
    expect(next.exitCode).toBe(0);
  });

  // Both runs have taken the snapshot of "two" before one of them writes the file. A run that only appends would write the key a second time.
  test("two runs of one test file at the same time leave each entry once", async () => {
    using dir = tempDir("snapshot-two-runs", {
      "a.test.ts": `
        import fs from "fs";
        ${one}
        test("two", () => { expect("2").toMatchSnapshot(); });
        test("waits for the other run", async () => {
          fs.writeFileSync(import.meta.dir + "/took-" + process.pid, "");
          const others = () => fs.readdirSync(import.meta.dir).filter(name => name.startsWith("took-"));
          while (others().length < 2) await Bun.sleep(5);
        });
      `,
      "__snapshots__/a.test.ts.snap": header + '\nexports[`one 1`] = `"1"`;\n',
    });
    const runs = await Promise.all([run(dir, "false"), run(dir, "false")]);
    expect(fs.readFileSync(file(dir), "utf8")).toBe(oneAndTwo);
    expect(runs.map(run => run.exitCode)).toEqual([0, 0]);
  });

  test("makes no file and no directory when CI refuses the new snapshot", async () => {
    using dir = tempDir("snapshot-ci", { "a.test.ts": one });
    const { stderr, exitCode } = await run(dir, "true");
    expect(stderr).toContain("Snapshot creation is disabled in CI environments");
    expect(fs.readdirSync(String(dir))).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(1);
  });
});

// The run writes the snapshot file of a test file when that test file ends. Nothing of it is left for a later test file.
describe.concurrent("the snapshot file of a test file that ended", () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const a = `test("a", () => { expect("a").toMatchSnapshot(); });`;
  const ofA = header + '\nexports[`a 1`] = `"a"`;\n';

  /** Runs `bun test` on the files. Returns every `.snap` file as it is after the run. */
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("snapshot-file-end", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const snapshots: Record<string, string> = {};
    for (const name of fs.readdirSync(join(String(dir), "__snapshots__")).sort()) {
      const path = join(String(dir), "__snapshots__", name);
      snapshots[name] = fs.statSync(path).isDirectory() ? "<a directory>" : fs.readFileSync(path, "utf8");
    }
    return { snapshots, stderr, exitCode };
  }

  test.each([
    ["calls process.exit()", `test("b", () => { process.exit(0); });`, [], 0],
    ["fails, and --bail ends the run", `test("b", () => { throw new Error("boom"); });`, ["--bail"], 1],
  ])("has its new entry when a later test file %s", async (_, b, args, exitCode) => {
    const result = await run({ "a.test.js": a, "b.test.js": b }, ...args, "./a.test.js", "./b.test.js");
    expect(result).toMatchObject({ snapshots: { "a.test.js.snap": ofA }, exitCode });
  });

  test("has what --update-snapshots changed and removed when a later test file calls process.exit()", async () => {
    const result = await run(
      {
        "a.test.js": `test("a", () => { expect("new").toMatchSnapshot(); });`,
        "b.test.js": `test("b", () => { process.exit(0); });`,
        "__snapshots__/a.test.js.snap": header + '\nexports[`a 1`] = `"old"`;\n\nexports[`gone 1`] = `"g"`;\n',
      },
      "--update-snapshots",
      "./a.test.js",
      "./b.test.js",
    );
    expect(result).toMatchObject({
      snapshots: { "a.test.js.snap": header + '\nexports[`a 1`] = `"new"`;\n' },
      exitCode: 0,
    });
  });

  // Each listing starts its count of the snapshots of a test at 1.
  test("--isolate gives a test file that is listed twice one key for each snapshot", async () => {
    const result = await run({ "a.test.js": a }, "--isolate", "./a.test.js", "./a.test.js");
    expect(result).toMatchObject({
      snapshots: { "a.test.js.snap": ofA },
      stderr: expect.stringContaining("snapshots: 1 passed, 1 added\n"),
      exitCode: 0,
    });
  });

  // The open at the first change works. The one after the tests finds a directory.
  test.each([[[]], [["--parallel=2"]]])(
    "a write that fails is an error of its own test file, and the next one passes (%j)",
    async args => {
      const result = await run(
        {
          "a.test.js": `
            import fs from "fs";
            ${a}
            test("a directory takes the place of the file", () => {
              const file = import.meta.dir + "/__snapshots__/a.test.js.snap";
              fs.rmSync(file);
              fs.mkdirSync(file);
            });
          `,
          "b.test.js": `test("b", () => { expect("b").toMatchSnapshot(); });`,
        },
        ...args,
      );
      expect(result.stderr).toContain(
        `: Failed to write ${JSON.stringify(join("__snapshots__", "a.test.js.snap"))} (open)\n`,
      );
      expect(result.stderr).toContain(" 3 pass\n 0 fail\n 1 error\n");
      expect(result).toMatchObject({
        snapshots: { "a.test.js.snap": "<a directory>", "b.test.js.snap": header + '\nexports[`b 1`] = `"b"`;\n' },
        exitCode: 1,
      });
    },
  );
});
