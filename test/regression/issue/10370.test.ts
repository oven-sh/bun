import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

test("bun build --no-bundle --outdir should output files correctly - issue #10370", async () => {
  using dir = tempDir("10370-no-bundle-outdir", {
    "index.ts": `console.log("hello from typescript");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts", "--no-bundle", "--outdir", "./dist"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
  
  // Verify the output file exists
  const distDir = join(String(dir), "dist");
  expect(existsSync(distDir)).toBe(true);
  
  const files = readdirSync(distDir);
  expect(files).toContain("index.js");
});

test("bun build --no-bundle --outdir should handle .tsx extension - issue #10370", async () => {
  using dir = tempDir("10370-no-bundle-outdir-tsx", {
    "App.tsx": `export function App() { return <div>Hello</div>; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./App.tsx", "--no-bundle", "--outdir", "./out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
  
  // Verify the output file exists
  const outDir = join(String(dir), "out");
  expect(existsSync(outDir)).toBe(true);
  
  const files = readdirSync(outDir);
  expect(files).toContain("App.js");
});
