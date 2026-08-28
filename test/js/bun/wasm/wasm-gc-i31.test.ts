import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/40770
//
// Two engine bugs around i31 refs in wasm GC:
// 1. `i31.get_s (br_on_null ...)` of a block result made the background BBQ
//    tier-up compile fail on a module that already validated, and the failed
//    compile segfaulted the compiler thread.
// 2. Validation required the operand of i31.get_s/u to be exactly i31ref and
//    the operand of any.convert_extern to be exactly externref. The spec
//    accepts any subtype, including the bottom types none and noextern.

// (module
//  (func (export "f") (param $n i32) (result i32)
//   (block $l1
//    (return
//     (i31.get_s
//      (br_on_null $l1
//       (block $l2 (result i31ref)
//        (ref.null none))))))
//   (i32.const -1)))
// prettier-ignore
const brOnNullBlockResult = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127, 3, 2, 1, 0, 7, 5,
  1, 1, 102, 0, 0, 10, 19, 1, 17, 0, 2, 64, 2, 108, 208, 113, 11, 213, 0, 251,
  29, 15, 11, 65, 127, 11,
]);

// (module (func (export "f") (result i32) (i31.get_s (ref.null none))))
// prettier-ignore
const i31GetSNone = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 133, 128, 128, 128, 0, 1, 96, 0, 1, 127, 3,
  130, 128, 128, 128, 0, 1, 0, 7, 133, 128, 128, 128, 0, 1, 1, 102, 0, 0, 10,
  140, 128, 128, 128, 0, 1, 134, 128, 128, 128, 0, 0, 208, 113, 251, 29, 11,
]);

// (module (func (export "f") (result i32) (i31.get_u (ref.null none))))
// prettier-ignore
const i31GetUNone = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 133, 128, 128, 128, 0, 1, 96, 0, 1, 127, 3,
  130, 128, 128, 128, 0, 1, 0, 7, 133, 128, 128, 128, 0, 1, 1, 102, 0, 0, 10,
  140, 128, 128, 128, 0, 1, 134, 128, 128, 128, 0, 0, 208, 113, 251, 30, 11,
]);

// (module (func (export "f") (result anyref) (any.convert_extern (ref.null noextern))))
// prettier-ignore
const anyConvertExternNoExtern = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 133, 128, 128, 128, 0, 1, 96, 0, 1, 110, 3,
  130, 128, 128, 128, 0, 1, 0, 7, 133, 128, 128, 128, 0, 1, 1, 102, 0, 0, 10,
  140, 128, 128, 128, 0, 1, 134, 128, 128, 128, 0, 0, 208, 114, 251, 26, 11,
]);

describe("wasm GC i31 bottom types", () => {
  test("BBQ and OMG tiers compile i31.get_s of a br_on_null block result", async () => {
    // Force synchronous tier-up with low thresholds so the buggy compile runs
    // (and used to crash) before the child exits.
    const script = `
      const bytes = new Uint8Array(${JSON.stringify(Array.from(brOnNullBlockResult))});
      const { f } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
      let r = 0;
      for (let i = 0; i < 1000; i++) r = f(1000);
      console.log("result:", r);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      stderr: "pipe",
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_thresholdForBBQOptimizeAfterWarmUp: "10",
        BUN_JSC_thresholdForOMGOptimizeAfterWarmUp: "20",
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("result: -1\n");
    expect(exitCode).toBe(0);
  });

  test("i31.get_s accepts a none-typed operand and traps on null", () => {
    const { f } = new WebAssembly.Instance(new WebAssembly.Module(i31GetSNone)).exports as { f: () => number };
    expect(() => f()).toThrow(WebAssembly.RuntimeError);
  });

  test("i31.get_u accepts a none-typed operand and traps on null", () => {
    const { f } = new WebAssembly.Instance(new WebAssembly.Module(i31GetUNone)).exports as { f: () => number };
    expect(() => f()).toThrow(WebAssembly.RuntimeError);
  });

  test("any.convert_extern accepts a noextern-typed operand", () => {
    const { f } = new WebAssembly.Instance(new WebAssembly.Module(anyConvertExternNoExtern)).exports as {
      f: () => unknown;
    };
    expect(f()).toBe(null);
  });
});
