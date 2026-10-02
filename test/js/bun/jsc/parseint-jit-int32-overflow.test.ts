import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// parseInt results at or above 2^31 must stay exact after the call site
// tiers up to the DFG/FTL.
//
// Regression test for a miscompile in official Linux release builds: the
// DFG's parseIntResult() (oven-sh/WebKit Source/JavaScriptCore/dfg/
// DFGOperations.cpp) did `static_cast<int>(input)` on out-of-range doubles
// — undefined behavior — and the LLVM 22 LTO backend folded the int32
// overflow guard into a bare integrality test. parseInt("80000000", 16)
// then returned -2147483648 once the function got hot, and stayed wrong
// for the life of the process. Lower tiers were unaffected, so the flip
// only appeared after JIT warmup.
//
// Only LTO release builds can exhibit the fold (debug/asan builds pass by
// construction); CI's release lanes exercise it. See oven-sh/WebKit#245.
test.concurrent("parseInt keeps values >= 2^31 exact after JIT warmup", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function hex(s) { return parseInt(s, 16); }
      function dec(s) { return parseInt(s); }
      for (let i = 0; i < 200_000; i++) {
        let v = hex("80000000");
        if (v !== 2147483648) throw new Error(\`iter \${i}: parseInt("80000000", 16) === \${v}\`);
        v = hex("ffffffff");
        if (v !== 4294967295) throw new Error(\`iter \${i}: parseInt("ffffffff", 16) === \${v}\`);
        v = hex("-80000001");
        if (v !== -2147483649) throw new Error(\`iter \${i}: parseInt("-80000001", 16) === \${v}\`);
        v = dec("2147483648");
        if (v !== 2147483648) throw new Error(\`iter \${i}: parseInt("2147483648") === \${v}\`);
      }
      console.log("ok");
      `,
    ],
    env: { ...bunEnv, BUN_JSC_jitPolicyScale: "0.001" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

// Same undefined-behavior class, sibling call sites (issue #31080 reported
// the Map variant against an older canary): Map key normalization and
// switch-immediate dispatch both compare a truncated double against the
// original value to decide the int32 fast path.
test.concurrent("Map keys and switch scrutinees >= 2^31 are not wrapped to int32", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // Map key normalization (issue #31080): keys outside int32 range and
      // ±Infinity were all replaced with -2147483648.
      function mapRoundtrip(k) { return [...new Map([[k, 1]]).keys()][0]; }
      // switch on a double outside int32 range must not match any int32 case.
      // The case set is dense (range 3) so tryTableSwitch() compiles it to
      // op_switch_imm with a jump table — the path slow_path_switch_imm
      // handles. A raw static_cast<int32_t> there converts 2^31 and 2^32 to
      // INT32_MIN (cvttsd2si's sentinel), matching the first case if the
      // range check was folded away.
      function denseSwitch(x) {
        switch (x) {
          case -2147483648: return "int32-min";
          case -2147483647: return "int32-min+1";
          case -2147483646: return "int32-min+2";
          case -2147483645: return "int32-min+3";
          default: return "default";
        }
      }
      // 5k iterations: tier-up with this jitPolicyScale happens within the
      // first few hundred calls; kept low because Map allocations are slow
      // on debug/ASAN builds and the default per-test timeout applies.
      for (let i = 0; i < 5_000; i++) {
        let k = mapRoundtrip(2 ** 31);
        if (k !== 2 ** 31) throw new Error(\`iter \${i}: Map key 2^31 became \${k}\`);
        k = mapRoundtrip(Infinity);
        if (k !== Infinity) throw new Error(\`iter \${i}: Map key Infinity became \${k}\`);
        if (new Map([[2 ** 31, 1]]).has(2 ** 32)) throw new Error(\`iter \${i}: has(2^32) true for 2^31 key\`);
        if (new Map([[-(2 ** 31), 1]]).has(2 ** 31)) throw new Error(\`iter \${i}: has(2^31) true for -(2^31) key\`);
        let s = denseSwitch(2 ** 31);
        if (s !== "default") throw new Error(\`iter \${i}: switch(2^31) matched \${s}\`);
        s = denseSwitch(4294967296);
        if (s !== "default") throw new Error(\`iter \${i}: switch(2^32) matched \${s}\`);
        s = denseSwitch(-2147483648);
        if (s !== "int32-min") throw new Error(\`iter \${i}: switch(-2^31) matched \${s}\`);
      }
      console.log("ok");
      `,
    ],
    env: { ...bunEnv, BUN_JSC_jitPolicyScale: "0.001" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
