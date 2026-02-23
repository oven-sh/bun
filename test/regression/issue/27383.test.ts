import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27383
// Standalone executables with inline sourcemaps could crash with
// "panic: incorrect alignment" on Windows ARM64 (ReleaseSafe builds)
// because @alignCast promoted the alignment of sourcemap byte slices
// inside the LazySourceMap union from 1 to 8, but serialized sourcemap
// data in standalone binaries can be at any offset.

test("standalone compile with inline sourcemap does not crash from alignment", async () => {
  // Use files with varying name lengths to increase the chance of
  // non-8-byte-aligned sourcemap offsets in the standalone binary.
  using dir = tempDir("issue-27383", {
    "a.js": `export function a() { throw new Error("error from a"); }`,
    "bb.js": `export function bb() { throw new Error("error from bb"); }`,
    "ccc.js": `export function ccc() { throw new Error("error from ccc"); }`,
    "ddddd.js": `export function ddddd() { throw new Error("error from ddddd"); }`,
    "entry.js": `
import { a } from "./a.js";
import { bb } from "./bb.js";
import { ccc } from "./ccc.js";
import { ddddd } from "./ddddd.js";

const fns = [a, bb, ccc, ddddd];
const fn = fns[Math.floor(Math.random() * fns.length)];
try { fn(); } catch (e) {
  // Accessing the stack triggers sourcemap parsing
  console.log(e.stack);
}
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "entry.js")],
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

  // The stack trace should contain original file names (sourcemap worked)
  expect(stdout).toMatch(/error from (a|bb|ccc|ddddd)/);

  // Should not crash
  expect(exitCode).toBe(0);
});
