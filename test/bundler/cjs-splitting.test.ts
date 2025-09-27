import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

test("--splitting works with --format=cjs", async () => {
  using dir = tempDir("cjs-splitting", {
    "entry1.js": `
import { shared } from './shared.js';
console.log('entry1', shared());
`,
    "entry2.js": `
import { shared } from './shared.js';
console.log('entry2', shared());
`,
    "shared.js": `
export function shared() {
  return 'shared value';
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "./entry1.js",
      "./entry2.js",
      "--splitting",
      "--format=cjs",
      "--outdir=dist",
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check that files were created
  const distPath = join(String(dir), "dist");
  const files = readdirSync(distPath);
  expect(files.sort()).toContain("entry1.js");
  expect(files.sort()).toContain("entry2.js");

  // The shared module should be split into its own chunk
  const hasSharedChunk = files.some(f => f.includes("chunk") || f.startsWith("entry1-"));
  expect(hasSharedChunk).toBe(true);

  // Test that the generated CJS modules work
  const entry1Result = await Bun.$`node dist/entry1.js`.cwd(String(dir)).text();
  expect(entry1Result).toContain("entry1");
  expect(entry1Result).toContain("shared value");

  const entry2Result = await Bun.$`node dist/entry2.js`.cwd(String(dir)).text();
  expect(entry2Result).toContain("entry2");
  expect(entry2Result).toContain("shared value");
});

test("--splitting with --format=cjs handles dynamic imports", async () => {
  using dir = tempDir("cjs-splitting-dynamic", {
    "entry.js": `
console.log('before import');
import('./lazy.js').then(m => {
  console.log('lazy loaded:', m.message);
});
`,
    "lazy.js": `
export const message = 'lazy module loaded';
`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "./entry.js",
      "--splitting",
      "--format=cjs",
      "--outdir=dist",
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check that files were created
  const distPath = join(String(dir), "dist");
  const files = readdirSync(distPath);
  expect(files.sort()).toContain("entry.js");

  // The lazy module should be split into its own chunk
  const hasLazyChunk = files.some(f => f.includes("lazy") || f.startsWith("entry-"));
  expect(hasLazyChunk).toBe(true);
});
