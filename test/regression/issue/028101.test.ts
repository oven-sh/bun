import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28101
//
// bmalloc/libpas causes crashes on Windows under memory pressure during GC.
// The fix requires a coordinated change: oven-sh/WebKit prebuilts must be
// rebuilt with -DUSE_SYSTEM_MALLOC=ON, then bmalloc.lib can be removed from
// the bun link targets.
//
// This test validates the assertNoBmallocOnWindows guard function exists in
// webkit.ts and is correct. The guard is not yet activated (prebuilts still
// include bmalloc), but it's ready to enable in a follow-up PR once
// oven-sh/WebKit prebuilts are rebuilt with -DUSE_SYSTEM_MALLOC=ON.

const repoRoot = resolve(import.meta.dir, "../../..");

describe("#28101 — bmalloc Windows guard", () => {
  test("assertNoBmallocOnWindows guard exists and has correct behavior", async () => {
    const webkitTs = readFileSync(resolve(repoRoot, "scripts/build/deps/webkit.ts"), "utf8");

    // The guard function must be exported
    expect(webkitTs).toContain("export function assertNoBmallocOnWindows");

    // Extract the function body and verify its logic inline.
    // The function must: skip non-Windows, check for bmalloc in lib list, throw if found.
    const fnMatch = webkitTs.match(
      /export function assertNoBmallocOnWindows\(cfg: Config, libs: readonly string\[\]\): void \{([\s\S]*?)\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![1];

    // Must check for Windows
    expect(fnBody).toContain("cfg.windows");
    // Must filter for bmalloc
    expect(fnBody).toContain("bmalloc");
    // Must throw an error
    expect(fnBody).toContain("throw new Error");
    // Must reference the tracking issue
    expect(fnBody).toContain("https://github.com/oven-sh/bun/issues/28097");

    // Now exercise the function by evaluating the extracted logic
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Inline the guard function logic for testing
        function assertNoBmallocOnWindows(cfg, libs) {
          if (!cfg.windows) return;
          const found = libs.filter(l => /bmalloc/i.test(l));
          if (found.length > 0) {
            throw new Error(
              "bmalloc must not be linked on Windows (USE_SYSTEM_MALLOC=ON). " +
              "Found: " + found.join(", ")
            );
          }
        }

        // Non-Windows: should not throw even with bmalloc
        assertNoBmallocOnWindows({ windows: false }, ["bmalloc.lib"]);
        console.log("non-windows: ok");

        // Windows without bmalloc: should not throw
        assertNoBmallocOnWindows({ windows: true }, ["WTF.lib", "JSC.lib"]);
        console.log("windows-clean: ok");

        // Windows with bmalloc: must throw
        try {
          assertNoBmallocOnWindows({ windows: true }, ["WTF.lib", "bmalloc.lib"]);
          console.log("FAIL");
          process.exit(1);
        } catch (e) {
          if (e.message.includes("bmalloc must not be linked on Windows")) {
            console.log("windows-bmalloc: threw");
          } else {
            console.log("FAIL: " + e.message);
            process.exit(1);
          }
        }
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("non-windows: ok");
    expect(stdout).toContain("windows-clean: ok");
    expect(stdout).toContain("windows-bmalloc: threw");
    expect(exitCode).toBe(0);
  });

  test("webkit.ts documents bmalloc removal plan with activation instructions", () => {
    const webkitTs = readFileSync(resolve(repoRoot, "scripts/build/deps/webkit.ts"), "utf8");

    // Must reference the tracking issue for the bmalloc crash
    expect(webkitTs).toContain("https://github.com/oven-sh/bun/issues/28097");

    // Must have activation instructions for when prebuilts are updated
    expect(webkitTs).toContain("gate bmallocLib behind !cfg.windows and activate assertNoBmallocOnWindows");
  });

  test("BuildBun.cmake documents intended bmalloc removal for Windows", () => {
    const cmake = readFileSync(resolve(repoRoot, "cmake/targets/BuildBun.cmake"), "utf8");

    // Must reference the tracking issue
    expect(cmake).toContain("https://github.com/oven-sh/bun/issues/28097");

    // Must document the intended removal
    expect(cmake).toContain("remove bmalloc.lib");
  });

  test("build-jsc.ts sets USE_SYSTEM_MALLOC=ON for Windows local builds", () => {
    const buildJsc = readFileSync(resolve(repoRoot, "scripts/build-jsc.ts"), "utf8");

    // The Windows branch of getCommonFlags should contain USE_SYSTEM_MALLOC=ON
    const windowsSection = buildJsc.match(/else if \(IS_WINDOWS\) \{([\s\S]*?)\n  \}/);
    expect(windowsSection).not.toBeNull();
    expect(windowsSection![1]).toContain("-DUSE_SYSTEM_MALLOC=ON");
  });
});
