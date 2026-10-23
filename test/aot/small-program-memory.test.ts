import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

test("compiling and running a one-line program takes little memory", async () => {
  using folder = tempDir("aot-memory-of-small-programs", { "program.ts": `console.log("one line");\n` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--debug-aot", "program.ts"],
    cwd: String(folder),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "one line\n", exitCode: 0 });
  expect(proc.resourceUsage()!.maxRSS).toBeLessThan((isDebug || isASAN ? 1500 : 300) * 1024 * 1024);
});
