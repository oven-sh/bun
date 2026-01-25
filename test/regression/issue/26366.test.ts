import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26366
// Bun crashes with SIGILL/segfault when calling an Emscripten-exported Wasm function
// via direct method call on the module object after many iterations.
// This is caused by a JSC Wasm OSR/JIT bug, fixed by disabling useWasmOSR on Linux x64.

describe("issue #26366: JSC Wasm OSR crash with direct method calls", () => {
  // The original bug only manifested on Linux x64, but this test validates
  // the Wasm instantiation and direct method call pattern works on all platforms.
  test("repeated wasm module instantiation with direct method calls", async () => {
    // Create a minimal test that exercises the code path that would crash:
    // - Multiple Wasm module instantiations
    // - Direct method calls on the module object (module.export())
    const script = `
      // Minimal Wasm module: exports a function that returns its argument + 1
      // Generated with: (module (func (export "add1") (param i32) (result i32) local.get 0 i32.const 1 i32.add))
      const wasmBytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
        0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f, // type section: (i32) -> i32
        0x03, 0x02, 0x01, 0x00,                         // function section
        0x07, 0x08, 0x01, 0x04, 0x61, 0x64, 0x64, 0x31, 0x00, 0x00, // export "add1"
        0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x41, 0x01, 0x6a, 0x0b, // code
      ]);

      // Use higher iterations on Linux x64 where the original crash occurred.
      // Allow override via env var for CI stress testing.
      const baseIterations = process.platform === 'linux' && process.arch === 'x64' ? 4000 : 500;
      const iterations = parseInt(process.env.TEST_ITERATIONS, 10) || baseIterations;

      async function runTest() {
        for (let i = 0; i < iterations; i++) {
          const wasmModule = await WebAssembly.compile(wasmBytes);
          const instance = await WebAssembly.instantiate(wasmModule);

          // Direct method call - this was the pattern that triggered the crash
          const result = instance.exports.add1(i);

          if (result !== i + 1) {
            throw new Error(\`Unexpected result at iteration \${i}: expected \${i + 1}, got \${result}\`);
          }
        }
        console.log(\`Completed \${iterations} iterations successfully\`);
      }

      await runTest();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toMatch(/Completed \d+ iterations successfully/);
    expect(stderr).toBe("");
    // The key assertion: process should exit normally without crash (SIGILL/SIGSEGV)
    expect(exitCode).toBe(0);
  });
});
