import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { slot } from "../aot/run-programs";
import { test } from "../aot/supported";

// An executable holds the built-in modules that are imported by a constant name. A mention of `module` brings none with it: not where the
// file asks whether it is the main one or whether hot reloading is on, and not where `module` goes into a variable. The yardstick is a
// program that requires six of them by name: megabytes, and seconds of build.

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

const withSixModules = "requires-six-by-name.cjs";
const yardstick = {
  [withSixModules]: `console.log([require("node:zlib"), require("node:http"), require("node:repl"), require("node:dgram"), require("node:readline"), require("node:child_process")].every(Boolean) ? "run" : "");`,
};

test("tests of module.parent and module.hot bring no built-in module into the executable", async () => {
  const all = { ...programs, ...inExecutablesOnly, ...yardstick };
  using dir = tempDir("builtin-modules-of-a-small-program", all);
  const sizes: Record<string, number> = {};
  await Promise.all(
    Object.keys(all).map(entry =>
      slot(async () => {
        const outfile = join(String(dir), entry + ".exe");
        const { stderr, exitCode } = await run(
          [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile],
          String(dir),
        );
        expect({ entry, stderr, exitCode }).toEqual({
          entry,
          stderr: expect.not.stringContaining("error"),
          exitCode: 0,
        });
        const { stdout, exitCode: ranWith } = await run([outfile], String(dir), {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect({ entry, stdout, ranWith }).toEqual({ entry, stdout: "run\n", ranWith: 0 });
        sizes[entry] = statSync(outfile).size;
      }),
    ),
  );
  const sixModules = sizes[withSixModules] - sizes["plain.cjs"];
  expect(sixModules).toBeGreaterThan(1024 * 1024);
  for (const entry of Object.keys(all).filter(entry => entry !== withSixModules)) {
    expect({ entry, grows: sizes[entry] - sizes["plain.cjs"] > sixModules / 2 }).toEqual({ entry, grows: false });
  }
}, 120_000);

test("nor do they make bun run --aot compile built-in modules", async () => {
  using dir = tempDir("builtin-modules-of-a-small-program", { ...programs, ...yardstick });
  const seconds: Record<string, number> = {};
  for (const entry of [...Object.keys(programs), withSixModules]) {
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
  // Where Bun itself is slow to start, that is most of every time here.
  const start = Math.min(...Object.values(seconds));
  for (const entry of Object.keys(programs)) {
    expect({
      entry,
      seconds: seconds[entry],
      withSixModules: seconds[withSixModules],
      costsAsMuchAsADoor: seconds[entry] - start > (seconds[withSixModules] - start) / 4,
    }).toEqual({
      entry,
      seconds: expect.any(Number),
      withSixModules: expect.any(Number),
      costsAsMuchAsADoor: false,
    });
  }
}, 120_000);
