import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27392
// SIGILL in wasm_trampoline_wasm_ipint_call_wide32 on Linux x86_64
// caused by a known JavaScriptCore IPInt bug (https://bugs.webkit.org/show_bug.cgi?id=289009)
test("WASM execution does not crash with SIGILL on Linux x86_64", async () => {
  // This test compiles and runs a non-trivial WASM module that exercises
  // function calls and control flow, which would trigger the IPInt SIGILL bug.
  const code = `
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version

      // Type section: one function type (i32, i32) -> i32
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,

      // Function section: one function of type 0
      0x03, 0x02, 0x01, 0x00,

      // Export section: export function 0 as "add"
      0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,

      // Code section
      0x0a, 0x09, 0x01, // one function body
      0x07, 0x00,       // body size, 0 locals
      0x20, 0x00,       // local.get 0
      0x20, 0x01,       // local.get 1
      0x6a,             // i32.add
      0x0b,             // end
    ]);

    const mod = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(mod);
    const result = instance.exports.add(40, 2);
    if (result !== 42) throw new Error("Expected 42 but got " + result);

    // Run in a loop to exercise JIT tiers
    for (let i = 0; i < 1000; i++) {
      const r = instance.exports.add(i, 1);
      if (r !== i + 1) throw new Error("Expected " + (i + 1) + " but got " + r);
    }

    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
