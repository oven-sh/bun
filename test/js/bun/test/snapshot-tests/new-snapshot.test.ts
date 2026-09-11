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

const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
const snapEntry = (value: string) => "\nexports[`snap 1`] = `" + value + "`;\n";
const writtenSnap = header + snapEntry('"value"');
// Longer than what a run of the fixtures below writes, so a rewrite has to shrink the file.
const staleSnap = header + snapEntry('"stale"') + '\nexports[`gone 1`] = `"stale"`;\n';

const snapTest = /*js*/ `
  import { test, expect } from "bun:test";
  test("snap", () => { expect("value").toMatchSnapshot(); });
`;
const snapThenFailingTest = /*js*/ `
  import { test, expect } from "bun:test";
  test("snap", () => { expect("value").toMatchSnapshot(); });
  test("fails", () => { expect(1).toBe(2); });
`;
const snapThenExitTest = /*js*/ `
  import { test, expect } from "bun:test";
  test("snap", () => { expect("value").toMatchSnapshot(); process.exit(0); });
`;
const failingTest = /*js*/ `
  import { test, expect } from "bun:test";
  test("fails", () => { expect(1).toBe(2); });
`;
const inlineTest = (snapshot: string) => /*js*/ `
  import { test, expect } from "bun:test";
  test("inline", () => { expect("value").toMatchInlineSnapshot(${snapshot}); });
`;
const inlineThenFailingTest = (snapshot: string) => /*js*/ `
  import { test, expect } from "bun:test";
  test("inline", () => { expect("value").toMatchInlineSnapshot(${snapshot}); });
  test("fails", () => { expect(1).toBe(2); });
`;

async function runBunTest(dir: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

describe("writing the .snap file", () => {
  test.concurrent("--update-snapshots keeps the existing file until the new contents are written", async () => {
    using dir = tempDir("snapshot-exit-before-write", {
      "a.test.ts": snapThenExitTest,
      "__snapshots__": { "a.test.ts.snap": staleSnap },
    });
    const { exitCode } = await runBunTest(dir, ["--update-snapshots", "./a.test.ts"]);
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(staleSnap);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--update-snapshots removes what the existing file had beyond the new contents", async () => {
    using dir = tempDir("snapshot-update-shrinks", {
      "a.test.ts": snapTest,
      "__snapshots__": { "a.test.ts.snap": staleSnap },
    });
    const { stderr, exitCode } = await runBunTest(dir, ["--update-snapshots", "./a.test.ts"]);
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a file's snapshots are written when it finishes, not when the run ends", async () => {
    using dir = tempDir("snapshot-written-per-file", {
      "a.test.ts": snapTest,
      "b.test.ts": `process.exit(1);`,
    });
    const { exitCode } = await runBunTest(dir, ["./a.test.ts", "./b.test.ts"]);
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
    expect(exitCode).toBe(1);
  });
});

describe("--bail", () => {
  async function runUntilBail(dir: string, ...args: string[]) {
    const { stderr, exitCode } = await runBunTest(dir, ["--bail", ...args], {
      // Bailing on a failed test exits the process without tearing the VM down, so the
      // test runner's JSC-owned objects show up as leaks. These tests cover what reaches
      // disk before that exit, so keep ASAN on but leave LSAN off for the child.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    });
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(exitCode).toBe(1);
  }

  test.concurrent("writes the snapshots recorded in the file that bailed", async () => {
    using dir = tempDir("snapshot-bail", { "a.test.ts": snapThenFailingTest });
    await runUntilBail(dir, "./a.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
  });

  test.concurrent("--update-snapshots replaces the existing file with the snapshots recorded so far", async () => {
    using dir = tempDir("snapshot-bail-update", {
      "a.test.ts": snapThenFailingTest,
      "__snapshots__": { "a.test.ts.snap": staleSnap },
    });
    await runUntilBail(dir, "--update-snapshots", "./a.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
  });

  test.concurrent("writes the pending inline snapshots of the file that bailed", async () => {
    using dir = tempDir("snapshot-bail-inline", { "a.test.ts": inlineThenFailingTest("") });
    await runUntilBail(dir, "./a.test.ts");
    expect(fs.readFileSync(`${dir}/a.test.ts`, "utf8")).toBe(inlineThenFailingTest('`"value"`'));
  });

  test.concurrent("keeps the snapshots of an earlier file when a later file's test fails", async () => {
    using dir = tempDir("snapshot-bail-earlier-file", { "a.test.ts": snapTest, "b.test.ts": failingTest });
    await runUntilBail(dir, "./a.test.ts", "./b.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
  });

  test.concurrent("keeps the snapshots of an earlier file when a later file fails to load", async () => {
    using dir = tempDir("snapshot-bail-load-error", {
      "a.test.ts": snapTest,
      "b.test.ts": `throw new Error("failed to load");`,
    });
    await runUntilBail(dir, "./a.test.ts", "./b.test.ts");
    expect(fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8")).toBe(writtenSnap);
  });

  test.concurrent(
    "writes the pending inline snapshots of an earlier file when a later file fails to load",
    async () => {
      using dir = tempDir("snapshot-bail-load-error-inline", {
        "a.test.ts": inlineTest(""),
        "b.test.ts": `throw new Error("failed to load");`,
      });
      await runUntilBail(dir, "./a.test.ts", "./b.test.ts");
      expect(fs.readFileSync(`${dir}/a.test.ts`, "utf8")).toBe(inlineTest('`"value"`'));
    },
  );
});
