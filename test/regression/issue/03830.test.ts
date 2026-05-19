import { describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe("issue/03830", () => {
  it("macros should not lead to seg faults under any given input", async () => {
    // this test code follows the same structure as and
    // is based on the code for testing issue 4893

    let testDir = tmpdirSync();

    // Clean up from prior runs if necessary
    rmSync(testDir, { recursive: true, force: true });

    // Create a directory with our test file
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "macro.ts"), "export function fn(str) { return str; }");
    writeFileSync(
      join(testDir, "index.ts"),
      "import { fn } from './macro' assert { type: 'macro' };\nfn(`©${Number(0)}`);",
    );
    testDir = realpathSync(testDir);

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

  it("nested Bun.Transpiler in a macro then import() does not free the printer", async () => {
    // The macro's Bun.Transpiler#transformSync drops a nested MacroContext via
    // TranspilerStateGuard, which calls __bun_macro_context_deinit. On a
    // bundler-worker thread the macro was the first SOURCE_CODE_PRINTER
    // allocator; freeing it here would panic the subsequent module fetch.
    let testDir = tmpdirSync();
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "helper.ts"), "export const value = 42;");
    writeFileSync(
      join(testDir, "macro.ts"),
      `export async function nested() {
  new Bun.Transpiler().transformSync("const a = 1;");
  const mod = await import("./helper.ts");
  return mod.value;
}`,
    );
    writeFileSync(
      join(testDir, "index.ts"),
      "import { nested } from './macro.ts' with { type: 'macro' };\nconsole.log(nested());",
    );
    testDir = realpathSync(testDir);

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
