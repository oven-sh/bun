import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("ESM bytecode cache basic functionality", async () => {
  using dir = tempDir("esm-bytecode-test", {
    "index.js": `
      import { greeting } from "./lib.js";
      console.log(greeting);
    `,
    "lib.js": `
      export const greeting = "Hello from ESM";
    `,
  });

  // First run - should generate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(stdout1).toContain("Hello from ESM");
  expect(exitCode1).toBe(0);

  // Second run - should use cache
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(stdout2).toContain("Hello from ESM");
  expect(exitCode2).toBe(0);
});

test("ESM bytecode cache with imports/exports", async () => {
  using dir = tempDir("esm-bytecode-complex", {
    "index.js": `
      import { add, multiply } from "./math.js";
      import defaultExport from "./default.js";
      import * as utils from "./utils.js";

      console.log("add:", add(2, 3));
      console.log("multiply:", multiply(4, 5));
      console.log("default:", defaultExport);
      console.log("utils:", utils.helper());
    `,
    "math.js": `
      export function add(a, b) {
        return a + b;
      }
      export function multiply(a, b) {
        return a * b;
      }
    `,
    "default.js": `
      export default "I am default";
    `,
    "utils.js": `
      export function helper() {
        return "helper function";
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("add: 5");
  expect(stdout).toContain("multiply: 20");
  expect(stdout).toContain("default: I am default");
  expect(stdout).toContain("utils: helper function");
  expect(exitCode).toBe(0);
});

// Helper function from harness
function tempDir(prefix: string, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [filename, content] of Object.entries(files)) {
    Bun.write(join(dir, filename), content);
  }
  return {
    [Symbol.dispose]() {
      rmSync(dir, { recursive: true, force: true });
    },
    toString() {
      return dir;
    },
  };
}
