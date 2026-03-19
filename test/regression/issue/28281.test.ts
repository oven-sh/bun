import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("standalone binary works when invoked via dynamic linker", async () => {
  using dir = tempDir("standalone-ld-linux", {
    "hello.js": `console.log("Hello from standalone!");`,
  });

  // Build standalone binary
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", `${dir}/hello.js`, "--outfile", `${dir}/hello`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStderr, buildExitCode] = await Promise.all([buildProc.stderr.text(), buildProc.exited]);
  expect(buildExitCode).toBe(0);

  // Find the dynamic linker by reading the ELF interpreter from the compiled binary
  await using readelfProc = Bun.spawn({
    cmd: ["readelf", "-l", `${dir}/hello`],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [readelfStdout, readelfExitCode] = await Promise.all([readelfProc.stdout.text(), readelfProc.exited]);
  expect(readelfExitCode).toBe(0);

  const interpreterMatch = readelfStdout.match(/\[Requesting program interpreter: (.+?)\]/);
  expect(interpreterMatch).not.toBeNull();
  const ldPath = interpreterMatch![1];

  // Run via dynamic linker
  await using ldProc = Bun.spawn({
    cmd: [ldPath, `${dir}/hello`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [ldStdout, ldStderr, ldExitCode] = await Promise.all([
    ldProc.stdout.text(),
    ldProc.stderr.text(),
    ldProc.exited,
  ]);

  expect(ldStdout).toContain("Hello from standalone!");
  expect(ldExitCode).toBe(0);
});
