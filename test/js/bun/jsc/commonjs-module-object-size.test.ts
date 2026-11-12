import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("the object of a CommonJS module is no larger than it was", async () => {
  using dir = tempDir("commonjs-module-object-size", {
    "main.cjs": `console.log(require("bun:jsc").estimateShallowMemoryUsageOf(module));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ size: Number(stdout) <= 162 ? "at most 162" : stdout, stderr, exitCode }).toEqual({
    size: "at most 162",
    stderr: "",
    exitCode: 0,
  });
});
