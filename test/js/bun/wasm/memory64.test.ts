import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Memory64 module (issue #35706). Equivalent .wat:
//
//   (module
//     (memory (export "mem") i64 1)
//     (func (export "storeLoad") (param $addr i64) (param $val i32) (result i32)
//       local.get $addr
//       local.get $val
//       i32.store
//       local.get $addr
//       i32.load)
//     (func (export "size") (result i64)
//       memory.size))
const memory64Base64 =
  "AGFzbQEAAAABCwJgAn5/AX9gAAF+AwMCAAEFAwEEAQcaAwNtZW0CAAlzdG9yZUxvYWQAAARzaXplAAEKFQIOACAAIAE2AgAgACgCAAsEAD8ACw==";
const memory64Wasm = Uint8Array.fromBase64(memory64Base64);

test("memory64 module validates", () => {
  expect(WebAssembly.validate(memory64Wasm)).toBe(true);
});

test("memory64 module instantiates and uses i64 addresses", async () => {
  const { instance } = await WebAssembly.instantiate(memory64Wasm, {});
  const mem = instance.exports.mem as WebAssembly.Memory;
  const storeLoad = instance.exports.storeLoad as (addr: bigint, val: number) => number;
  const size = instance.exports.size as () => bigint;

  expect(mem.buffer.byteLength).toBe(65536);
  expect(size()).toBe(1n);
  expect(storeLoad(0n, 42)).toBe(42);
  expect(storeLoad(65532n, 1234)).toBe(1234);

  // Out-of-bounds i64 address traps instead of wrapping.
  expect(() => storeLoad(65536n, 1)).toThrow(WebAssembly.RuntimeError);
  expect(() => storeLoad(2n ** 33n, 1)).toThrow(WebAssembly.RuntimeError);

  // Growing an i64-addressed memory takes BigInt page counts.
  expect(mem.grow(1n)).toBe(1n);
  expect(mem.buffer.byteLength).toBe(131072);
  expect(size()).toBe(2n);
  expect(storeLoad(131068n, 7)).toBe(7);
});

test("BUN_JSC_useWasmMemory64=0 turns memory64 off", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const bytes = Uint8Array.fromBase64(${JSON.stringify(memory64Base64)});
       console.log(WebAssembly.validate(bytes));
       WebAssembly.instantiate(bytes, {}).then(
         () => console.log("instantiated"),
         e => console.log(e.constructor.name + ": " + e.message),
       );`,
    ],
    env: { ...bunEnv, BUN_JSC_useWasmMemory64: "0" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("false\nCompileError: WebAssembly.Module doesn't parse at byte 30: Memory64 is not enabled\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
