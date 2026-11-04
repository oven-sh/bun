import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// The strings of a bytecode executable are roots that a full collection marks from the start of the table.
test("verifyGC accepts every full collection of an executable with bytecode", async () => {
  const dir = tempDir("verifier-table", {
    "app.js": `
      console.error("read once, at the top level");
      Bun.gc(true);
      setTimeout(() => {
        for (let i = 0; i < 3; i++) Bun.gc(true);
        console.log("done");
      }, 1);
    `,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--outfile", "app", "app.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildErr, buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildCode, buildOut + buildErr).toBe(0);

  await using proc = Bun.spawn({
    cmd: [join(String(dir), "app" + (isWindows ? ".exe" : ""))],
    env: { ...bunEnv, BUN_JSC_verifyGC: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim(), stderr).toBe("done");
  expect(exitCode).toBe(0);
});
