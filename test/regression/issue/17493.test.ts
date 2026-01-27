import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("prepack script has node_modules/.bin in PATH", async () => {
  // Create a test package that verifies rimraf is accessible from prepack script
  using dir = tempDir("pack-bin-path", {
    "package.json": JSON.stringify(
      {
        name: "test-bin-path",
        version: "1.0.0",
        scripts: {
          // Use which to find rimraf, or check if it's in PATH
          prepack: "node check-path.js",
        },
        devDependencies: {
          rimraf: "^3.0.2",
        },
      },
      null,
      2,
    ),
    "check-path.js": `
const path = require('path');
const fs = require('fs');

// Check if node_modules/.bin is in PATH
const pathDirs = process.env.PATH.split(path.delimiter);
const binDir = path.join(process.cwd(), 'node_modules', '.bin');
const hasBinInPath = pathDirs.some(dir => {
  // Normalize paths for comparison
  const normalizedDir = path.normalize(dir);
  const normalizedBinDir = path.normalize(binDir);
  return normalizedDir === normalizedBinDir || normalizedDir.endsWith(path.join('node_modules', '.bin'));
});

if (!hasBinInPath) {
  console.error('ERROR: node_modules/.bin is NOT in PATH');
  console.error('PATH directories:', pathDirs);
  process.exit(1);
}

// Also verify rimraf executable exists in node_modules/.bin
const rimrafPath = path.join(binDir, process.platform === 'win32' ? 'rimraf.cmd' : 'rimraf');
if (!fs.existsSync(rimrafPath)) {
  // Try the bunx shim path
  const bunxShimPath = path.join(binDir, 'rimraf');
  if (!fs.existsSync(bunxShimPath)) {
    console.error('ERROR: rimraf not found in node_modules/.bin');
    process.exit(1);
  }
}

console.log('SUCCESS: node_modules/.bin is in PATH');
`,
  });

  // First install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, , installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);
  expect(installExitCode).toBe(0);

  // Now run bun pm pack and verify prepack script can find binaries
  await using packProc = Bun.spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    packProc.stdout.text(),
    packProc.stderr.text(),
    packProc.exited,
  ]);

  // The check-path.js script should succeed, meaning node_modules/.bin was in PATH
  expect(stdout + stderr).toContain("SUCCESS: node_modules/.bin is in PATH");
  expect(stdout + stderr).not.toContain("ERROR:");
  expect(exitCode).toBe(0);
});

test("bun run script has node_modules/.bin in PATH (control test)", async () => {
  // This verifies that `bun run` works correctly (as a control)
  using dir = tempDir("run-bin-path", {
    "package.json": JSON.stringify(
      {
        name: "test-run-bin-path",
        version: "1.0.0",
        scripts: {
          "check-path": "node check-path.js",
        },
        devDependencies: {
          rimraf: "^3.0.2",
        },
      },
      null,
      2,
    ),
    "check-path.js": `
const path = require('path');

// Check if node_modules/.bin is in PATH
const pathDirs = process.env.PATH.split(path.delimiter);
const hasBinInPath = pathDirs.some(dir => dir.endsWith(path.join('node_modules', '.bin')));

if (!hasBinInPath) {
  console.error('ERROR: node_modules/.bin is NOT in PATH');
  process.exit(1);
}

console.log('SUCCESS: node_modules/.bin is in PATH');
`,
  });

  // First install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, , installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);
  expect(installExitCode).toBe(0);

  // Run the check-path script via bun run
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "check-path"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  expect(stdout + stderr).toContain("SUCCESS: node_modules/.bin is in PATH");
  expect(stdout + stderr).not.toContain("ERROR:");
  expect(exitCode).toBe(0);
});
