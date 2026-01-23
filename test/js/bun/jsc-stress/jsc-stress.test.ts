import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

const fixturesDir = path.join(import.meta.dir, "fixtures");
const wasmFixturesDir = path.join(fixturesDir, "wasm");

const jsFixtures = [
  // FTL - Math intrinsics
  "ftl-arithsin.js",
  "ftl-arithcos.js",
  "ftl-arithsqrt.js",
  "ftl-arithtan.js",
  // FTL - String ops
  "ftl-string-equality.js",
  "ftl-string-strict-equality.js",
  "ftl-string-ident-equality.js",
  "ftl-library-substring.js",
  // FTL - RegExp
  "ftl-regexp-exec.js",
  "ftl-regexp-test.js",
  // FTL - Arguments
  "ftl-getmyargumentslength.js",
  "ftl-getmyargumentslength-inline.js",
  "ftl-get-my-argument-by-val.js",
  "ftl-get-my-argument-by-val-inlined.js",
  "ftl-get-my-argument-by-val-inlined-and-not-inlined.js",
  // FTL - Exceptions
  "ftl-call-exception.js",
  "ftl-call-exception-no-catch.js",
  "ftl-call-varargs-exception.js",
  "ftl-try-catch-arith-sub-exception.js",
  "ftl-try-catch-getter-throw.js",
  "ftl-try-catch-setter-throw.js",
  "ftl-try-catch-patchpoint-with-volatile-registers.js",
  "ftl-try-catch-varargs-call-throws.js",
  "ftl-try-catch-getter-throw-interesting-value-recovery.js",
  "ftl-get-by-id-getter-exception.js",
  "ftl-get-by-id-slow-exception.js",
  "ftl-put-by-id-setter-exception.js",
  "ftl-put-by-id-slow-exception.js",
  "ftl-operation-exception.js",
  "ftl-shr-exception.js",
  "ftl-sub-exception.js",
  "ftl-xor-exception.js",
  // FTL - Property access
  "ftl-reallocatepropertystorage.js",
  "ftl-checkin.js",
  "ftl-checkin-variable.js",
  // FTL - OSR / Numeric / Misc
  "ftl-force-osr-exit.js",
  "ftl-negate-zero.js",
  "ftl-has-a-bad-time.js",
  "ftl-materialize-new-array-buffer.js",
  "ftl-tail-call.js",
  "ftl-library-inlining-random.js",
  "ftl-library-inlining-loops.js",
  "ftl-new-negative-array-size.js",
  "ftl-in-overflow.js",
  // DFG
  "dfg-ssa-swap.js",
  "dfg-to-primitive-pass-symbol.js",
  "dfg-strength-reduction-on-mod-should-handle-INT_MIN.js",
  "dfg-put-by-val-direct-with-edge-numbers.js",
  "dfg-create-arguments-inline-alloc.js",
  "dfg-internal-function-call.js",
  "dfg-internal-function-construct.js",
  "dfg-rare-data.js",
  "dfg-ai-fold-bigint.js",
  "dfg-node-convert-to-constant-must-clear-varargs-flags.js",
  "dfg-try-catch-wrong-value-recovery-on-ic-miss.js",
  "dfg-exception-try-catch-in-constructor-with-inlined-throw.js",
  "dfg-call-class-constructor.js",
  "dfg-osr-entry-should-not-use-callframe-argument.js",
  // Allocation sinking / OSR / LICM
  "varargs-inlined-simple-exit.js",
  "loop-unrolling.js",
  "licm-no-pre-header.js",
];

const wasmFixtures = [
  // BBQ
  "bbq-fusedif-register-alloc.js",
  "bbq-osr-with-exceptions.js",
  "ipint-bbq-osr-with-try.js",
  "ipint-bbq-osr-with-try2.js",
  "ipint-bbq-osr-with-try3.js",
  "ipint-bbq-osr-with-try4.js",
  "ipint-bbq-osr-with-try5.js",
  "ipint-bbq-osr-check-try-implicit-slot-overlap.js",
  "ipint-bbq-osr-check-try-implicit-slot-overlap2.js",
  "zero-clear-bbq-address.js",
  "tail-call-should-consume-stack-in-bbq.js",
  // OMG
  "omg-recompile-from-two-bbq.js",
  "omg-osr-stack-slot-positioning.js",
  "omg-tail-call-clobber-pinned-registers.js",
  "omg-tail-call-to-function-with-less-arguments.js",
  "omg-tail-call-clobber-scratch-register.js",
  "omg-osr-stack-check-2.js",
];

const preloadPath = path.join(import.meta.dir, "preload.js");

describe("JSC JIT Stress Tests", () => {
  describe("JS (Baseline/DFG/FTL)", () => {
    for (const fixture of jsFixtures) {
      test(fixture, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--preload", preloadPath, path.join(fixturesDir, fixture)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        if (exitCode !== 0) {
          console.log("stdout:", stdout);
          console.log("stderr:", stderr);
        }
        expect(exitCode).toBe(0);
      });
    }
  });

  describe("Wasm (BBQ/OMG)", () => {
    for (const fixture of wasmFixtures) {
      test(fixture, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--preload", preloadPath, path.join(wasmFixturesDir, fixture)],
          env: bunEnv,
          cwd: wasmFixturesDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        if (exitCode !== 0) {
          console.log("stdout:", stdout);
          console.log("stderr:", stderr);
        }
        expect(exitCode).toBe(0);
      });
    }
  });
});
