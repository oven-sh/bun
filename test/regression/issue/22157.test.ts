import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/22157
// Compiled binaries were including executable name in process.argv
test("issue 22157: compiled binary should not include executable name in process.argv", async () => {
  const dir = tempDirWithFiles("22157-basic", {
    "index.js": /* js */ `
      import { parseArgs } from "node:util"
      
      console.log(JSON.stringify(process.argv));
      
      // This should work - no extra executable name should cause parseArgs to throw
      parseArgs({
        args: process.argv.slice(2),
      });
      
      console.log("SUCCESS");
    `,
  });

  // Compile the binary
  await using compileProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--outfile=test-binary", "./index.js"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await compileProc.exited;

  // Run the compiled binary - should not throw
  await using runProc = Bun.spawn({
    cmd: ["./test-binary"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([runProc.stdout.text(), runProc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");

  // Verify process.argv structure
  const argvMatch = stdout.match(/\[.*?\]/);
  expect(argvMatch).toBeTruthy();

  const processArgv = JSON.parse(argvMatch![0]);
  expect(processArgv).toHaveLength(2);
  expect(processArgv[0]).toBe("bun");
  // Windows uses "B:/~BUN/root/", Unix uses "/$bunfs/root/"
  expect(processArgv[1]).toMatch(/(\$bunfs|~BUN).*root/);
});

test("issue 22157: compiled binary with user args should pass them correctly", async () => {
  const dir = tempDirWithFiles("22157-args", {
    "index.js": /* js */ `
      console.log(JSON.stringify(process.argv));
      
      // Expect: ["bun", "/$bunfs/root/..." or "B:/~BUN/root/...", "arg1", "arg2"]
      if (process.argv.length !== 4) {
        console.error("Expected 4 argv items, got", process.argv.length);
        process.exit(1);
      }
      
      if (process.argv[2] !== "arg1" || process.argv[3] !== "arg2") {
        console.error("User args not correct");
        process.exit(1);
      }
      
      console.log("SUCCESS");
    `,
  });

  await using compileProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--outfile=test-binary", "./index.js"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await compileProc.exited;

  await using runProc = Bun.spawn({
    cmd: ["./test-binary", "arg1", "arg2"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([runProc.stdout.text(), runProc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");
});
