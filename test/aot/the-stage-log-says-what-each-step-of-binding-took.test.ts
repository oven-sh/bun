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
  return stderr.split("\n").filter(line => /^AOT phase times: front end \| \w+: /.test(line));
}

test("with the stage log, and only with it", async () => {
  const lines = await build({ BUN_JSC_logAOTPhaseTimes: "1" });
  for (const step of [
    "Load: the application",
    "Load: contents of the program",
    "BindModules: application: bind modules",
    "BindModules: library: bind modules",
    "BindModules: bind: resolve exports",
    "BindModules: exports: solve",
    "BindModules: reach: walk",
    "BindModules: application: finish the plan",
    "LinkAndEmit: choose definitions",
    "LinkAndEmit: number the program",
    "LinkAndEmit: what the link stage hands on",
    "LinkAndEmit: what the load drops behind the link",
    "LinkAndEmit: what the threads drop behind emit",
  ]) {
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^AOT phase times: front end \\| ${step} \\| wall [0-9.]+ ms \\| cpu [0-9.]+ ms \\| resident [0-9]+ MB \\| peak [0-9]+ MB( \\| instructions [0-9.]+ M)?$`,
        ),
      ),
    );
  }
  expect(await build({})).toEqual([]);
}, 120_000);
