import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";

// This test is only applicable on Linux where explicit ld.so invocation is possible
const isLinux = process.platform === "linux";

// Skip the entire test file on non-Linux platforms
test.skipIf(!isLinux)("compiled executable works with BUN_SELF_EXE override", async () => {
  using dir = tempDir("issue-26752", {
    "hello.js": `console.log("Hello from compiled Bun!");`,
  });

  // Compile the script into an executable
  await using compileProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "hello.js", "--outfile", "hello"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, compileStderr, compileExitCode] = await Promise.all([
    compileProc.stdout.text(),
    compileProc.stderr.text(),
    compileProc.exited,
  ]);

  expect(compileStderr).toBe("");
  expect(compileExitCode).toBe(0);

  const executablePath = `${dir}/hello`;
  expect(existsSync(executablePath)).toBe(true);

  // First, verify the executable works directly
  await using directProc = Bun.spawn({
    cmd: [executablePath],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [directStdout, directStderr, directExitCode] = await Promise.all([
    directProc.stdout.text(),
    directProc.stderr.text(),
    directProc.exited,
  ]);

  expect(directStdout.trim()).toBe("Hello from compiled Bun!");
  expect(directStderr).toBe("");
  expect(directExitCode).toBe(0);

  // Find the dynamic linker (supports both x86_64 and aarch64)
  const ldPaths = [
    "/lib64/ld-linux-x86-64.so.2",
    "/lib/ld-linux-x86-64.so.2",
    "/lib/ld-linux-aarch64.so.1",
    "/lib64/ld-linux-aarch64.so.1",
  ];
  const ldPath = ldPaths.find(p => existsSync(p)) ?? null;

  // Skip the ld.so test if we can't find the linker
  if (!ldPath) {
    console.log("Skipping ld.so test: dynamic linker not found");
    return;
  }

  // Now test with explicit ld.so invocation and BUN_SELF_EXE override
  await using ldProc = Bun.spawn({
    cmd: [ldPath, executablePath],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_SELF_EXE: executablePath,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [ldStdout, ldStderr, ldExitCode] = await Promise.all([
    ldProc.stdout.text(),
    ldProc.stderr.text(),
    ldProc.exited,
  ]);

  expect(ldStdout.trim()).toBe("Hello from compiled Bun!");
  expect(ldStderr).toBe("");
  expect(ldExitCode).toBe(0);
});
