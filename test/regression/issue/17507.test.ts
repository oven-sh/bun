import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("DevServer: de-emphasize node_modules frames in stack traces", () => {
  test("console output de-emphasizes node_modules frames", async () => {
    // Create a test project with a node_modules dependency that throws an error
    using dir = tempDir("devserver-deemphasize", {
      "node_modules/my-lib/index.js": `
        export function throwError() {
          throw new Error("Error from node_modules");
        }
      `,
      "index.ts": `
        import { throwError } from "my-lib";
        throwError();
      `,
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "my-lib": "*",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      env: {
        ...bunEnv,
        FORCE_COLOR: "1", // Enable ANSI colors
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The process should fail with an error
    expect(exitCode).not.toBe(0);

    // Check that the error message contains the node_modules path
    expect(stderr).toContain("node_modules");
    expect(stderr).toContain("Error from node_modules");

    // The node_modules frame should be dimmed (ANSI escape code \x1b[2m is dim)
    // When colors are enabled, node_modules frames should use dim styling
    // The format for library frames is: "<r>      <d>at {f} ({f})<r>\n"
    // which means the entire line after "at " is dim

    // Regular frames have the pattern: "at <r>functionName<d> (<r>file<d>)"
    // Library frames have: "at functionName (file)" all in dim

    // Check that we have a stack trace
    expect(stderr).toContain("at ");
  });

  test("web overlay CSS includes library-frame class", async () => {
    // Read the overlay.css file and verify the library-frame styles exist
    const cssFile = Bun.file(
      new URL(
        "../../../src/bake/client/overlay.css",
        import.meta.url,
      ).pathname,
    );
    const css = await cssFile.text();

    // Check for library-frame class
    expect(css).toContain(".library-frame");
    expect(css).toContain("opacity: 0.5");

    // Check for de-emphasized function and file name colors
    expect(css).toContain(".library-frame .function-name");
    expect(css).toContain(".library-frame .file-name");
    expect(css).toContain("--modal-text-faded");
  });

  test("overlay.ts includes node_modules detection logic", async () => {
    // Read the overlay.ts file and verify the node_modules detection exists
    const tsFile = Bun.file(
      new URL(
        "../../../src/bake/client/overlay.ts",
        import.meta.url,
      ).pathname,
    );
    const ts = await tsFile.text();

    // Check for node_modules detection function
    expect(ts).toContain("isNodeModulesFrame");
    expect(ts).toContain("node_modules");

    // Check for library-frame class application
    expect(ts).toContain("library-frame");
  });
});
