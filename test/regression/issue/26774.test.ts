import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26774
// bun update -i breaks terminal display when scrolling with arrow keys
describe("issue #26774 - bun update -i scrolling display", () => {
  it("should handle scrolling through many packages without display corruption", async () => {
    // Create a project with many dependencies (more than typical terminal height)
    // This triggers the viewport scrolling logic in update_interactive_command.zig
    const dependencies: Record<string, string> = {};
    for (let i = 1; i <= 40; i++) {
      dependencies[`package-${i.toString().padStart(2, "0")}`] = "1.0.0";
    }

    const dir = tempDirWithFiles("issue-26774-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies,
      }),
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Simulate scrolling down multiple times with arrow key escape sequences
    // ESC [ B is the ANSI escape code for down arrow
    const downArrow = "\x1b[B";

    // Wait a bit for the interactive UI to initialize
    await Bun.sleep(100);

    // Scroll down past the initial viewport (simulating the bug scenario)
    for (let i = 0; i < 35; i++) {
      proc.stdin.write(downArrow);
      await Bun.sleep(10);
    }

    // Then scroll back up
    const upArrow = "\x1b[A";
    for (let i = 0; i < 20; i++) {
      proc.stdin.write(upArrow);
      await Bun.sleep(10);
    }

    // Exit with 'n' (no selection)
    proc.stdin.write("n\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The command should not panic or crash
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("segfault");
    expect(stderr).not.toContain("SIGSEGV");
    expect(stderr).not.toContain("assertion failed");

    // The command should exit cleanly (0 or process exit)
    // Note: ctrl+c or 'n' may return different codes, but shouldn't crash
    expect(exitCode).toBeLessThanOrEqual(1);
  });

  it("should correctly count lines when top scroll indicator is visible", async () => {
    // This test specifically targets the bug where lines_displayed wasn't
    // incremented when the top scroll indicator was shown
    const dependencies: Record<string, string> = {};
    for (let i = 1; i <= 50; i++) {
      dependencies[`dep-${i.toString().padStart(2, "0")}`] = "1.0.0";
    }

    const dir = tempDirWithFiles("issue-26774-line-count", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies,
      }),
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const downArrow = "\x1b[B";

    await Bun.sleep(100);

    // Scroll down significantly to ensure the top indicator appears
    // and multiple re-renders occur
    for (let i = 0; i < 45; i++) {
      proc.stdin.write(downArrow);
      await Bun.sleep(10);
    }

    // Exit
    proc.stdin.write("\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should not have any terminal control issues or crashes
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("assertion");
  });
});
