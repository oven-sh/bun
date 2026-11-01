import { expect, test } from "bun:test";
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

// bun test reads a .snap file as data and has no macro context for it. A macro call in the file
// cannot run, so the file is rejected like a .snap file that does not parse.
const MACRO_NAMESPACE = 'import * as m from "../macro.ts" with { type: "macro" };';
const MACRO_NAMED = 'import { fn } from "../macro.ts" with { type: "macro" };';
const MACRO_DEFAULT = 'import fn from "../macro.ts" with { type: "macro" };';
const MATCH_SNAPSHOT = `expect("hello").toMatchSnapshot();`;
const MATCH_ERROR_SNAPSHOT = `expect(() => { throw new Error("hello"); }).toThrowErrorMatchingSnapshot();`;
test.concurrent.each([
  ["a call of a namespace import of a macro", MACRO_NAMESPACE, "m.fn()", MATCH_SNAPSHOT],
  ["a call of a named import of a macro", MACRO_NAMED, "fn()", MATCH_SNAPSHOT],
  ["a call of a default import of a macro", MACRO_DEFAULT, "fn()", MATCH_SNAPSHOT],
  ["a call of an import from a macro: path", 'import { fn } from "macro:../macro.ts";', "fn()", MATCH_SNAPSHOT],
  ["a macro as the tag of a template", MACRO_NAMED, "fn`x`", MATCH_SNAPSHOT],
  ["a member of a macro namespace as the tag of a template", MACRO_NAMESPACE, "m.fn`x`", MATCH_SNAPSHOT],
  ["a macro call, read by toThrowErrorMatchingSnapshot()", MACRO_NAMED, "fn()", MATCH_ERROR_SNAPSHOT],
])("a .snap file with %s fails the test and does not run the macro", async (_, importLine, call, assertion) => {
  const snap = `${importLine}\nexports[\`a 1\`] = ${call};\n`;
  using dir = tempDir("snapshot-macro-call", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("a", () => { ${assertion} });
    `,
    "macro.ts": `
      import { writeFileSync } from "fs";
      import { join } from "path";
      export default function fn() {
        writeFileSync(join(import.meta.dir, "ran"), "");
        return '"hello"';
      }
      export { fn };
    `,
    "__snapshots__/a.test.ts.snap": snap,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Either error of the snapshot matcher for a .snap file that it cannot load.
  expect(stderr).toMatch(/error: Failed to (snapshot value|parse snapshot file for): /);
  expect(stderr).toContain(" 0 pass\n 1 fail\n");
  expect(fs.existsSync(join(String(dir), "ran"))).toBe(false);
  expect(fs.readFileSync(join(String(dir), "__snapshots__", "a.test.ts.snap"), "utf8")).toBe(snap);
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 1, signalCode: null });
});
