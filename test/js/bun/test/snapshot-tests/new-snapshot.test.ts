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

test("property matchers that are one asymmetric matcher store the received value, or nothing when the matcher does not match", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const source = `
    import { test, expect } from "bun:test";
    test("plain", () => { expect({ a: 1 }).toMatchSnapshot(); });
    test("matches", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ a: 1 })); });
    test("file", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ b: 1 })); });
    test("inline", () => { expect({ a: 1 }).toMatchInlineSnapshot(expect.any(Array)); });
  `;
  using dir = tempDir("snapshot-whole-matcher", { "a.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("Expected propertyMatchers to match properties from received object");
  expect({
    results: stderr.match(/^\((pass|fail)\) \w+/gm),
    exitCode,
    // the entry of "matches" is the received value, the file snapshot has no entry for "file", and no inline snapshot was written into the test
    snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8"),
    source: fs.readFileSync(`${dir}/a.test.ts`, "utf8"),
  }).toEqual({
    results: ["(pass) plain", "(pass) matches", "(fail) file", "(fail) inline"],
    exitCode: 1,
    snap:
      header + '\nexports[`plain 1`] = `\n{\n  "a": 1,\n}\n`;\n' + '\nexports[`matches 1`] = `\n{\n  "a": 1,\n}\n`;\n',
    source,
  });
});

test("a property matcher behind a Proxy is stored as the matcher", async () => {
  const source = `
    import { test, expect } from "bun:test";
    const id = Number(process.env.ID);
    test("array", () => { expect({ a: new Proxy([{ id }], {}) }).toMatchSnapshot({ a: [{ id: expect.any(Number) }] }); });
    test("object", () => { expect(new Proxy({ id }, {})).toMatchSnapshot({ id: expect.any(Number) }); });
    // a Proxy of a function is printed as a function
    const fn = Object.assign(function f() {}, { id });
    test("function", () => { expect({ f: fn }).toMatchSnapshot({ f: { id: expect.any(Number) } }); });
    test("proxied", () => { expect({ f: new Proxy(fn, {}) }).toMatchSnapshot({ f: { id: expect.any(Number) } }); });
  `;
  using dir = tempDir("snapshot-proxy-holder", { "a.test.ts": source });
  async function run(id: number) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", ID: String(id) },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { results: stderr.match(/^\((pass|fail)\) \w+/gm), exitCode };
  }
  // the first run stores the matchers, so the second run with another id passes
  const results = ["(pass) array", "(pass) object", "(pass) function", "(pass) proxied"];
  expect(await run(1)).toEqual({ results, exitCode: 0 });
  const snap = fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8");
  expect(snap).toContain(
    '\nexports[`array 1`] = `\n{\n  "a": [\n    {\n      "id": Any<Number>,\n    },\n  ],\n}\n`;\n',
  );
  expect(snap).toContain('\nexports[`object 1`] = `\n{\n  "id": Any<Number>,\n}\n`;\n');
  // a function is printed without its properties, so neither function entry has the id or the matcher
  expect(snap).not.toContain('"id": 1');
  expect(snap.split("exports[`function 1`]")[1]).not.toContain("Any<Number>");
  expect(await run(2)).toEqual({ results, exitCode: 0 });
});
