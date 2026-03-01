import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

test("path.posix.resolve with long CWD and relative path doesn't crash", () => {
  // Regression test: buffer overflow when CWD + relative_path > PATH_SIZE.
  // The buffer in resolveJS_T didn't account for the CWD that resolvePosixT
  // prepends when all paths are relative.
  using dir = tempDir("resolve-long-cwd", {});
  const baseDir = String(dir);

  // Build a deep directory (~3000 bytes) to use as CWD.
  let currentDir = baseDir;
  const segmentName = "a".repeat(200);
  for (let i = 0; i < 15; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  const relativePath = "b".repeat(2000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.resolve(${JSON.stringify(relativePath)});
       const cwd = process.cwd();
       // Verify the resolved path is correct: CWD + "/" + relativePath
       const expected = cwd + "/" + ${JSON.stringify(relativePath)};
       if (result !== expected) {
         console.log("FAIL:expected=" + expected.length + ",got=" + result.length);
         process.exit(1);
       }
       // Do additional allocations to detect heap corruption from buffer overflow
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

test("path.posix.resolve with long CWD and multiple relative paths doesn't crash", () => {
  using dir = tempDir("resolve-long-cwd-multi", {});
  const baseDir = String(dir);

  let currentDir = baseDir;
  const segmentName = "c".repeat(150);
  for (let i = 0; i < 10; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  const pathA = "d".repeat(1000);
  const pathB = "e".repeat(1000);
  const pathC = "f".repeat(1000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.resolve(${JSON.stringify(pathA)}, ${JSON.stringify(pathB)}, ${JSON.stringify(pathC)});
       const cwd = process.cwd();
       // The last relative path wins since none are absolute.
       // Result should be CWD + "/" + pathA + "/" + pathB + "/" + pathC
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

test("path.posix.relative with long CWD and relative paths doesn't crash", () => {
  using dir = tempDir("relative-long-cwd", {});
  const baseDir = String(dir);

  let currentDir = baseDir;
  const segmentName = "r".repeat(200);
  for (let i = 0; i < 15; i++) {
    currentDir = path.join(currentDir, segmentName);
  }
  fs.mkdirSync(currentDir, { recursive: true });

  const fromPath = "x".repeat(1000);
  const toPath = "y".repeat(1000);

  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
       const result = path.posix.relative(${JSON.stringify(fromPath)}, ${JSON.stringify(toPath)});
       // from and to resolve to different dirs under CWD, so relative should include ".."
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
