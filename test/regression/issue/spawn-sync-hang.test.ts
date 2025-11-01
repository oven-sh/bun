import { spawnSync } from "bun";
import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for hangs in spawnSync

test("spawnSync with null byte in stdin should not hang", () => {
  const inputs = [Buffer.from("\u0000"), Buffer.from("test\u0000test"), new Uint8Array([0])];

  for (const input of inputs) {
    try {
      const result = spawnSync({
        cmd: [bunExe(), "-e", "console.log('ok')"],
        stdin: input,
        env: bunEnv,
      });
    } catch (e) {
      // Expected
    }
  }
}, 5000);

test("spawnSync with empty stdin should not hang", () => {
  const result = spawnSync({
    cmd: [bunExe(), "-e", "console.log('ok')"],
    stdin: new Uint8Array(0),
    env: bunEnv,
  });
}, 5000);

test("spawnSync with large stdin should not hang", () => {
  try {
    const result = spawnSync({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      stdin: new Uint8Array(10000).fill(65),
      env: bunEnv,
    });
  } catch (e) {
    // Expected
  }
}, 5000);
