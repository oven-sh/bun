// The stage that binds modules took 4.4 s on one processor in the build of a large application's tests, and its one line in the stage log did not
// say where. With the stage log each of its steps has a line: the time on the clock, and the processors' time of all threads together.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

async function build(env: Record<string, string>) {
  using dir = tempDir("aot-steps-of-binding", {
    "main.ts": `import { a } from "./a";\nconsole.log(a);\n`,
    "a.ts": `export * from "./b";\n`,
    "b.ts": `export const a = 1;\nexport const unused = 2;\n`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  expect(exitCode).toBe(0);
  return stderr.split("\n").filter(line => line.startsWith("AOT stage step | "));
}

test("with the stage log, and only with it", async () => {
  const lines = await build({ BUN_JSC_logAOTPhaseTimes: "1" });
  for (const step of [
    // Three quarters of a build of 4,000 packages lay here, and the stage had no line of its own.
    "Load | a round of the load | find_code_that_starts_workers",
    "BindModules | application | bind_modules, all of it",
    "BindModules | runtime | bind_modules, all of it",
    "BindModules | bind_modules | resolve_exports",
    "BindModules | resolve_exports | solve",
    "BindModules | application | find_left_out_code",
    "BindModules | find_left_out_code | Walk::run",
    "BindModules | application | finish_plan",
    // The last stage of the front end, which the first result waits for in every layer of a test run.
    "LinkAndEmit | stage | link_while, all of it",
    "LinkAndEmit | link | LinkMoveDefinitionsNanoseconds",
    "LinkAndEmit | link, beside the rest of its step | build_module_records",
    "LinkAndEmit | behind the link | what was loaded is let go",
    "LinkAndEmit | emit | the program is written, the sessions are dropped",
  ]) {
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^AOT stage step \\| ${step.replaceAll("|", "\\|")} \\| wall [0-9.]+ ms \\| cpu [0-9]+ ms( \\| instructions [0-9.]+ M)?$`,
        ),
      ),
    );
  }
  expect(await build({})).toEqual([]);
}, 120_000);

// The walk that finds what no code reaches goes on one thread. Where it is run a second time, from nothing, the log says why.
test("why the walk for what is left out runs again", async () => {
  using dir = tempDir("aot-why-the-walk-runs-again", {
    "main.cjs": `const tree = { parent: null, children: [] };\nconsole.log(tree.parent, tree.children.length, require("./b.cjs").m);\nglobalThis.keep = module;\n`,
    "b.cjs": `exports.m = 1;\n`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "main"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  expect(stderr.split("\n").filter(line => line.startsWith("AOT walk for what is left out runs again"))).toEqual([
    "AOT walk for what is left out runs again | a module object is out of sight, and files name `children` and `parent`",
  ]);
  expect(exitCode).toBe(0);
}, 120_000);
