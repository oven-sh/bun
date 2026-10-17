import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../aot/run-programs";
import { test } from "../aot/supported";

// A mention of `module` through which a name made at run time could reach the module loader makes `--aot` compile every built-in module
// with the program: megabytes, and seconds of build. Asking whether the file is the main one, or whether hot reloading is on, is no such
// mention.

const programs: Record<string, string> = {
  "plain.cjs": `console.log("run");`,
  "asks-for-its-parent.cjs": `if (!module.parent) console.log("run");`,
  "compares-its-parent.cjs": `if (module.parent === null || module.parent == undefined) console.log("run");`,
  "reads-the-name-of-its-parent.cjs": `console.log(module.parent && module.parent.filename ? "required" : "run");`,
  "asks-for-hot-reloading.cjs": `if (module.hot) module.hot.accept();\nconsole.log("run");`,
  "defines-its-exports.cjs": `Object.defineProperty(module, "exports", { enumerable: true, get() { return {}; } });\nconsole.log("run");`,
  "compares-module-with-null.cjs": `if (typeof module !== "undefined" && module != null) module.exports = {};\nconsole.log("run");`,
  "tests-module.cjs": `if (module && module.exports) module.exports = {};\nconsole.log(module ? "run" : "");`,
  "tests-require.cjs": `console.log(typeof require === "function" && require != null && require ? "run" : "");`,
  "reads-the-constructor.cjs": `module.exports = String(module.constructor._findPath).indexOf("preserveSymlinks") >= 0;\nconsole.log("run");`,
};

const inExecutablesOnly: Record<string, string> = {
  "keeps-module-in-a-variable.cjs": `var freeModule = typeof module == "object" && module && !module.nodeType && module;\nconsole.log(freeModule ? "run" : "");`,
  "hands-module-on.cjs": `console.log(Object.keys(module).length > 0 ? "run" : "");`,
};

test("tests of module.parent and module.hot do not bring every built-in module into the executable", async () => {
  const all = { ...programs, ...inExecutablesOnly };
  using dir = tempDir("builtin-modules-of-a-small-program", all);
  const sizes: Record<string, number> = {};
  await Promise.all(
    Object.keys(all).map(entry =>
      slot(async () => {
        const outfile = join(String(dir), entry + ".out");
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
        expect({ entry, stderr, exitCode }).toEqual({
          entry,
          stderr: expect.not.stringContaining("error"),
          exitCode: 0,
        });
        await using proc = Bun.spawn({
          cmd: [outfile],
          cwd: String(dir),
          env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, ranWith] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect({ entry, stdout, ranWith }).toEqual({ entry, stdout: "run\n", ranWith: 0 });
        sizes[entry] = statSync(outfile).size;
      }),
    ),
  );
  for (const entry of Object.keys(all)) {
    expect({ entry, grows: sizes[entry] - sizes["plain.cjs"] > 64 * 1024 }).toEqual({ entry, grows: false });
  }
}, 120_000);

test("nor do they make bun run --aot compile every built-in module", async () => {
  using dir = tempDir("builtin-modules-of-a-small-program", programs);
  const seconds: Record<string, number> = {};
  for (const entry of Object.keys(programs)) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--debug-aot", entry],
      cwd: String(dir),
      env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ entry, stdout, exitCode }).toEqual({ entry, stdout: "run\n", exitCode: 0 });
    seconds[entry] = Number(proc.resourceUsage()!.cpuTime.total) / 1e6;
  }
  for (const entry of Object.keys(programs)) {
    expect({
      entry,
      seconds: seconds[entry],
      plain: seconds["plain.cjs"],
      costsAsMuchAsADoor: seconds[entry] > 3 * seconds["plain.cjs"],
    }).toEqual({
      entry,
      seconds: expect.any(Number),
      plain: expect.any(Number),
      costsAsMuchAsADoor: false,
    });
  }
}, 120_000);
