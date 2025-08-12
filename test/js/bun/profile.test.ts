import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("--profile flag creates profile file", async () => {
  const dir = tempDirWithFiles("profile-test", {
    "script.js": `
console.log("Starting script");

// Simulate some work
function fibonacci(n) {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Do some computation to generate profile data
const result = fibonacci(25);
console.log("Fibonacci result:", result);

// Add some async work
await new Promise(resolve => setTimeout(resolve, 100));

console.log("Script completed");
`,
  });

  const profileFile = join(dir, "test-profile.json");

  // Ensure profile file doesn't exist before test
  if (existsSync(profileFile)) {
    rmSync(profileFile);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), `--profile=${profileFile}`, "script.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Fibonacci result:");
  expect(stdout).toContain("Script completed");
  // Profile success message can be in either stdout or stderr
  const combinedOutput = stdout + stderr;
  expect(combinedOutput).toContain("Profile data written to:");
  expect(combinedOutput).toContain(profileFile);

  // Verify profile file was created
  expect(existsSync(profileFile)).toBe(true);

  // Verify profile file contains valid .cpuprofile JSON format
  const profileData = JSON.parse(readFileSync(profileFile, "utf8"));

  // Check required .cpuprofile fields
  expect(profileData).toHaveProperty("nodes");
  expect(profileData).toHaveProperty("startTime");
  expect(profileData).toHaveProperty("endTime");
  expect(profileData).toHaveProperty("samples");
  expect(profileData).toHaveProperty("timeDeltas");

  expect(Array.isArray(profileData.nodes)).toBe(true);
  expect(Array.isArray(profileData.samples)).toBe(true);
  expect(Array.isArray(profileData.timeDeltas)).toBe(true);
  expect(profileData.nodes.length).toBeGreaterThan(0);
  expect(profileData.samples.length).toBeGreaterThan(0);

  // Verify node structure
  const rootNode = profileData.nodes[0];
  expect(rootNode).toHaveProperty("id");
  expect(rootNode).toHaveProperty("callFrame");
  expect(rootNode.callFrame).toHaveProperty("functionName");
  expect(rootNode.callFrame.functionName).toBe("(root)");

  // Check for fibonacci function in nodes
  const fibonacciNode = profileData.nodes.find(n => n.callFrame && n.callFrame.functionName === "fibonacci");
  expect(fibonacciNode).toBeDefined();
});

test("--profile flag with default filename", async () => {
  const dir = tempDirWithFiles("profile-default-test", {
    "simple.js": `
console.log("Simple test");

// Some work to profile
for (let i = 0; i < 10000; i++) {
  Math.sqrt(i);
}

console.log("Done");
`,
  });

  const defaultProfileFile = join(dir, "profile.json");

  // Ensure profile file doesn't exist before test
  if (existsSync(defaultProfileFile)) {
    rmSync(defaultProfileFile);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--profile", "simple.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Simple test");
  expect(stdout).toContain("Done");
  // Profile success message can be in either stdout or stderr
  const combinedOutput = stdout + stderr;
  expect(combinedOutput).toContain("Profile data written to:");
  expect(combinedOutput).toContain("profile.json");

  // Verify default profile file was created
  expect(existsSync(defaultProfileFile)).toBe(true);

  // Verify it's valid .cpuprofile JSON
  const profileData = JSON.parse(readFileSync(defaultProfileFile, "utf8"));
  expect(profileData).toHaveProperty("nodes");
  expect(profileData).toHaveProperty("samples");
  expect(Array.isArray(profileData.nodes)).toBe(true);
});

test("--profile works with script that throws error", async () => {
  const dir = tempDirWithFiles("profile-error-test", {
    "error.js": `
console.log("Starting error test");

// Some work before error
function work() {
  for (let i = 0; i < 1000; i++) {
    Math.sqrt(i);
  }
}

work();

// This will throw an error
throw new Error("Test error");
`,
  });

  const profileFile = join(dir, "error-profile.json");

  // Ensure profile file doesn't exist before test
  if (existsSync(profileFile)) {
    rmSync(profileFile);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), `--profile=${profileFile}`, "error.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1); // Should exit with error code
  expect(stdout).toContain("Starting error test");

  // Profile file should still be created even on error
  expect(existsSync(profileFile)).toBe(true);

  // Verify it's valid .cpuprofile JSON
  const profileData = JSON.parse(readFileSync(profileFile, "utf8"));
  expect(profileData).toHaveProperty("nodes");
  expect(Array.isArray(profileData.nodes)).toBe(true);
});

test("--profile works with async script", async () => {
  const dir = tempDirWithFiles("profile-async-test", {
    "async.js": `
console.log("Starting async test");

async function asyncWork() {
  // Some CPU work without setTimeout to avoid timing issues
  for (let i = 0; i < 10000; i++) {
    Math.sin(i);
  }
  return "async work done";
}

const result = await asyncWork();
console.log(result);
`,
  });

  const profileFile = join(dir, "async-profile.json");

  // Ensure profile file doesn't exist before test
  if (existsSync(profileFile)) {
    rmSync(profileFile);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), `--profile=${profileFile}`, "async.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("async work done");
  // Profile success message can be in either stdout or stderr
  const combinedOutput = stdout + stderr;
  expect(combinedOutput).toContain("Profile data written to:");

  // Verify profile file was created
  expect(existsSync(profileFile)).toBe(true);

  // Verify it's valid .cpuprofile JSON
  const profileData = JSON.parse(readFileSync(profileFile, "utf8"));
  expect(profileData).toHaveProperty("nodes");
  expect(Array.isArray(profileData.nodes)).toBe(true);

  // Should have some profiling data from the async work
  expect(profileData.nodes.length).toBeGreaterThan(1);
});
