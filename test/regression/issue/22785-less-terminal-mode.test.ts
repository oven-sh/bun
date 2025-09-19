import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Test for GitHub issue #22785
// `bun script.js | less` sometimes causes terminal input to `less` to be line-buffered
test.skip("piping to less should not interfere with terminal mode", async () => {
  // This test is skipped by default because:
  // 1. It requires the 'less' command to be installed
  // 2. It requires an interactive terminal
  // 3. The issue is intermittent (~10% occurrence rate)
  //
  // To run this test manually:
  // bun test test/regression/issue/22785-less-terminal-mode.test.ts

  const dir = tmpdir();
  const scriptPath = join(dir, "test-script.js");

  // Create a script that outputs many lines
  const scriptContent = `
    for (let i = 0; i < 1000; i++) {
      process.stdout.write(\`\${i}\\n\`);
    }
  `;
  writeFileSync(scriptPath, scriptContent);

  // Test multiple times since the issue is intermittent
  const attempts = 50;
  let failureCount = 0;

  for (let i = 0; i < attempts; i++) {
    // Run bun piped to less and send 'q' to quit
    // If the bug occurs, less will require Enter after 'q'
    const proc = Bun.spawn({
      cmd: ["sh", "-c", `echo q | ${bunExe()} ${scriptPath} | less`],
      env: { ...bunEnv, TERM: "xterm" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
    ]);

    // If 'q' appears in stdout, it means less didn't quit immediately
    // and displayed the 'q' character (bug occurred)
    if (stdout.includes("q")) {
      failureCount++;
    }

    await proc.exited;
  }

  // The bug should not occur with our fix
  expect(failureCount).toBe(0);
});

// Test that stderr being redirected prevents the issue (as reported)
test.skip("piping to less with stderr redirected should work", async () => {
  const dir = tmpdir();
  const scriptPath = join(dir, "test-script.js");

  const scriptContent = `
    for (let i = 0; i < 100; i++) {
      process.stdout.write(\`\${i}\\n\`);
    }
  `;
  writeFileSync(scriptPath, scriptContent);

  // With stderr redirected, the issue should never occur
  const proc = Bun.spawn({
    cmd: ["sh", "-c", `echo q | ${bunExe()} ${scriptPath} 2>/dev/null | less`],
    env: { ...bunEnv, TERM: "xterm" },
    stdout: "pipe",
  });

  const stdout = await proc.stdout.text();
  await proc.exited;

  // 'q' should not appear in output
  expect(stdout).not.toContain("q");
});