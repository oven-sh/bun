import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// These tests exercise posix path resolution with long CWDs. On Windows CI the
// profile binary isn't always available, and the bug is posix-specific anyway.
const testFn = isWindows ? test.skip : test;

// macOS PATH_MAX is 1024, so CWD must stay under that. We use ~800 byte CWDs
// and long relative paths to exceed PATH_SIZE thresholds.

testFn("path.posix.resolve with long CWD and relative path doesn't crash", () => {
  // Regression test: buffer overflow when CWD + relative_path > PATH_SIZE.
  using dir = tempDir("resolve-long-cwd", {});
  const baseDir = String(dir);

  // Build a ~750 byte deep directory (fits under macOS PATH_MAX=1024).
  let currentDir = baseDir;
  const segmentName = "a".repeat(80);
  for (let i = 0; i < 8; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  // Relative path long enough that CWD + path > PATH_SIZE on all platforms.
  const relativePath = "b".repeat(4000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.resolve(${JSON.stringify(relativePath)});
       const cwd = process.cwd();
       const expected = cwd + "/" + ${JSON.stringify(relativePath)};
       if (result !== expected) {
         console.log("FAIL:expected=" + expected.length + ",got=" + result.length);
         process.exit(1);
       }
       for (let i = 0; i < 100; i++) {
         path.posix.resolve("test" + i);
         path.posix.normalize("test" + i);
       }
       console.log("OK:" + result.length);`,
    ],
    env: bunEnv,
    cwd: currentDir,
  });

  expect(proc.stdout.toString()).toStartWith("OK:");
  expect(proc.exitCode).toBe(0);
});

testFn("path.posix.resolve with long CWD and multiple relative paths doesn't crash", () => {
  using dir = tempDir("resolve-long-cwd-multi", {});
  const baseDir = String(dir);

  let currentDir = baseDir;
  const segmentName = "c".repeat(80);
  for (let i = 0; i < 8; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  const pathA = "d".repeat(2000);
  const pathB = "e".repeat(2000);
  const pathC = "f".repeat(2000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.resolve(${JSON.stringify(pathA)}, ${JSON.stringify(pathB)}, ${JSON.stringify(pathC)});
       const cwd = process.cwd();
       const expected = cwd + "/" + ${JSON.stringify(pathA)} + "/" + ${JSON.stringify(pathB)} + "/" + ${JSON.stringify(pathC)};
       if (result !== expected) {
         console.log("FAIL:expected=" + expected.length + ",got=" + result.length);
         process.exit(1);
       }
       for (let i = 0; i < 100; i++) {
         path.posix.resolve("test" + i);
         path.posix.normalize("test" + i);
       }
       console.log("OK:" + result.length);`,
    ],
    env: bunEnv,
    cwd: currentDir,
  });

  expect(proc.stdout.toString()).toStartWith("OK:");
  expect(proc.exitCode).toBe(0);
});

testFn("path.posix.relative with long CWD and relative paths doesn't crash", () => {
  using dir = tempDir("relative-long-cwd", {});
  const baseDir = String(dir);

  let currentDir = baseDir;
  const segmentName = "r".repeat(80);
  for (let i = 0; i < 8; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  const fromPath = "x".repeat(2000);
  const toPath = "y".repeat(2000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.relative(${JSON.stringify(fromPath)}, ${JSON.stringify(toPath)});
       if (!result.includes("..")) {
         console.log("FAIL:no ..");
         process.exit(1);
       }
       for (let i = 0; i < 100; i++) {
         path.posix.resolve("test" + i);
         path.posix.normalize("test" + i);
       }
       console.log("OK:" + result.length);`,
    ],
    env: bunEnv,
    cwd: currentDir,
  });

  expect(proc.stdout.toString()).toStartWith("OK:");
  expect(proc.exitCode).toBe(0);
});
