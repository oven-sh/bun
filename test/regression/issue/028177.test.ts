import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28177
// ASAN use-after-poison in TranspilerJob when module fulfillment
// triggers new transpilation that recycles the same HiveArray slot.
//
// The fix defers store.put() in TranspilerJob.runFromJSThread() until
// after AsyncModule.fulfill() completes, preventing premature slot
// recycling while the C++ fulfill stack is still active.

test("chained static imports do not cause use-after-poison in TranspilerJob pool", async () => {
  // Create a chain of modules where each module's evaluation triggers
  // importing the next module. This exercises the TranspilerJob pool
  // slot recycling during fulfill().
  const chainLength = 70; // exceed HiveArray capacity of 64 to stress the pool
  const files: Record<string, string> = {};

  // Build a chain: mod_0 imports mod_1, mod_1 imports mod_2, etc.
  for (let i = 0; i < chainLength - 1; i++) {
    files[`mod_${i}.ts`] = `export { value } from "./mod_${i + 1}.ts";`;
  }
  files[`mod_${chainLength - 1}.ts`] = `export const value = 42;`;

  // Entry point that starts the chain
  files["index.ts"] = `
    import { value } from "./mod_0.ts";
    console.log(JSON.stringify({ value }));
  `;

  using dir = tempDir("issue-28177", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe('{"value":42}');
  expect(exitCode).toBe(0);
});

test("concurrent dynamic imports stress TranspilerJob pool recycling", async () => {
  // Multiple independent dynamic imports that all resolve concurrently,
  // stressing the pool with many put/get cycles during fulfill.
  const moduleCount = 80;
  const files: Record<string, string> = {};

  for (let i = 0; i < moduleCount; i++) {
    files[`dep_${i}.ts`] = `export const id = ${i};`;
  }

  // Dynamically import all modules concurrently
  const imports = Array.from(
    { length: moduleCount },
    (_, i) => `import("./dep_${i}.ts")`,
  ).join(",\n    ");

  files["index.ts"] = `
    const results = await Promise.all([
      ${imports}
    ]);
    const ids = results.map(m => m.id);
    console.log(JSON.stringify(ids));
  `;

  using dir = tempDir("issue-28177-concurrent", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  const expected = Array.from({ length: moduleCount }, (_, i) => i);
  expect(JSON.parse(stdout.trim())).toEqual(expected);
  expect(exitCode).toBe(0);
});
