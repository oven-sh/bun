import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// On x86_64 the FTL converts a double to int32 with cvttsd2siq and calls a C++
// operation only when that fails (NaN, the infinities, |x| >= 2^63). B3 sees no
// side effects in the call, so when the double is the same in every iteration
// of a loop, B3 moves the call to the loop pre-header. There it runs with a
// double that the fast path accepts. The operation asserted that it never gets
// one, so a build with assertions on died with
//
//   ASSERTION FAILED: exp >= 63
//   JavaScriptCore/runtime/MathCommon.h(155) : int32_t JSC::toInt32AfterFailedTruncation(double)
//
// A release build runs the call and drops its result. oven-sh/WebKit#625.

const iterations = 200_000;

// [name, program, what it prints]
const programs: [string, string, string][] = [
  [
    "(zero + 0.5) | 0 in a function inlined into the loop",
    `
      function convert(i) { const zero = i - i; return (zero + 0.5) | 0; }
      let sum = 0;
      for (let i = 0; i < ${iterations}; i++) sum = (sum + convert(i)) | 0;
      console.log(sum);
    `,
    "0",
  ],
  [
    "(zero + 5.5) | 0 in a function inlined into the loop",
    `
      function convert(i) { const zero = i - i; return (zero + 5.5) | 0; }
      let sum = 0;
      for (let i = 0; i < ${iterations}; i++) sum = (sum + convert(i)) | 0;
      console.log(sum);
    `,
    String(5 * iterations),
  ],
  [
    "(zero ** 2) >> 0 and ~(zero ** 2)",
    `
      function sumInLoop(count) {
        let sum = 0;
        for (let i = 0; i < count; i++) {
          const zero = Math.imul(0, i);
          sum = (sum + ((zero ** 2) >> 0) + ~(zero ** 2)) | 0;
        }
        return sum;
      }
      console.log(sumInLoop(${iterations}));
    `,
    String(-iterations),
  ],
  [
    "(zero + 4294967301.5) >>> 0",
    `
      function sumInLoop(count) {
        let sum = 0;
        for (let i = 0; i < count; i++) {
          const zero = (i * 0) | 0;
          sum = (sum + ((zero + 4294967301.5) >>> 0)) | 0;
        }
        return sum;
      }
      console.log(sumInLoop(${iterations}));
    `,
    String(5 * iterations),
  ],
  [
    "int32Array[j] = 1.5 in a function inlined into the loop",
    `
      const int32Array = new Int32Array(8);
      function store(j) { int32Array[j] = 1.5; return int32Array[j]; }
      let sum = 0;
      for (let i = 0; i < ${iterations}; i++) sum = (sum + store(i & 7)) | 0;
      console.log(sum);
    `,
    String(iterations),
  ],
  [
    "uint8Array[i & 7] = 255.5",
    `
      const uint8Array = new Uint8Array(8);
      for (let i = 0; i < ${iterations}; i++) uint8Array[i & 7] = 255.5;
      console.log(uint8Array.join());
    `,
    "255,255,255,255,255,255,255,255",
  ],
  [
    "uint32Array[i & 7] = -1.5 and int16Array[i & 7] = 65537.5",
    `
      const uint32Array = new Uint32Array(8);
      const int16Array = new Int16Array(8);
      function storeInLoop(count) {
        for (let i = 0; i < count; i++) {
          uint32Array[i & 7] = -1.5;
          int16Array[i & 7] = 65537.5;
        }
      }
      storeInLoop(${iterations});
      console.log(uint32Array[7], int16Array[7]);
    `,
    "4294967295 1",
  ],
  [
    // Here the slow path does run, so the value of the call that B3 moved is the result.
    "doubles that only the slow path converts",
    `
      const int32Array = new Int32Array(8);
      function sumInLoop(count) {
        let sum = 0;
        for (let i = 0; i < count; i++) {
          const zero = Math.imul(0, i);
          int32Array[i & 7] = -(2 ** 63 + 2048);
          sum = (sum + ((zero + 2 ** 63 + 2048) | 0) + ((zero / zero) | 0) + ((1 / zero) | 0) + int32Array[i & 7]) | 0;
        }
        return sum;
      }
      console.log(sumInLoop(${iterations}));
    `,
    "0",
  ],
];

describe.concurrent("ToInt32 of a loop-invariant double in the FTL", () => {
  test.each(programs)("%s", async (_, program, expected) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      // Without the concurrent JIT the FTL code is in place after a fixed number of
      // iterations. With it, a slow build can finish the loop before the compile does.
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(expected);
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});
