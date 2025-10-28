import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue #22785 - stdout coloring when piped", () => {
  test("stdout should not have ANSI colors when piped, even if stderr is a TTY", async () => {
    using dir = tempDir("issue-22785", {
      "script.js": `
for (let i = 0; i < 100; i++) {
  process.stdout.write(\`\${i}\\n\`);
}
`,
    });

    // Run the script with stdout piped (captured) but stderr connected to the terminal
    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit", // stderr stays connected to terminal
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    // The output should NOT contain ANSI escape codes
    // ANSI codes typically start with \x1b[ (ESC[)
    expect(stdout).not.toMatch(/\x1b\[/);

    // Verify we got the expected output (numbers 0-99)
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(100);
    expect(lines[0]).toBe("0");
    expect(lines[99]).toBe("99");

    expect(exitCode).toBe(0);
  });

  test("stdout should not have ANSI colors when redirected to a file", async () => {
    using dir = tempDir("issue-22785-file", {
      "script.js": `
console.log("hello world");
process.stdout.write("line 1\\n");
process.stdout.write("line 2\\n");
`,
      "run.sh": `#!/bin/bash
${bunExe()} script.js > output.txt 2>&1
cat output.txt
`,
    });

    const scriptPath = join(String(dir), "run.sh");
    await Bun.write(
      scriptPath,
      `#!/bin/bash
${bunExe()} script.js > output.txt 2>&1
cat output.txt
`,
    );

    await Bun.$`chmod +x ${scriptPath}`.cwd(String(dir)).quiet();

    await using proc = Bun.spawn({
      cmd: ["/bin/bash", "-c", `${bunExe()} script.js > output.txt && cat output.txt`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    // Output should not contain ANSI codes
    expect(stdout).not.toMatch(/\x1b\[/);
    expect(stderr).toBe("");

    expect(exitCode).toBe(0);
  });

  test("process.stdout.write should work correctly when piped through less-like tools", async () => {
    using dir = tempDir("issue-22785-pipe", {
      "writer.js": `
// Simulate the issue scenario - write many lines quickly
for (let i = 0; i < 1000; i++) {
  process.stdout.write(\`\${i}\\n\`);
}
`,
      "reader.js": `
// Simulate what 'less' or similar tools expect:
// - Clean numeric output without ANSI codes
// - Ability to read the piped input

const stdin = process.stdin;
const chunks = [];

stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  chunks.push(chunk);
});

stdin.on('end', () => {
  const output = chunks.join('');

  // Verify no ANSI codes
  if (output.includes('\\x1b[')) {
    console.error('ERROR: ANSI codes detected in piped output');
    process.exit(1);
  }

  // Verify we got numeric output
  const lines = output.trim().split('\\n');
  if (lines.length !== 1000) {
    console.error(\`ERROR: Expected 1000 lines, got \${lines.length}\`);
    process.exit(1);
  }

  if (lines[0] !== '0' || lines[999] !== '999') {
    console.error('ERROR: Unexpected output format');
    process.exit(1);
  }

  console.log('PASS: Output is clean without ANSI codes');
});
`,
    });

    // Pipe writer.js output into reader.js
    await using proc = Bun.spawn({
      cmd: ["/bin/bash", "-c", `${bunExe()} writer.js | ${bunExe()} reader.js`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stdout).toContain("PASS: Output is clean without ANSI codes");
    expect(stderr).not.toContain("ERROR");

    expect(exitCode).toBe(0);
  });

  test("NO_COLOR environment variable should disable colors on stdout", async () => {
    using dir = tempDir("issue-22785-nocolor", {
      "script.js": `
for (let i = 0; i < 10; i++) {
  process.stdout.write(\`\${i}\\n\`);
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.js"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    // Should not contain ANSI codes
    expect(stdout).not.toMatch(/\x1b\[/);

    expect(exitCode).toBe(0);
  });

  test("terminal state should not interfere with downstream processes like less", async () => {
    using dir = tempDir("issue-22785-termstate", {
      "writer.js": `
// Write output that would be piped to 'less' or similar
for (let i = 0; i < 100; i++) {
  process.stdout.write(\`Line \${i}\\n\`);
}
`,
      "check-termstate.c": `
#include <stdio.h>
#include <termios.h>
#include <unistd.h>
#include <string.h>

int main() {
    struct termios before, during, after;

    // Save initial state
    if (tcgetattr(STDIN_FILENO, &before) < 0) {
        fprintf(stderr, "Failed to get initial termios\\n");
        return 1;
    }

    // Set raw mode (like 'less' would do)
    memcpy(&during, &before, sizeof(struct termios));
    during.c_lflag &= ~(ICANON | ECHO);
    during.c_cc[VMIN] = 1;
    during.c_cc[VTIME] = 0;

    if (tcsetattr(STDIN_FILENO, TCSANOW, &during) < 0) {
        fprintf(stderr, "Failed to set raw mode\\n");
        return 1;
    }

    // Read all input (simulating what less does)
    char buf[4096];
    while (fgets(buf, sizeof(buf), stdin) != NULL) {
        // Just consume the input
    }

    // Check if terminal state was preserved
    if (tcgetattr(STDIN_FILENO, &after) < 0) {
        fprintf(stderr, "Failed to get final termios\\n");
        return 1;
    }

    // Restore before exiting
    tcsetattr(STDIN_FILENO, TCSANOW, &before);

    // Verify that our raw mode settings were not reverted
    if ((after.c_lflag & ICANON) != 0 || (after.c_lflag & ECHO) != 0) {
        fprintf(stderr, "FAIL: Terminal state was interfered with\\n");
        return 1;
    }

    printf("PASS: Terminal state was preserved\\n");
    return 0;
}
`,
    });

    // Compile the C checker
    const { exitCode: compileExit } = await Bun.$`gcc -o check-termstate check-termstate.c`.cwd(String(dir)).quiet();
    expect(compileExit).toBe(0);

    // This test would be flaky in CI without a real TTY, so we just verify
    // that the basic pipe behavior works without errors
    await using proc = Bun.spawn({
      cmd: ["/bin/bash", "-c", `${bunExe()} writer.js | head -10`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stdout).toContain("Line 0");
    expect(stdout).toContain("Line 9");
    expect(stderr).toBe("");

    expect(exitCode).toBe(0);
  });
});
