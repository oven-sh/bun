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
    for (const name of fs.readdirSync(join(String(dir), "__snapshots__")).sort()) {
      snapshots[name] = await Bun.file(join(String(dir), "__snapshots__", name)).text();
    }
    return { snapshots, stderr, exitCode };
  }

  /** The same for one test file, `a.test.ts`, and the `.snap` file it has before the run. Returns the `.snap` file. */
  async function updateOne(tests: string, snapshot: string | undefined, ...args: string[]) {
    const { snapshots, ...rest } = await update(
      {
        "a.test.ts": `import { afterEach, beforeAll, describe, expect, test } from "bun:test";\n${tests}`,
        ...(snapshot !== undefined && { "__snapshots__/a.test.ts.snap": snapshot }),
      },
      ...args,
    );
    return { snapshot: snapshots["a.test.ts.snap"], ...rest };
  }

  // https://github.com/oven-sh/bun/issues/42969
  test("keeps the order of the file, replaces a value in place, appends a new entry", async () => {
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

  test("writes a new file in the order in which the tests run", async () => {
    const result = await updateOne(
      `test("zeta", () => { expect("z").toMatchSnapshot(); });
       test("alpha", () => { expect("a").toMatchSnapshot(); });`,
      undefined,
    );
    expect(result).toMatchObject({ snapshot: snap({ "zeta 1": `"z"`, "alpha 1": `"a"` }), exitCode: 0 });
  });

  test.each([
    ["a syntax error", 'exports[`b 1`] = `"old\n'],
    ["a value with ${}", 'exports[`b 1`] = `"old"`;\n\nexports[`gone 1`] = `${1}`;\n'],
    ["a statement in parentheses", 'exports[`b 1`] = `"old"`;\n\n(exports[`gone 1`] = `"g"`);\n'],
  ])("writes the file again from the start when it has %s", async (_, entries) => {
    const result = await updateOne(
      `test("a", () => { expect("a").toMatchSnapshot(); });
       test("b", () => { expect("new").toMatchSnapshot(); });`,
      header + "\n" + entries,
    );
    expect(result).toMatchObject({ snapshot: snap({ "a 1": `"a"`, "b 1": `"new"` }), exitCode: 0 });
  });

  test("--rerun-each compares a later run with the value that the first run wrote", async () => {
    const result = await updateOne(
      `globalThis.runs = (globalThis.runs ?? 0) + 1;
       test("stable", () => { expect("new").toMatchSnapshot(); });
       test("changes", () => { expect("run " + globalThis.runs).toMatchSnapshot(); });
       test.skip("skipped", () => { expect("s").toMatchSnapshot(); });`,
      snap({ "skipped 1": `"s"`, "changes 1": `"old"`, "stable 1": `"old"` }),
      "--rerun-each=2",
    );
    expect(result).toMatchObject({
      snapshot: snap({ "skipped 1": `"s"`, "changes 1": `"run 1"`, "stable 1": `"new"` }),
      exitCode: 1,
    });
  });

  test("--bail does not lose the entries of the file", async () => {
    const { snapshot, exitCode } = await updateOne(
      `test("one", () => { expect("new").toMatchSnapshot(); });
       test("two", () => { throw new Error("boom"); });`,
      snap({ "one 1": `"old"`, "two 1": `"2"` }),
      "--bail",
    );
    // Whether a bail writes the value that "one" took is not decided here. It must not lose an entry.
    expect([snap({ "one 1": `"old"`, "two 1": `"2"` }), snap({ "one 1": `"new"`, "two 1": `"2"` })]).toContain(
      snapshot,
    );
    expect(exitCode).toBe(1);
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
      snapshots: { "a.test.ts.snap": after("a"), "b.test.ts.snap": after("b") },
      exitCode: 0,
    });
  });
});
