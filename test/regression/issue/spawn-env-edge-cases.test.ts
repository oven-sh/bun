import { spawn } from "bun";
import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test edge cases with environment variables

test("spawn with empty key in env should not hang", async () => {
  try {
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: { ...bunEnv, "": "empty key" },
      stdout: "pipe",
    });
    await proc.exited;
  } catch (e) {
    // Expected
  }
}, 3000);

test("spawn with null byte in env value should not hang", async () => {
  try {
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: { ...bunEnv, KEY: "\u0000" },
      stdout: "pipe",
    });
    await proc.exited;
  } catch (e) {
    // Expected
  }
}, 3000);

test("spawn with null byte in env key should not hang", async () => {
  try {
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: { ...bunEnv, "KEY\u0000": "value" },
      stdout: "pipe",
    });
    await proc.exited;
  } catch (e) {
    // Expected
  }
}, 3000);

test("spawn with unicode in env should not hang", async () => {
  try {
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: { ...bunEnv, "🚀": "rocket" },
      stdout: "pipe",
    });
    await proc.exited;
  } catch (e) {
    // Expected
  }
}, 3000);

test("spawn with many env vars should not hang", async () => {
  try {
    const manyEnvVars = Object.fromEntries(
      Array(100)
        .fill(0)
        .map((_, i) => [`K${i}`, `V${i}`]),
    );
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: { ...bunEnv, ...manyEnvVars },
      stdout: "pipe",
    });
    await proc.exited;
  } catch (e) {
    // Expected
  }
}, 5000);
