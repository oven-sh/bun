import { describe, expect, it } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue/03830", () => {
  // First test stays sequential: `toMatchSnapshot()` is not supported in
  // concurrent tests (Bun's test runner rejects it). The second test has no
  // snapshot matcher, so it runs `.concurrent` per test/CLAUDE.md.
  it("macros should not lead to seg faults under any given input", async () => {
    // this test code follows the same structure as and
    // is based on the code for testing issue 4893

    using dir = tempDir("issue-03830", {
      "macro.ts": "export function fn(str) { return str; }",
      "index.ts": "import { fn } from './macro' assert { type: 'macro' };\nfn(`©${Number(0)}`);",
    });
    const testDir = realpathSync(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", join(testDir, "index.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr.trim().replaceAll(testDir, "[dir]").replaceAll("\\", "/")).toMatchSnapshot();
    expect(exitCode).toBe(1);
  });

  it.concurrent.each([
    // [name, where transformSync+import() runs in macro.ts]
    ["inside the exported macro fn", "fn-body"],
    ["at macro-module top level", "top-level"],
  ])("nested Bun.Transpiler %s then import() inside a macro works under bun build", async (_, where) => {
    // A `Bun.Transpiler` used inside the macro VM, followed by a module load
    // there, while `bun build` (no runtime VM of its own) waits on the macro.
    const macroTs =
      where === "top-level"
        ? `new Bun.Transpiler().transformSync("const a = 1;");
const mod = await import("./helper.ts");
export function nested() { return mod.value; }`
        : `export async function nested() {
  new Bun.Transpiler().transformSync("const a = 1;");
  const mod = await import("./helper.ts");
  return mod.value;
}`;
    using dir = tempDir("issue-03830-nested", {
      "helper.ts": "export const value = 42;",
      "macro.ts": macroTs,
      "index.ts": "import { nested } from './macro.ts' with { type: 'macro' };\nconsole.log(nested());",
    });
    const testDir = realpathSync(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", join(testDir, "index.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("console.log(42)");
    expect(exitCode).toBe(0);
  });
});
