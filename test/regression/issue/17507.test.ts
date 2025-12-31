import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("DevServer: de-emphasize node_modules frames in stack traces", () => {
  test("console output dims node_modules frames differently than user frames", () => {
    // Create a test project with a node_modules dependency that throws an error
    using dir = tempDir("devserver-deemphasize", {
      "node_modules/my-lib/package.json": JSON.stringify({
        name: "my-lib",
        type: "module",
        main: "index.js",
      }),
      "node_modules/my-lib/index.js": `
export function throwError() {
  innerThrow();
}
function innerThrow() {
  throw new Error("Error from node_modules");
}
      `,
      "index.ts": `
import { throwError } from "my-lib";

function userCode() {
  throwError();
}

userCode();
      `,
      "package.json": JSON.stringify({
        name: "test-app",
        type: "module",
        dependencies: {
          "my-lib": "*",
        },
      }),
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "index.ts")],
      env: {
        ...bunEnv,
        FORCE_COLOR: "1", // Enable ANSI colors
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderrStr = stderr.toString();

    // The process should fail with an error
    expect(exitCode).not.toBe(0);

    // Check that we have both user code and node_modules frames in the stack trace
    expect(stderrStr).toContain("userCode");
    expect(stderrStr).toContain("node_modules");

    // Split into lines to analyze ANSI formatting per frame
    const lines = stderrStr.split("\n");

    // Find stack trace lines (start with "at ")
    // Use regex to strip ANSI codes for matching, but keep original for assertion
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

    // Find user code frame (contains "userCode" and starts with whitespace + "at ")
    const userCodeLine = lines.find(
      (l) => stripAnsi(l).trim().startsWith("at ") && l.includes("userCode")
    );
    // Find node_modules frame (contains "/node_modules/" or "\\node_modules\\" path in stack trace)
    // Handle both Unix and Windows path separators
    const nodeModulesLine = lines.find(
      (l) =>
        stripAnsi(l).trim().startsWith("at ") &&
        (l.includes("/node_modules/") || l.includes("\\node_modules\\"))
    );

    expect(userCodeLine).toBeDefined();
    expect(nodeModulesLine).toBeDefined();

    // ANSI escape codes:
    // \x1b[0m = reset
    // \x1b[2m = dim
    //
    // User code frames should have reset after "at " to highlight function name:
    //   "at \x1b[0m<functionName>\x1b[2m"
    //
    // Library frames should stay dim after "at " (no reset):
    //   "at <functionName> (<file>)" all in dim mode

    // User frame pattern: "at " followed by reset (\x1b[0m) before function name
    // This indicates the function name is highlighted (not dim)
    const userFrameHasHighlight = userCodeLine!.includes("at \x1b[0m");

    // Library frame should NOT have a reset after "at " - it stays dim
    // The entire line after "at " should be in dim mode
    const libraryFrameStaysDim = !nodeModulesLine!.includes("at \x1b[0m");

    expect(userFrameHasHighlight).toBe(true);
    expect(libraryFrameStaysDim).toBe(true);
  });

  test("web overlay CSS includes library-frame class with opacity", async () => {
    const cssFile = Bun.file(
      new URL("../../../src/bake/client/overlay.css", import.meta.url).pathname
    );
    const css = await cssFile.text();

    // Check for library-frame class with opacity (not color override)
    expect(css).toContain(".library-frame");
    expect(css).toContain("opacity: 0.5");
  });

  test("overlay.ts uses path separator boundaries for node_modules detection", async () => {
    const tsFile = Bun.file(
      new URL("../../../src/bake/client/overlay.ts", import.meta.url).pathname
    );
    const ts = await tsFile.text();

    // Check for proper path boundary detection (not just substring match)
    expect(ts).toContain("/node_modules/");
    expect(ts).toContain("\\\\node_modules\\\\");
    expect(ts).toContain('startsWith("node_modules/")');
  });
});
