import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Release builds embed a precompiled bytecode blob for the builtin JS modules
// (see src/jsc/bindings/InternalBuiltinBytecode.cpp). When it is present, every
// builtin required at startup must decode from it (no misses). Debug and
// cross-compiled builds have no blob (available: false) and are skipped.
test("builtin modules load from the embedded bytecode cache", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--expose-internals",
      "-e",
      `require("node:http"); require("node:fs"); require("node:crypto");
       const stats = require("bun:internal-for-testing").builtinBytecodeCacheStats();
       console.log(JSON.stringify(stats));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stats = JSON.parse(stdout.trim());
  if (stats.available) {
    expect(stats.misses).toBe(0);
    expect(stats.hits).toBeGreaterThan(20);
  } else {
    expect(stats.hits).toBe(0);
  }
  expect(exitCode).toBe(0);
});
