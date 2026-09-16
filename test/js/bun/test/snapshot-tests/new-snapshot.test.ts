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
    for (const name of Object.keys(files)) {
      if (name.endsWith(".snap")) snapshots[name] = await Bun.file(join(String(dir), name)).text();
    }
    return { snapshots, stderr, exitCode };
  }

  /** The same for one test file, `a.test.ts`. Returns its `.snap` file. */
  async function updateOne(tests: string, snapshot: string, ...args: string[]) {
    const { snapshots, ...rest } = await update(
      {
        "a.test.ts": `import { afterEach, beforeAll, describe, expect, test } from "bun:test";\n${tests}`,
        "__snapshots__/a.test.ts.snap": snapshot,
      },
      ...args,
    );
    return { snapshot: snapshots["__snapshots__/a.test.ts.snap"], ...rest };
  }

  // https://github.com/oven-sh/bun/issues/42969
  test("keeps the order of the file, replaces a value in place, appends a new entry", async () => {
    const result = await updateOne(
      `test("zeta", () => { expect("z").toMatchSnapshot(); });
       test("mid", () => { expect("m").toMatchSnapshot(); });
       test("alpha", () => { expect("new").toMatchSnapshot(); });`,
      snap({ "alpha 1": `"old"`, "zeta 1": `"z"` }),
    );
    expect(result).toMatchObject({
      snapshot: snap({ "alpha 1": `"new"`, "zeta 1": `"z"`, "mid 1": `"m"` }),
      stderr: expect.stringContaining("snapshots: +3 added"),
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

  test("removes an entry and leaves the comment line above it", async () => {
    const result = await updateOne(
      `test("a", () => { expect("a").toMatchSnapshot(); });`,
      header + '// about gone\nexports[`gone 1`] = `"g"`;\nexports[`a 1`] = `"a"`;\n',
    );
    expect(result).toMatchObject({
      snapshot: header + '// about gone\nexports[`a 1`] = `"a"`;\n',
      exitCode: 0,
    });
  });

  test("escapes a replaced value and keeps CRLF line ends", async () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    const value = "tick ` dollar ${x} back \\ slash";
    const result = await updateOne(
      `test("a", () => { expect(${JSON.stringify(value)}).toMatchSnapshot(); });
       test("b", () => { expect("b").toMatchSnapshot(); });`,
      crlf(
        snap({
          "a 1": `"a value that is longer than the new one, so the file shrinks"`,
          "gone 1": `"g"`,
          "b 1": `"b"`,
        }),
      ),
    );
    expect(result).toMatchObject({
      snapshot: crlf(snap({ "a 1": '"tick \\` dollar \\${x} back \\\\ slash"', "b 1": `"b"` })),
      exitCode: 0,
    });
  });

  test("removes nothing when a describe callback throws", async () => {
    const result = await updateOne(
      `test("top", () => { expect("new").toMatchSnapshot(); });
       describe("suite", () => {
         throw new Error("boom");
         test("late", () => { expect("l").toMatchSnapshot(); });
       });`,
      snap({ "top 1": `"old"`, "suite late 1": `"l"` }),
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

  test("keeps the entries of a hook when -t filters out some of its tests", async () => {
    const entries = { "(unnamed) 1": `"one"`, "(unnamed) 2": `"two"` };
    const result = await updateOne(
      `let last;
       afterEach(() => { expect(last).toMatchSnapshot(); });
       test("one", () => { last = "one"; });
       test("two", () => { last = "two"; });`,
      snap(entries),
      "-t",
      "one",
    );
    expect(result).toMatchObject({ snapshot: snap(entries), exitCode: 0 });
  });

  test("writes the file again from the start when an entry is not one statement on its line", async () => {
    const result = await updateOne(
      `test("a", () => { expect("new").toMatchSnapshot(); });`,
      header + '\n(exports[`gone 1`] = `"g"`);\n\nexports[`a 1`] = `"old"`;\n',
    );
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"new"` }), exitCode: 0 });
  });

  test("--bail leaves the file as it is", async () => {
    const entries = { "one 1": `"old"`, "two 1": `"2"` };
    const result = await updateOne(
      `test("one", () => { expect("new").toMatchSnapshot(); });
       test("two", () => { throw new Error("boom"); });`,
      snap(entries),
      "--bail",
    );
    expect(result).toMatchObject({ snapshot: snap(entries), exitCode: 1 });
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
        "b.test.ts": tests("b"),
        "__snapshots__/a.test.ts.snap": before("a"),
        "__snapshots__/b.test.ts.snap": before("b"),
      },
      "-t",
      "run",
    );
    expect(result).toMatchObject({
      snapshots: { "__snapshots__/a.test.ts.snap": after("a"), "__snapshots__/b.test.ts.snap": after("b") },
      exitCode: 0,
    });
  });
});
