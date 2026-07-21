// Covers the shared helper that both jsc-stress.test.ts and
// scripts/verify-baseline.ts use to spawn JSC stress fixtures. Keeps
// verify-baseline's Nehalem skip list in sync with the fixtures: if a new
// wasm fixture starts using v128 and isn't listed, or a listed one stops,
// this test fails.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "path";
import { parseJSCFlags, wasmSIMDFixtures } from "./jsc-flags";

const fixturesDir = path.join(import.meta.dir, "fixtures");
const wasmFixturesDir = path.join(fixturesDir, "wasm");
const preloadPath = path.join(import.meta.dir, "preload.js");
// Same headroom jsc-stress.test.ts gives debug builds for JIT tier-up loops.
const fixtureTimeout = isDebug ? 180_000 : undefined;

describe("parseJSCFlags", () => {
  test("runDefaultWasm", () => {
    expect(parseJSCFlags(path.join(wasmFixturesDir, "bbq-osr-with-exceptions.js"))).toEqual({
      BUN_JSC_useDollarVM: "1",
      BUN_JSC_jitPolicyScale: "0.1",
    });
  });

  test("runDefault", () => {
    expect(parseJSCFlags(path.join(wasmFixturesDir, "omg-tail-call-clobber-scratch-register.js"))).toEqual({
      BUN_JSC_jitPolicyScale: "0",
    });
  });

  test("runFTLNoCJIT implies useFTLJIT / !useConcurrentJIT", () => {
    expect(parseJSCFlags(path.join(fixturesDir, "licm-no-pre-header.js"))).toEqual({
      BUN_JSC_useFTLJIT: "true",
      BUN_JSC_useConcurrentJIT: "false",
      BUN_JSC_createPreHeaders: "false",
    });
  });

  test("no directive", () => {
    expect(parseJSCFlags(path.join(wasmFixturesDir, "ipint-bbq-osr-with-try2.js"))).toEqual({});
  });
});

// verify-baseline.ts emulates a Nehalem CPU (no AVX) on x64. JSC's
// recomputeDependentOptions() sets `useWasmSIMD = false` there, which makes
// v128 an invalid type and any module declaring one fail to parse. Assert
// wasmSIMDFixtures lists exactly those fixtures, so the verify-baseline
// skip list stays correct as fixtures are added or changed.
describe.concurrent("wasmSIMDFixtures matches fixtures that require wasm SIMD", () => {
  const allWasmFixtures = readdirSync(wasmFixturesDir)
    .filter(f => f.endsWith(".js"))
    .sort();

  test("every listed fixture exists on disk", () => {
    const onDisk = new Set(allWasmFixtures);
    for (const f of wasmSIMDFixtures) expect(onDisk.has(f)).toBe(true);
  });

  for (const fixture of allWasmFixtures) {
    test(
      fixture,
      async () => {
        const fixturePath = path.join(wasmFixturesDir, fixture);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--preload", preloadPath, fixturePath],
          // Simulate the Nehalem path: no AVX => JSC disables wasm SIMD.
          env: { ...bunEnv, ...parseJSCFlags(fixturePath), BUN_JSC_useWasmSIMD: "false" },
          cwd: wasmFixturesDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        if (wasmSIMDFixtures.has(fixture)) {
          // Must fail to parse with the characteristic error; if it passes, it
          // no longer needs SIMD and should be removed from wasmSIMDFixtures.
          expect(stderr).toContain("WebAssembly.Module doesn't parse");
          expect(exitCode).not.toBe(0);
        } else {
          // Must pass without SIMD; if it fails with a parse error, add it to
          // wasmSIMDFixtures so verify-baseline skips it under Nehalem.
          if (exitCode !== 0) {
            console.log("stdout:", stdout);
            console.log("stderr:", stderr);
          }
          expect(exitCode).toBe(0);
        }
      },
      fixtureTimeout,
    );
  }
});
