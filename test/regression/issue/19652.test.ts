import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bun build --production does not crash", async () => {
  const dir = tempDirWithFiles("19652", {
    "tsconfig.json": "{}",
    "index.js": `console.log("hello");`,
  });

  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "build", "index.js", "--production"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderrText = stderr.toString();
  const stdoutText = stdout.toString();

  expect(exitCode).toBe(0);
  expect(stderrText).not.toContain("panic");
  expect(stderrText).not.toContain("assertion failure");
  expect(stdoutText).toContain("console.log");
});
