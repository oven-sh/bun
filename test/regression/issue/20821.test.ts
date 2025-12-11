import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/20821
// Standalone executables with 8+ embedded files would silently exit without running
// because the entry point was incorrectly identified when multiple files were passed
// to `bun build --compile`.
test("compile with 8+ embedded files runs correctly", async () => {
  using dir = tempDir("issue-20821", {
    "app.js": `console.log("IT WORKS", Bun.embeddedFiles.length);`,
    "assets/file-1": "",
    "assets/file-2": "",
    "assets/file-3": "",
    "assets/file-4": "",
    "assets/file-5": "",
    "assets/file-6": "",
    "assets/file-7": "",
    "assets/file-8": "",
  });

  // Build the executable with 8 embedded files
  await using buildProc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "app.js",
      "assets/file-1",
      "assets/file-2",
      "assets/file-3",
      "assets/file-4",
      "assets/file-5",
      "assets/file-6",
      "assets/file-7",
      "assets/file-8",
      "--outfile=app",
    ],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, , buildExitCode] = await Promise.all([buildProc.stdout.text(), buildProc.stderr.text(), buildProc.exited]);

  expect(buildExitCode).toBe(0);

  // Run the compiled executable
  await using runProc = Bun.spawn({
    cmd: [String(dir) + "/app"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

  expect(stdout.trim()).toBe("IT WORKS 8");
  expect(exitCode).toBe(0);
});
