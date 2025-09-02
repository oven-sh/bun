import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("concurrent dynamic imports with top-level await should not trigger temporal dead zone", async () => {
  // Create a module with top-level await
  const dir = tempDirWithFiles("concurrent-import-test", {
    "test-module.js": `
import { setTimeout } from "node:timers/promises";

await setTimeout(10);

export function someFunction() {
  return "some function";
}

export const someArray = [];
`,
    "test-concurrent-imports.js": `
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleUrl = join(__dirname, "test-module.js");

async function loadDynamicModule(importIndex) {
  try {
    console.log(\`Starting import \${importIndex}\`);
    const module = await import(moduleUrl);
    console.log(\`Import \${importIndex} completed\`);

    try {
      const keys = Object.keys(module);
      console.log(\`Access \${importIndex}: \${JSON.stringify(keys)}\`);
      // Try to access the exports to ensure they're not in temporal dead zone
      const result = module.someFunction();
      const arr = module.someArray;
      return { success: true, index: importIndex, keys };
    } catch (err) {
      console.error(\`Access \${importIndex} failed: \${err.message}\`);
      return { success: false, index: importIndex, error: err.message };
    }
  } catch (error) {
    console.error(\`Import \${importIndex} failed: \${error.message}\`);
    return { success: false, index: importIndex, error: error.message };
  }
}

const results = [];
try {
  const imports = Array.from({ length: 5 }, (_, i) => {
    const importIndex = i + 1;
    return loadDynamicModule(importIndex).then(result => {
      results.push(result);
    });
  });

  await Promise.all(imports);
  
  // Output results as JSON for easier parsing
  console.log("RESULTS:" + JSON.stringify(results));
} catch (error) {
  console.error("Test failed:", error);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--bun", "test-concurrent-imports.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Parse the results from stdout
  const resultsLine = stdout.split("\n").find(line => line.startsWith("RESULTS:"));
  expect(resultsLine).toBeDefined();
  
  const results = JSON.parse(resultsLine!.substring("RESULTS:".length));
  
  // All imports should succeed
  expect(results).toHaveLength(5);
  for (let i = 0; i < 5; i++) {
    const result = results[i];
    expect(result.success).toBe(true);
    expect(result.keys).toEqual(["someArray", "someFunction"]);
  }
  
  // Check that there are no temporal dead zone errors in stderr
  expect(stderr).not.toContain("temporal dead zone");
  expect(stderr).not.toContain("Cannot access");
});

test("concurrent dynamic imports with synchronous module should work", async () => {
  // Test with a synchronous module to ensure we didn't break the normal case
  const dir = tempDirWithFiles("concurrent-import-sync-test", {
    "sync-module.js": `
export function syncFunction() {
  return "sync function";
}

export const syncValue = 42;
`,
    "test-sync-imports.js": `
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleUrl = join(__dirname, "sync-module.js");

async function loadModule(index) {
  const module = await import(moduleUrl);
  return {
    index,
    keys: Object.keys(module),
    value: module.syncValue,
    fn: module.syncFunction()
  };
}

const results = await Promise.all([
  loadModule(1),
  loadModule(2),
  loadModule(3),
  loadModule(4),
  loadModule(5)
]);

console.log("RESULTS:" + JSON.stringify(results));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--bun", "test-sync-imports.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  const resultsLine = stdout.split("\n").find(line => line.startsWith("RESULTS:"));
  expect(resultsLine).toBeDefined();
  
  const results = JSON.parse(resultsLine!.substring("RESULTS:".length));
  
  expect(results).toHaveLength(5);
  for (let i = 0; i < 5; i++) {
    const result = results[i];
    expect(result.keys).toEqual(["syncFunction", "syncValue"]);
    expect(result.value).toBe(42);
    expect(result.fn).toBe("sync function");
  }
});

test("concurrent imports with different delays should all succeed", async () => {
  const dir = tempDirWithFiles("concurrent-import-delays-test", {
    "delayed-module.js": `
import { setTimeout } from "node:timers/promises";

// Random delay between 5-50ms
const delay = Math.floor(Math.random() * 45) + 5;
await setTimeout(delay);

export const loadTime = Date.now();
export function getValue() {
  return "loaded";
}
`,
    "test-delayed-imports.js": `
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleUrl = join(__dirname, "delayed-module.js");

async function loadWithDelay(index, delay) {
  // Add artificial delay before import
  await new Promise(resolve => setTimeout(resolve, delay));
  
  const module = await import(moduleUrl);
  return {
    index,
    delay,
    value: module.getValue(),
    loadTime: module.loadTime
  };
}

const results = await Promise.all([
  loadWithDelay(1, 0),
  loadWithDelay(2, 10),
  loadWithDelay(3, 20),
  loadWithDelay(4, 30),
  loadWithDelay(5, 40)
]);

console.log("RESULTS:" + JSON.stringify(results));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--bun", "test-delayed-imports.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  const resultsLine = stdout.split("\n").find(line => line.startsWith("RESULTS:"));
  expect(resultsLine).toBeDefined();
  
  const results = JSON.parse(resultsLine!.substring("RESULTS:".length));
  
  expect(results).toHaveLength(5);
  
  // All imports should get the same module (same loadTime)
  const firstLoadTime = results[0].loadTime;
  for (let i = 0; i < 5; i++) {
    const result = results[i];
    expect(result.value).toBe("loaded");
    expect(result.loadTime).toBe(firstLoadTime);
  }
});