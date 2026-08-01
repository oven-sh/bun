import { expect, test } from "bun:test";
import fs from "fs";
import path from "path";
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

// https://github.com/oven-sh/bun/issues/12114
test.concurrent("afterAll sees the written .snap file under --update-snapshots", async () => {
  using dir = tempDir("snap-afterall-update", {
    "snap.test.js": `
      const fs = require("node:fs");
      const path = require("node:path");
      test("make a snapshot", () => {
        expect({ a: 1, b: "two" }).toMatchSnapshot();
      });
      afterAll(() => {
        const p = path.join(__dirname, "__snapshots__", "snap.test.js.snap");
        const body = fs.readFileSync(p, "utf8");
        console.log("SNAPLEN:" + body.length);
        console.log("HASKEY:" + body.includes("make a snapshot 1"));
      });
    `,
  });
  const run = async (extra: string[] = []) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "snap.test.js", ...extra],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  // First run creates the snapshot; afterAll must already see the entry on disk.
  {
    const { stdout, stderr, exitCode } = await run();
    expect(stderr).toContain("1 pass");
    expect(stdout).toContain("HASKEY:true");
    expect(stdout).not.toContain("SNAPLEN:0\n");
    expect(exitCode).toBe(0);
  }

  const snapPath = path.join(String(dir), "__snapshots__", "snap.test.js.snap");
  const onDisk = fs.readFileSync(snapPath, "utf8");
  expect(onDisk).toContain("make a snapshot 1");

  // --update-snapshots must not leave the file empty while afterAll runs.
  {
    const { stdout, stderr, exitCode } = await run(["--update-snapshots"]);
    expect(stderr).toContain("1 pass");
    expect(stdout).toContain("SNAPLEN:" + onDisk.length);
    expect(stdout).toContain("HASKEY:true");
    expect(exitCode).toBe(0);
  }

  // File on disk must be unchanged (no trailing old bytes, no truncation to 0).
  expect(fs.readFileSync(snapPath, "utf8")).toBe(onDisk);
});

test.concurrent("afterAll sees the written .snap file across multiple test files", async () => {
  const fixture = (name: string) => `
    const fs = require("node:fs");
    const path = require("node:path");
    test("${name}", () => {
      expect({ name: "${name}" }).toMatchSnapshot();
    });
    afterAll(() => {
      const p = path.join(__dirname, "__snapshots__", "${name}.test.js.snap");
      console.log("${name}:HASKEY:" + fs.readFileSync(p, "utf8").includes("${name} 1"));
    });
  `;
  using dir = tempDir("snap-afterall-multi", {
    "a.test.js": fixture("a"),
    "b.test.js": fixture("b"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--update-snapshots", "a.test.js", "b.test.js"],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("2 pass");
  expect(stdout).toContain("a:HASKEY:true");
  expect(stdout).toContain("b:HASKEY:true");
  expect(exitCode).toBe(0);
});
