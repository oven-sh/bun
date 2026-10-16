import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";

// A mention of `module` through which a name made at run time could reach the module loader makes `--aot` compile every built-in module
// with the program: megabytes, and seconds of build. Asking whether the file is the main one, or whether hot reloading is on, is no such
// mention.

const programs: Record<string, string> = {
  "plain.cjs": `console.log("run");`,
  "asks-for-its-parent.cjs": `if (!module.parent) console.log("run");`,
  "compares-its-parent.cjs": `if (module.parent === null || module.parent == undefined) console.log("run");`,
  "reads-the-name-of-its-parent.cjs": `console.log(module.parent && module.parent.filename ? "required" : "run");`,
  "asks-for-hot-reloading.cjs": `if (module.hot) module.hot.accept();\nconsole.log("run");`,
};

test("tests of module.parent and module.hot do not bring every built-in module into the executable", async () => {
  using dir = tempDir("builtin-modules-of-a-small-program", programs);
  const sizes: Record<string, number> = {};
  for (const entry of Object.keys(programs)) {
    const outfile = join(String(dir), entry + ".out");
    await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    await using proc = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, ranWith] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ entry, stdout, ranWith }).toEqual({ entry, stdout: "run\n", ranWith: 0 });
    sizes[entry] = statSync(outfile).size;
  }
  for (const entry of Object.keys(programs)) {
    expect({ entry, grows: sizes[entry] - sizes["plain.cjs"] > 64 * 1024 }).toEqual({ entry, grows: false });
  }
}, 120_000);
