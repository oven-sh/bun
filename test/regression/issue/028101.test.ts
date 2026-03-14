import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/28101
// bmalloc/libpas causes crashes on Windows under memory pressure during GC.
// Windows prebuilts must use system malloc (USE_SYSTEM_MALLOC=ON) and not
// link bmalloc.

const repoRoot = resolve(import.meta.dir, "../../..");

describe("#28101 — no bmalloc on Windows", () => {
  test("BuildBun.cmake does not link bmalloc.lib on Windows", () => {
    const cmakePath = resolve(repoRoot, "cmake/targets/BuildBun.cmake");
    const content = readFileSync(cmakePath, "utf8");

    // Extract the WIN32 block (between `if(WIN32)` and `else()`)
    const win32Match = content.match(/if\(WIN32\)([\s\S]*?)^else\(\)/m);
    expect(win32Match).not.toBeNull();
    const win32Block = win32Match![1];

    // bmalloc.lib must NOT appear in the Windows link targets
    expect(win32Block).not.toContain("bmalloc.lib");
  });

  test("webkit.ts does not include bmalloc in Windows prebuilt libs", () => {
    const webkitTsPath = resolve(repoRoot, "scripts/build/deps/webkit.ts");
    const content = readFileSync(webkitTsPath, "utf8");

    // The provides function should gate bmalloc behind !cfg.windows.
    // Verify the guard exists: `const needsBmalloc = !cfg.windows;`
    expect(content).toContain("const needsBmalloc = !cfg.windows");

    // Verify bmalloc is conditional, not unconditionally added.
    // The old code had: `const libs = [...coreLibs(cfg), ...prebuiltIcuLibs(cfg), bmallocLib(cfg)]`
    // The new code should NOT have bmallocLib(cfg) directly in the array spread.
    expect(content).not.toMatch(/\[\.\.\.coreLibs\(cfg\),\s*\.\.\.prebuiltIcuLibs\(cfg\),\s*bmallocLib\(cfg\)\]/);
  });

  test("webkit.ts exports assertNoBmallocOnWindows guard", () => {
    const webkitTsPath = resolve(repoRoot, "scripts/build/deps/webkit.ts");
    const content = readFileSync(webkitTsPath, "utf8");

    // Verify the guard function is exported
    expect(content).toContain("export function assertNoBmallocOnWindows");
  });

  test("build-jsc.ts sets USE_SYSTEM_MALLOC=ON for Windows local builds", () => {
    const buildJscPath = resolve(repoRoot, "scripts/build-jsc.ts");
    const content = readFileSync(buildJscPath, "utf8");

    // The Windows branch of getCommonFlags should contain USE_SYSTEM_MALLOC=ON
    // Extract: `} else if (IS_WINDOWS) { ... }`
    const windowsSection = content.match(/else if \(IS_WINDOWS\) \{([\s\S]*?)\n  \}/);
    expect(windowsSection).not.toBeNull();
    expect(windowsSection![1]).toContain("-DUSE_SYSTEM_MALLOC=ON");
  });
});
