import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27340
// WASM IPInt (In-Place Interpreter) causes segfaults on Linux x86_64 when
// executing WASM functions repeatedly. Bun disables IPInt by default on
// Linux x86_64 to work around the upstream JavaScriptCore bug.
// See: https://bugs.webkit.org/show_bug.cgi?id=289009

test("WASM execution does not segfault under repeated calls", async () => {
  // A simple WASM module with an `add` function: (i32, i32) -> i32
  // (module
  //   (export "add" (func $add))
  //   (func $add (param i32 i32) (result i32)
  //     (i32.add (local.get 0) (local.get 1))
  //   )
  // )
  const code = `
    const wasmBytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
      0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01,
      0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
      0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a,
      0x0b
    ]);

    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const add = instance.exports.add;

    // Call the WASM function many times to exercise the interpreter path.
    // The IPInt bug manifests during repeated calls on Linux x86_64.
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      sum += add(i, 1);
    }

    console.log(sum);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // 10000 + sum(0..9999) = 10000 + (9999 * 10000 / 2) = 10000 + 49995000 = 50005000
  expect(stdout.trim()).toBe("50005000");
  expect(exitCode).toBe(0);
});
