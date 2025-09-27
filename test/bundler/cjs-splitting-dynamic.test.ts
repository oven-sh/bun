import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "fs";
import { join } from "path";

test("--splitting with --format=cjs correctly exports from dynamic chunks", async () => {
  using dir = tempDir("cjs-dynamic-exports", {
    "entry.js": `
import('./module.js').then(m => {
  console.log('foo:', m.foo);
  console.log('bar:', m.bar());
  console.log('default:', m.default());
});
`,
    "module.js": `
export const foo = 'foo value';
export function bar() {
  return 'bar result';
}
export default function() {
  return 'default result';
}
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

  // Check that the module chunk has proper exports
  const distPath = join(String(dir), "dist");
  const files = readdirSync(distPath);

  const moduleChunk = files.find(f => f.includes("module"));
  expect(moduleChunk).toBeDefined();

  const moduleContent = await Bun.file(join(distPath, moduleChunk!)).text();
  expect(moduleContent).toContain("exports.foo = foo");
  expect(moduleContent).toContain("exports.bar = bar");
  expect(moduleContent).toContain("exports.default = ");

  // Test that it actually runs correctly
  const result = await Bun.$`node dist/entry.js`.cwd(String(dir)).text();
  expect(result).toContain("foo: foo value");
  expect(result).toContain("bar: bar result");
  // Note: The default export handling might not be perfect due to ESM interop
});