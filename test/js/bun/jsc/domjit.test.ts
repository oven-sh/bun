// Host functions called from JavaScript in every tier: LLInt, Baseline, DFG and FTL.
//
// Most of them once had a DOMJIT signature: a second entry point that DFG and FTL code calls directly (a CallDOM node),
// without the checks of a normal call. Today only performance.now() has one. The rest are plain host functions.
//
// The loops run in a child process, domjit-fixture.ts, because the tier-up thresholds are JSC options and a process
// reads those once, when it starts. `bun test --parallel`, which CI uses, starts its workers with an FTL threshold of
// 1000000 loops, so a loop in this process would not get FTL code there.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

// The bytes that the fixture reads through bun:ffi.
const ffi = new DataView(new Uint8Array([0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88]).buffer);

// What every call of a case returns.
const returnValues = {
  "Buffer.alloc": { length: 1, zeroed: true },
  "Buffer.allocUnsafe": { length: 1 },
  "Buffer.allocUnsafeSlow": { length: 1 },
  "Performance.now": { ordered: true, advanced: true },
  "TextEncoder.encode": [116, 101, 115, 116],
  "TextEncoder.encode, 1030 bytes": { length: 1030, allA: true },
  "TextEncoder.encodeInto": { read: 4, written: 4, bytes: [116, 101, 115, 116] },
  "Crypto.timingSafeEqual": { identical: true, equal: true, unequal: false },
  "Crypto.randomUUID": { v4: true, distinct: true },
  "Crypto.getRandomValues": { returnsItsArgument: true, filled: true },
  "TextDecoder.decode": ["test", "é\uFFFDt"],
  "Stats": {
    isSymbolicLink: false,
    isSocket: false,
    isFile: false,
    isFIFO: false,
    isDirectory: true,
    isCharacterDevice: false,
    isBlockDevice: false,
  },
  "FFI ptr and read": {
    intptr: Number(ffi.getBigInt64(0, true)),
    ptr: Number(ffi.getBigUint64(0, true)),
    f32: ffi.getFloat32(0, true),
    f64: ffi.getFloat64(0, true),
    i64: `${ffi.getBigInt64(0, true)}n`,
    u64: `${ffi.getBigUint64(0, true)}n`,
    i8: ffi.getInt8(0),
    i16: ffi.getInt16(0, true),
    i32: ffi.getInt32(0, true),
    u8: ffi.getUint8(0),
    u16: ffi.getUint16(0, true),
    u32: ffi.getUint32(0, true),
  },
};

// A case passes when JSC installed FTL code for it, did not throw that code away again, and every call in every tier
// returned the same value.
const expected = Object.entries(returnValues).map(([name, value]) => ({ name, tier: "FTL", results: [value] }));

async function run(realm: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "domjit-fixture.ts"), realm],
    env: {
      ...bunEnv,
      // Every tier is on, whatever the environment of this process says.
      BUN_JSC_useJIT: "1",
      BUN_JSC_useBaselineJIT: "1",
      BUN_JSC_useDFGJIT: "1",
      BUN_JSC_useFTLJIT: "1",
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
      BUN_JSC_testTheFTL: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const cases = stdout
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
  return { cases, stderr, exitCode };
}

// A debug build takes about 10 seconds for one realm. Its JIT compilers alone take more than the default 5 seconds, so
// fewer loops do not make a realm fit. Every other build uses the default.
const timeout = isDebug ? 60_000 : undefined;

describe.concurrent("DOMJIT", () => {
  test(
    "in the main realm",
    async () => {
      expect(await run("main")).toEqual({ cases: expected, stderr: "", exitCode: 0 });
    },
    timeout,
  );

  // The functions are created in a node:vm context. A DOMJIT entry point gets that context's global object, which is
  // not a Zig::GlobalObject (#13185).
  describe("in NodeVM", () => {
    test.each(["Script.runInNewContext", "vm.runInNewContext"])(
      "%s",
      async realm => {
        expect(await run(realm)).toEqual({ cases: expected, stderr: "", exitCode: 0 });
      },
      timeout,
    );
  });
});
