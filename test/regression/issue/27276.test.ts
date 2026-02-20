import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27276
// Standalone compile with sourcemaps panicked on Windows due to an
// incorrect @alignCast when deserializing the embedded module graph.
// The sourcemap slice could be at a non-8-byte-aligned offset, but
// the LazySourceMap union inflated the required alignment to 8 because
// it also holds a pointer variant.
test("standalone compile with sourcemap does not panic on misaligned sourcemap data", async () => {
  // Use multiple files with varying name lengths to increase the
  // chance that the serialized sourcemap offset is not 8-byte aligned.
  using dir = tempDir("issue-27276", {
    "index.js": `
import { a } from "./a.js";
import { bc } from "./bc.js";
import { def } from "./def.js";
a();
bc();
def();
`,
    "a.js": `export function a() { return 1; }`,
    "bc.js": `export function bc() { return 2; }`,
    "def.js": `export function def() { return 3; }`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "index.js")],
    outdir: String(dir),
    compile: true,
    sourcemap: "inline",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const executablePath = result.outputs[0].path;

  await using proc = Bun.spawn({
    cmd: [executablePath],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
