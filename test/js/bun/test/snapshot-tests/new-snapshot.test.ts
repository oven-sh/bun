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

  // Such a run can't tell which entries of the file to keep.
  test.each([
    ["-t leaves a test out", `test("b", () => { expect("new").toMatchSnapshot(); });`, ["-t", "a"]],
    ["a test fails", `test("b", () => { throw new Error("boom"); });`, []],
  ])("leaves a file that does not parse when %s", async (_, b, args) => {
    const unreadable =
      header + '\n<<<<<<< ours\nexports[`b 1`] = `"ours"`;\n=======\nexports[`b 1`] = `"theirs"`;\n>>>>>>> theirs\n';
    const result = await updateOne(`test("a", () => { expect("a").toMatchSnapshot(); });\n${b}`, unreadable, ...args);
    expect(result).toMatchObject({
      snapshot: unreadable,
      stderr: expect.stringContaining("error: Failed to parse snapshot file for: a.test.ts"),
      exitCode: 1,
    });
  });

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

  // A worker that stops at --bail writes its file without the pass that removes entries.
  test("--parallel --bail keeps the entries of the tests that did not run", async () => {
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

  async function run(dir: unknown, CI: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, CI },
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

  test("makes no file and no directory when CI refuses the new snapshot", async () => {
    using dir = tempDir("snapshot-ci", { "a.test.ts": one });
    const { stderr, exitCode } = await run(dir, "true");
    expect(stderr).toContain("Snapshot creation is disabled in CI environments");
    expect(fs.readdirSync(String(dir))).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(1);
  });
});
