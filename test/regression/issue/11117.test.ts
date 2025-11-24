import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/11117
// On Windows, Bun.write() to stdout in a loop would produce scrambled output
// because async writes were not serialized properly.
test("Bun.write to stdout maintains write order", async () => {
  const testString = "This is a test\n";

  // Run the test multiple times to catch any race conditions
  for (let run = 0; run < 10; run++) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const test = (s) => { const l = s.length; for (let i = 0; i < l; i++) { Bun.write(Bun.stdout, s[i]); } }; test(${JSON.stringify(testString)});`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toBe(testString);
    expect(exitCode).toBe(0);
  }
});

test("Bun.write to stderr maintains write order", async () => {
  const testString = "Error message test\n";

  // Run the test multiple times to catch any race conditions
  for (let run = 0; run < 10; run++) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const test = (s) => { const l = s.length; for (let i = 0; i < l; i++) { Bun.write(Bun.stderr, s[i]); } }; test(${JSON.stringify(testString)});`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toBe("");
    expect(stderr).toBe(testString);
    expect(exitCode).toBe(0);
  }
});
