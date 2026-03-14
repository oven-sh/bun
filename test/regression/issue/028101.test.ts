import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/28101
//
// bmalloc/libpas causes crashes on Windows under memory pressure during GC.
// The fix requires a coordinated change: oven-sh/WebKit prebuilts must be
// rebuilt with -DUSE_SYSTEM_MALLOC=ON, then bmalloc.lib can be removed from
// the bun link targets.
//
// This test validates:
//  1. The assertNoBmallocOnWindows guard exists in webkit.ts, ready to activate.
//  2. build-jsc.ts already sets USE_SYSTEM_MALLOC=ON for local Windows builds.
//  3. BuildBun.cmake documents the intended bmalloc removal.
//
// Once oven-sh/WebKit prebuilts are rebuilt with -DUSE_SYSTEM_MALLOC=ON,
// a follow-up PR should:
//  - Remove bmalloc.lib from BuildBun.cmake Windows link targets
//  - Gate bmallocLib(cfg) behind !cfg.windows in webkit.ts provides()
//  - Call assertNoBmallocOnWindows() from provides()
//  - Update this test to assert bmalloc is absent from the Windows config

const repoRoot = resolve(import.meta.dir, "../../..");

describe("#28101 — no bmalloc on Windows", () => {
  test("webkit.ts exports assertNoBmallocOnWindows guard", () => {
    const webkitTsPath = resolve(repoRoot, "scripts/build/deps/webkit.ts");
    const content = readFileSync(webkitTsPath, "utf8");

    // The guard function must be exported and ready to activate
    expect(content).toContain("export function assertNoBmallocOnWindows");
    // It must reference the tracking issue
    expect(content).toContain("https://github.com/oven-sh/bun/issues/28097");
  });

  test("build-jsc.ts sets USE_SYSTEM_MALLOC=ON for Windows local builds", () => {
    const buildJscPath = resolve(repoRoot, "scripts/build-jsc.ts");
    const content = readFileSync(buildJscPath, "utf8");

    // The Windows branch of getCommonFlags should contain USE_SYSTEM_MALLOC=ON
    const windowsSection = content.match(/else if \(IS_WINDOWS\) \{([\s\S]*?)\n  \}/);
    expect(windowsSection).not.toBeNull();
    expect(windowsSection![1]).toContain("-DUSE_SYSTEM_MALLOC=ON");
  });

  test("BuildBun.cmake documents intended bmalloc removal for Windows", () => {
    const cmakePath = resolve(repoRoot, "cmake/targets/BuildBun.cmake");
    const content = readFileSync(cmakePath, "utf8");

    // The cmake file must contain a comment documenting the intended fix,
    // referencing the tracking issue.
    expect(content).toContain("https://github.com/oven-sh/bun/issues/28097");
  });
});
