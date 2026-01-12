import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that fs.openSync works with embedded files in single-file executables
// https://github.com/oven-sh/bun/issues/25638

test("fs.openSync works with embedded files in single-file executables", async () => {
  using dir = tempDir("issue-25638", {
    "data.txt": "This is embedded data for testing openSync",
    "main.ts": `
import dataPath from './data.txt' with {type: "file"};
import * as fs from "fs";

const results: { [key: string]: string | number } = {};

// Test readFileSync - should work
try {
  results.readFileSync = fs.readFileSync(dataPath, "utf8");
} catch (e: any) {
  results.readFileSyncError = e.message;
}

// Test statSync - should work
try {
  results.statSync = fs.statSync(dataPath).size;
} catch (e: any) {
  results.statSyncError = e.message;
}

// Test openSync - this is the bug being fixed
try {
  const fd = fs.openSync(dataPath, "r");
  results.openSync = fd;

  // Test fstatSync on the opened file descriptor
  try {
    results.fstatSync = fs.fstatSync(fd).size;
  } catch (e: any) {
    results.fstatSyncError = e.message;
  }

  // Test readSync on the opened file descriptor
  try {
    const buffer = Buffer.alloc(100);
    const bytesRead = fs.readSync(fd, buffer, 0, 100, 0);
    results.readSync = buffer.toString("utf8", 0, bytesRead);
  } catch (e: any) {
    results.readSyncError = e.message;
  }

  fs.closeSync(fd);
} catch (e: any) {
  results.openSyncError = e.message;
}

// Test fs.promises.open - async version
try {
  const fh = await fs.promises.open(dataPath, "r");
  results.promisesOpen = fh.fd;

  // Test read on the file handle
  const buffer = Buffer.alloc(100);
  const { bytesRead } = await fh.read(buffer, 0, 100, 0);
  results.promisesRead = buffer.toString("utf8", 0, bytesRead);

  await fh.close();
} catch (e: any) {
  results.promisesOpenError = e.message;
}

// Test that opening with write flags returns EROFS
try {
  const fd = fs.openSync(dataPath, "w");
  fs.closeSync(fd);
  results.openSyncWrite = "unexpected success";
} catch (e: any) {
  results.openSyncWriteError = e.code;
}

console.log(JSON.stringify(results));
`,
  });

  // Build the single-file executable
  const buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target=bun", "main.ts", "--outfile=app"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Run the compiled executable
  const appProc = Bun.spawn({
    cmd: [String(dir) + "/app"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [appStdout, appStderr, appExitCode] = await Promise.all([
    appProc.stdout.text(),
    appProc.stderr.text(),
    appProc.exited,
  ]);

  // Parse the results
  const results = JSON.parse(appStdout.trim());

  // Verify all operations work correctly
  expect(results.readFileSync).toBe("This is embedded data for testing openSync");
  expect(results.statSync).toBe(42); // length of "This is embedded data for testing openSync"

  // These are the main assertions for the bug fix
  expect(results.openSyncError).toBeUndefined();
  expect(typeof results.openSync).toBe("number");
  expect(results.openSync).toBeGreaterThanOrEqual(0);

  // fstatSync should work on the VFS file descriptor
  expect(results.fstatSyncError).toBeUndefined();
  expect(results.fstatSync).toBe(42);

  // readSync should work on the VFS file descriptor
  expect(results.readSyncError).toBeUndefined();
  expect(results.readSync).toBe("This is embedded data for testing openSync");

  // fs.promises.open should also work
  expect(results.promisesOpenError).toBeUndefined();
  expect(typeof results.promisesOpen).toBe("number");
  expect(results.promisesRead).toBe("This is embedded data for testing openSync");

  // Opening with write flags should fail with EROFS (read-only file system)
  expect(results.openSyncWriteError).toBe("EROFS");

  expect(appExitCode).toBe(0);
});
