import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

// https://github.com/oven-sh/bun/issues/23647
// Test that `bun build --outdir=dist --target=browser` works without crashing
// This was crashing on Windows due to incorrect path handling in build_command.zig
test("23647 - build with outdir and browser target doesn't crash", async () => {
  using dir = tempDir("23647", {
    "index.ts": `
      import { Hono } from "hono";
      const app = new Hono();
      app.get("/hello", (c) => c.text("Hello!"));
      export default { fetch: app.fetch };
    `,
    "package.json": `{
      "name": "test-23647",
      "dependencies": {
        "hono": "^4.9.12"
      }
    }`,
  });

  // First install dependencies
  const install = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await install.exited;

  // Now run the build that was crashing on Windows
  const result = Bun.spawn({
    cmd: [bunExe(), "build", "--outdir=dist", "--target=browser", "--production", "./index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  // Should not crash - exit code should be 0
  expect(exitCode).toBe(0);
  // Should indicate successful bundling
  expect(stdout).toContain("module");
  // Should create the output directory
  const outputPath = path.join(String(dir), "dist", "index.js");
  expect(fs.existsSync(outputPath)).toBe(true);
}, 30000);
