import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";

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

test("property matchers that are one asymmetric matcher are applied to the received value", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const source = `
    import { test, expect } from "bun:test";
    expect.extend({
      toHaveKey(received, key) {
        return { pass: key in received, message: () => "toHaveKey" };
      },
    });
    test("plain", () => { expect({ a: 1 }).toMatchSnapshot(); });
    test("matches", () => { expect({ a: 1, b: 2 }).toMatchSnapshot(expect.objectContaining({ a: 1 })); });
    test("extended", () => { expect({ a: 1, b: 2 }).toMatchSnapshot(expect.toHaveKey("a")); });
    test("written", () => {
      expect({ a: 1, b: 2 }).toMatchInlineSnapshot(expect.toHaveKey("a"), \`
        {
          "a": 1,
          "b": 2,
        }
      \`);
    });
    test("file", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ b: 1 })); });
    test("inline", () => { expect({ a: 1 }).toMatchInlineSnapshot(expect.any(Array)); });
  `;
  using dir = tempDir("snapshot-whole-matcher", { "a.test.ts": source });
  async function run() {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      results: stderr.match(/^\((pass|fail)\) \w+/gm),
      refused: stderr.match(/Expected propertyMatchers to match properties from received object/g)?.length,
      exitCode,
      snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8"),
      source: fs.readFileSync(`${dir}/a.test.ts`, "utf8"),
    };
  }
  const entry = (name: string) => "\nexports[`" + name + ' 1`] = `\n{\n  "a": 1,\n  "b": 2,\n}\n`;\n';
  const expected = {
    results: ["(pass) plain", "(pass) matches", "(pass) extended", "(pass) written", "(fail) file", "(fail) inline"],
    refused: 2,
    exitCode: 1,
    // A matcher that matches stores the received value. One that does not match stores nothing:
    // the file has no entry for "file", and no inline snapshot was written into the test.
    snap: header + '\nexports[`plain 1`] = `\n{\n  "a": 1,\n}\n`;\n' + entry("matches") + entry("extended"),
    source,
  };
  expect(await run()).toEqual(expected);
  // the second run compares with what the first run stored
  expect(await run()).toEqual(expected);
});

test("property matchers that are one asymmetric matcher are applied in a Jest and a Vitest snapshot file", async () => {
  const tests = (module: string) => `
    import { test, expect } from "${module}";
    test("plain", () => { expect("x").toMatchSnapshot(); });
    test("refused", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ b: 1 })); });
  `;
  const jestHeader = "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n";
  using dir = tempDir("snapshot-whole-matcher-formats", {
    // the first line of a snapshot file gives its format, and the import gives the format of a new file
    "jest.test.ts": tests("bun:test"),
    "__snapshots__/jest.test.ts.snap": jestHeader,
    "vitest.test.ts": tests("vitest"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const snap = (name: string) => fs.readFileSync(`${dir}/__snapshots__/${name}.test.ts.snap`, "utf8");
  expect({
    results: stderr.match(/^\((pass|fail)\) \w+/gm),
    refused: stderr.match(/Expected propertyMatchers to match properties from received object/g)?.length,
    exitCode,
    jest: snap("jest"),
    vitest: snap("vitest"),
  }).toEqual({
    results: ["(pass) plain", "(fail) refused", "(pass) plain", "(fail) refused"],
    refused: 2,
    exitCode: 1,
    jest: jestHeader + '\nexports[`plain 1`] = `"x"`;\n',
    vitest: "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n" + '\nexports[`plain 1`] = `"x"`;\n',
  });
});

test("an object with its own asymmetricMatch() keeps the property matchers in the stored snapshot", async () => {
  const source = `
    import { test, expect } from "bun:test";
    const x = Number(process.env.X);
    class Service {
      x = x;
      asymmetricMatch() { return true; }
    }
    class Shape {
      x = expect.any(Number);
      asymmetricMatch(other) { return typeof other.x === "number"; }
    }
    test("accepts", () => { expect({ asymmetricMatch: () => true, x }).toMatchSnapshot({ x: expect.any(Number) }); });
    test("refuses", () => { expect({ asymmetricMatch: () => false, x }).toMatchSnapshot({ x: expect.any(Number) }); });
    test("method", () => { expect(new Service()).toMatchSnapshot({ x: expect.any(Number) }); });
    test("shape", () => { expect({ x, y: 2 }).toMatchSnapshot(new Shape()); });
    test("inline", () => {
      expect({ asymmetricMatch: () => true, x }).toMatchInlineSnapshot({ x: expect.any(Number) }, \`
        {
          "asymmetricMatch": [Function],
          "x": Any<Number>,
        }
      \`);
    });
  `;
  using dir = tempDir("snapshot-received-asymmetric-match", { "a.test.ts": source });
  async function run(x: number) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", X: String(x) },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { results: stderr.match(/^\((pass|fail)\) \w+/gm), exitCode };
  }
  // The received value is not read as a matcher, and property matchers with an asymmetricMatch() method are walked.
  // The first run stores the matchers, so a run with another number passes.
  const results = ["(pass) accepts", "(pass) refuses", "(pass) method", "(pass) shape", "(pass) inline"];
  expect(await run(1)).toEqual({ results, exitCode: 0 });
  const snap = fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8");
  expect(snap.match(/"x": .*/g)).toEqual(Array(4).fill('"x": Any<Number>,'));
  expect(await run(2)).toEqual({ results, exitCode: 0 });
});
