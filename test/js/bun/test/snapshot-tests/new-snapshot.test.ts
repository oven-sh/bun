import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import path from "path";

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
        expect(process.env.SNAP_VALUE).toMatchSnapshot();
      });
      afterAll(() => {
        const p = path.join(__dirname, "__snapshots__", "snap.test.js.snap");
        const body = fs.readFileSync(p, "utf8");
        console.log("AFTERALL:" + JSON.stringify({ len: body.length, body }));
      });
    `,
  });
  const run = async (value: string, extra: string[] = []) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "snap.test.js", ...extra],
      env: { ...bunEnv, CI: "false", SNAP_VALUE: value },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const seen = JSON.parse(stdout.match(/^AFTERALL:(.*)$/m)![1]);
    return { stdout, stderr, exitCode, seen };
  };
  const snapPath = path.join(String(dir), "__snapshots__", "snap.test.js.snap");

  const longValue = "long-initial-value-" + Buffer.alloc(60, "x").toString();
  const shortValue = "short";

  // First run creates the snapshot; afterAll must already see the entry on disk.
  {
    const { stderr, exitCode, seen } = await run(longValue);
    expect(stderr).toContain("1 pass");
    const onDisk = fs.readFileSync(snapPath, "utf8");
    expect(onDisk).toContain(longValue);
    expect(seen).toEqual({ len: onDisk.length, body: onDisk });
    expect(exitCode).toBe(0);
  }

  const longLen = fs.readFileSync(snapPath, "utf8").length;

  // --update-snapshots with a shorter value: afterAll must see the fully
  // rewritten (shorter) file with no trailing bytes from the long version.
  {
    const { stderr, exitCode, seen } = await run(shortValue, ["--update-snapshots"]);
    expect(stderr).toContain("1 pass");
    const onDisk = fs.readFileSync(snapPath, "utf8");
    expect(onDisk).toContain(shortValue);
    expect(onDisk).not.toContain(longValue);
    expect(onDisk.length).toBeLessThan(longLen);
    expect(seen).toEqual({ len: onDisk.length, body: onDisk });
    expect(exitCode).toBe(0);
  }
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
