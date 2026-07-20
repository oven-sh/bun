import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";

// Asserts that `bun build --compile --sourcemap` embeds an InternalSourceMap
// blob and that stack frames in the compiled executable remap to the correct
// original `file:line:col` for both the throw site and a caller in another
// source file.
test("compile --sourcemap remaps stack frames to original line:col", async () => {
  using dir = tempDir("compile-ism", {
    "util.ts": [
      "type T = number;",
      "",
      "export function boom(): never {",
      "  const x: T = 1;",
      '  throw new Error("boom" + x);', // line 5
      "}",
      "",
    ].join("\n"),
    "ismapp.ts": [
      'import { boom } from "./util";',
      "",
      "function main() {",
      "  boom();", // line 4
      "}",
      "",
      "try {",
      "  main();",
      "} catch (e) {",
      "  console.error((e as Error).stack);",
      "}",
      "",
    ].join("\n"),
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "ismapp.ts")],
    compile: { outfile: join(String(dir), "ismapp") },
    sourcemap: "inline",
  });
  expect(result.success).toBe(true);
  const exe = result.outputs.find(o => o.kind === "entry-point")!.path;

  await using proc = Bun.spawn({
    cmd: [exe],
    env: {
      ...bunEnv,
      // Debug ASAN builds embed an @executable_path rpath for asan-dyld-shim.dylib;
      // the copied standalone exe lives elsewhere, so point dyld back at the
      // original build dir so the shim resolves on macOS debug builds.
      DYLD_FALLBACK_LIBRARY_PATH: dirname(bunExe()),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("util.ts:5:");
  expect(stderr).toContain("ismapp.ts:4:");
  expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);
  expect(exitCode).toBe(0);
}, 60_000);
