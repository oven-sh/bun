import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("import.meta should not appear in CJS bundles (issue #22642)", async () => {
  using dir = tempDir("issue-22642", {
    "src/index.ts": `
      // This code will cause import.meta to appear in the bundle
      // when bundling @sentry/bun or similar packages
      const needsEsmLoader = typeof module !== "undefined" && module.register;
      if (needsEsmLoader) {
        module.register("some-loader", import.meta.url);
      }
      console.log("test");
    `,
  });

  // Bundle to CJS format
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./src/index.ts", "--outdir", "dist", "--format", "cjs", "--target", "bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Now try to run the bundled file
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "./dist/index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  // The bundled CJS file should run without errors
  expect(runExitCode).toBe(0);
  expect(runStderr).not.toContain("TypeError: Expected CommonJS module to have a function wrapper");
  expect(runStdout).toContain("test");
});
