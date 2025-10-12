import { expect, test } from "bun:test";
import * as fs from "fs";
import { bunEnv, bunExe } from "harness";
import * as os from "os";
import * as path from "path";

// These tests check if the resolver cache fix introduces any regressions
// by comparing Bun's behavior with Node.js on edge cases.
//
// CURRENT STATUS: These tests FAIL - they reveal PRE-EXISTING bugs in Bun
// (confirmed to exist in both system bun and debug build, so NOT introduced
// by the resolver cache fix).
//
// BUG DISCOVERED: When running inside `bun test`, spawned Bun processes see
// incorrect file states. Specifically, when a script modifies a file during
// execution, the first require() sees the FINAL state instead of the initial
// state. This suggests a shared module cache or file watcher issue between
// the test runner and spawned processes.
//
// Node.js behavior (correct): First require sees value 1, third require sees value 2
// Bun behavior (incorrect): First require sees value 2 (the final state!)
//
// These tests document expected Node.js-compatible behavior and serve as
// regression tests to ensure future changes don't make this worse.

test("Node.js compat: resolution after deleting and recreating module", async () => {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resolver-compat-"));

  try {
    // Create test script that requires, deletes, recreates, and requires again
    const testScript = `
const fs = require("fs");
const path = require("path");

const modulePath = path.join(__dirname, "testmodule.js");

// First require
const result1 = require("./testmodule");
console.log("First require:", result1.value);
if (result1.value !== 1) process.exit(1);

// Clear cache
delete require.cache[require.resolve("./testmodule")];

// Delete file
fs.rmSync(modulePath);

// Try to require deleted file - should fail
try {
  require("./testmodule");
  console.log("ERROR: Second require should have failed");
  process.exit(1);
} catch (e) {
  console.log("Second require failed as expected");
}

// Recreate with new content
fs.writeFileSync(modulePath, "module.exports = { value: 2 };");

// Third require - should succeed with new value
const result3 = require("./testmodule");
console.log("Third require:", result3.value);
if (result3.value !== 2) {
  console.log("ERROR: Expected value 2, got", result3.value);
  process.exit(1);
}

console.log("SUCCESS: All checks passed");
`;

    fs.writeFileSync(path.join(tmpDir, "test.js"), testScript);
    fs.writeFileSync(path.join(tmpDir, "testmodule.js"), `module.exports = { value: 1 };`);

    // Run with Node.js
    const nodeResult = Bun.spawnSync({
      cmd: ["node", "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const nodeOutput = nodeResult.stdout.toString();
    const nodeSuccess = nodeResult.exitCode === 0;

    console.log("\n=== Node.js output ===");
    console.log(nodeOutput);
    if (!nodeSuccess) {
      console.log("Node.js stderr:", nodeResult.stderr.toString());
    }

    // Run with Bun
    const bunResult = Bun.spawnSync({
      cmd: [bunExe(), "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const bunOutput = bunResult.stdout.toString();
    const bunSuccess = bunResult.exitCode === 0;

    console.log("\n=== Bun output ===");
    console.log(bunOutput);
    if (!bunSuccess) {
      console.log("Bun stderr:", bunResult.stderr.toString());
    }

    console.log("\n=== Comparison ===");
    console.log("Node.js:", nodeSuccess ? "PASS" : "FAIL");
    console.log("Bun:", bunSuccess ? "PASS" : "FAIL");

    // Both should succeed
    expect(nodeSuccess).toBe(true);
    expect(bunSuccess).toBe(true);

    // If there's a discrepancy, fail the test
    if (nodeSuccess !== bunSuccess) {
      throw new Error(
        `Behavior mismatch! Node.js ${nodeSuccess ? "passed" : "failed"} but Bun ${bunSuccess ? "passed" : "failed"}`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Node.js compat: resolution of directory module after recreation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resolver-compat-dir-"));

  try {
    const testScript = `
const fs = require("fs");
const path = require("path");

const moduleDir = path.join(__dirname, "mymodule");

// First require
const result1 = require("./mymodule");
console.log("First require:", result1.name);
if (result1.name !== "original") process.exit(1);

// Clear cache
const resolved = require.resolve("./mymodule");
delete require.cache[resolved];

// Delete directory
fs.rmSync(moduleDir, { recursive: true });

// Try to require deleted module - should fail
try {
  require("./mymodule");
  console.log("ERROR: Second require should have failed");
  process.exit(1);
} catch (e) {
  console.log("Second require failed as expected");
}

// Recreate with new content
fs.mkdirSync(moduleDir);
fs.writeFileSync(path.join(moduleDir, "index.js"), "module.exports = { name: 'recreated' };");

// Third require - should succeed
const result3 = require("./mymodule");
console.log("Third require:", result3.name);
if (result3.name !== "recreated") {
  console.log("ERROR: Expected 'recreated', got", result3.name);
  process.exit(1);
}

console.log("SUCCESS: All checks passed");
`;

    fs.writeFileSync(path.join(tmpDir, "test.js"), testScript);
    fs.mkdirSync(path.join(tmpDir, "mymodule"));
    fs.writeFileSync(path.join(tmpDir, "mymodule", "index.js"), `module.exports = { name: "original" };`);

    // Run with Node.js
    const nodeResult = Bun.spawnSync({
      cmd: ["node", "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const nodeSuccess = nodeResult.exitCode === 0;
    console.log("\n=== Node.js output ===");
    console.log(nodeResult.stdout.toString());
    if (!nodeSuccess) {
      console.log("Node.js stderr:", nodeResult.stderr.toString());
    }

    // Run with Bun
    const bunResult = Bun.spawnSync({
      cmd: [bunExe(), "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const bunSuccess = bunResult.exitCode === 0;
    console.log("\n=== Bun output ===");
    console.log(bunResult.stdout.toString());
    if (!bunSuccess) {
      console.log("Bun stderr:", bunResult.stderr.toString());
    }

    console.log("\n=== Comparison ===");
    console.log("Node.js:", nodeSuccess ? "PASS" : "FAIL");
    console.log("Bun:", bunSuccess ? "PASS" : "FAIL");

    expect(nodeSuccess).toBe(true);
    expect(bunSuccess).toBe(true);

    if (nodeSuccess !== bunSuccess) {
      throw new Error(
        `Behavior mismatch! Node.js ${nodeSuccess ? "passed" : "failed"} but Bun ${bunSuccess ? "passed" : "failed"}`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Node.js compat: package.json main field resolution after deletion", async () => {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resolver-compat-pkg-"));

  try {
    const testScript = `
const fs = require("fs");
const path = require("path");

// First require using package.json main
const result1 = require("./mypkg");
console.log("First require:", result1.value);
if (result1.value !== "main") process.exit(1);

// Clear cache
delete require.cache[require.resolve("./mypkg")];

// Delete the main file
fs.rmSync(path.join(__dirname, "mypkg", "main.js"));

// Should fail since main.js is gone
try {
  require("./mypkg");
  console.log("ERROR: Second require should have failed");
  process.exit(1);
} catch (e) {
  console.log("Second require failed as expected");
}

// Recreate main.js
fs.writeFileSync(path.join(__dirname, "mypkg", "main.js"), "module.exports = { value: 'restored' };");

// Should work again
const result3 = require("./mypkg");
console.log("Third require:", result3.value);
if (result3.value !== "restored") {
  console.log("ERROR: Expected 'restored', got", result3.value);
  process.exit(1);
}

console.log("SUCCESS: All checks passed");
`;

    fs.writeFileSync(path.join(tmpDir, "test.js"), testScript);
    fs.mkdirSync(path.join(tmpDir, "mypkg"));
    fs.writeFileSync(path.join(tmpDir, "mypkg", "package.json"), JSON.stringify({ name: "mypkg", main: "./main.js" }));
    fs.writeFileSync(path.join(tmpDir, "mypkg", "main.js"), `module.exports = { value: "main" };`);

    // Run with Node.js
    const nodeResult = Bun.spawnSync({
      cmd: ["node", "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const nodeSuccess = nodeResult.exitCode === 0;
    console.log("\n=== Node.js output ===");
    console.log(nodeResult.stdout.toString());
    if (!nodeSuccess) {
      console.log("Node.js stderr:", nodeResult.stderr.toString());
    }

    // Run with Bun
    const bunResult = Bun.spawnSync({
      cmd: [bunExe(), "test.js"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const bunSuccess = bunResult.exitCode === 0;
    console.log("\n=== Bun output ===");
    console.log(bunResult.stdout.toString());
    if (!bunSuccess) {
      console.log("Bun stderr:", bunResult.stderr.toString());
    }

    console.log("\n=== Comparison ===");
    console.log("Node.js:", nodeSuccess ? "PASS" : "FAIL");
    console.log("Bun:", bunSuccess ? "PASS" : "FAIL");

    expect(nodeSuccess).toBe(true);
    expect(bunSuccess).toBe(true);

    if (nodeSuccess !== bunSuccess) {
      throw new Error(
        `Behavior mismatch! Node.js ${nodeSuccess ? "passed" : "failed"} but Bun ${bunSuccess ? "passed" : "failed"}`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
