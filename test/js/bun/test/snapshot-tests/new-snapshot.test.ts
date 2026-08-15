import { describe, expect, test } from "bun:test";
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

describe("--bail", () => {
  // Snapshots are buffered in memory while a file runs and written back later. Bailing out must
  // still write them: the .snap file is created (and truncated under -u) as soon as it is opened.
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const snapEntry = (value: string) => "\nexports[`snap 1`] = `" + value + "`;\n";

  const snapTest = /*js*/ `
    import { test, expect } from "bun:test";
    test("snap", () => { expect("value").toMatchSnapshot(); });
  `;
  const failingTest = /*js*/ `
    import { test, expect } from "bun:test";
    test("fails", () => { expect(1).toBe(2); });
  `;
  const snapThenFailingTest = /*js*/ `
    import { test, expect } from "bun:test";
    test("snap", () => { expect("value").toMatchSnapshot(); });
    test("fails", () => { expect(1).toBe(2); });
  `;
  const inlineSnap = (snapshot: string) => /*js*/ `
    import { test, expect } from "bun:test";
    test("inline", () => { expect("value").toMatchInlineSnapshot(${snapshot}); });
    test("fails", () => { expect(1).toBe(2); });
  `;

  async function runUntilBail(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--bail", ...args],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(exitCode).toBe(1);
  }

  test.concurrent("writes the snapshots recorded in the file that bailed", async () => {
    using dir = tempDir("snapshot-bail", { "a.test.ts": snapThenFailingTest });
    await runUntilBail(dir, "./a.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(header + snapEntry('"value"'));
  });

  test.concurrent("--update-snapshots writes the updated snapshots instead of leaving the file empty", async () => {
    using dir = tempDir("snapshot-bail-update", {
      "a.test.ts": snapThenFailingTest,
      "__snapshots__": { "a.test.ts.snap": header + snapEntry('"stale"') },
    });
    await runUntilBail(dir, "--update-snapshots", "./a.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(header + snapEntry('"value"'));
  });

  test.concurrent("writes the snapshots of an earlier file when a later file's test fails", async () => {
    using dir = tempDir("snapshot-bail-earlier-file", { "a.test.ts": snapTest, "b.test.ts": failingTest });
    await runUntilBail(dir, "./a.test.ts", "./b.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(header + snapEntry('"value"'));
  });

  test.concurrent("writes the snapshots of an earlier file when a later file fails to load", async () => {
    using dir = tempDir("snapshot-bail-load-error", {
      "a.test.ts": snapTest,
      "b.test.ts": `throw new Error("failed to load");`,
    });
    await runUntilBail(dir, "./a.test.ts", "./b.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(header + snapEntry('"value"'));
  });

  test.concurrent("writes pending inline snapshots", async () => {
    using dir = tempDir("snapshot-bail-inline", { "a.test.ts": inlineSnap("") });
    await runUntilBail(dir, "./a.test.ts");
    expect(fs.readFileSync(`${dir}/a.test.ts`, "utf8")).toBe(inlineSnap('`"value"`'));
  });
});
