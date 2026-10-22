import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";

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
    env: bunEnv,
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

// An async frame is where a function or a module waits. It remaps like a frame on the stack.
// Bytecode is CommonJS and has no top-level await, so its entry point waits in a function.
test.concurrent.each([
  { name: "a module that waits", options: {}, topLevelAwait: true },
  { name: "a module that waits, minified", options: { minify: true }, topLevelAwait: true },
  { name: "bytecode", options: { bytecode: true }, topLevelAwait: false },
])(
  "compile --sourcemap remaps async frames: $name",
  async ({ options, topLevelAwait }) => {
    using dir = tempDir("compile-ism-async", {
      "util.ts": [
        "type T = number;",
        "",
        "export async function boom(): Promise<never> {",
        "  const x: T = 1;",
        "  await 0;",
        '  throw new Error("boom" + x);', // line 6
        "}",
        "",
      ].join("\n"),
      "ismapp.ts": [
        'import { boom } from "./util";',
        "",
        "async function main() {",
        "  await boom();", // line 4
        "}",
        "",
        topLevelAwait
          ? "try {\n  await main();\n} catch (e) {\n  console.error((e as Error).stack);\n}" // the await is on line 8
          : "main().catch(e => console.error((e as Error).stack));",
        "",
      ].join("\n"),
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "ismapp.ts")],
      compile: { outfile: join(String(dir), "ismapp") },
      sourcemap: "inline",
      ...options,
    });
    expect(result.success).toBe(true);
    const exe = result.outputs.find(o => o.kind === "entry-point")!.path;

    await using proc = Bun.spawn({
      cmd: [exe],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The names of the functions are not the same after --minify: compare where each frame is,
    // without the directory.
    const frames = stderr
      .split("\n")
      .map(line => /^\s*at (async )?(?:.* \((.*)\)|(.*))$/.exec(line))
      .filter(match => match !== null)
      .map(match => (match[1] ?? "") + (match[2] ?? match[3]).replace(/^.*[\\/]/, ""));
    expect(frames).toEqual(["util.ts:6:13", "async ismapp.ts:4:9", ...(topLevelAwait ? ["async ismapp.ts:8:9"] : [])]);
    expect(exitCode).toBe(0);
  },
  60_000,
);
