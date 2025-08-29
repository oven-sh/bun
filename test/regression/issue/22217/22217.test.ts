import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("Issue #22217 - scribe.js-ocr WASM trampoline crash", () => {
  // This issue is related to #17841 (PGlite crash) and is caused by a bug in 
  // JavaScriptCore's WASM IPInt (In-place interpreter) on x86_64 Linux.
  // The crash occurs in wasm_trampoline_wasm_ipint_call_wide32 during intensive
  // WASM operations like those used by tesseract.js and PGlite.
  // 
  // WebKit bug report: https://bugs.webkit.org/show_bug.cgi?id=289009
  //
  // Workarounds:
  // - BUN_JSC_useWasmIPInt=0 (disable IPInt, use older interpreter)  
  // - BUN_JSC_jitPolicyScale=0 (force immediate JIT compilation)
  // - Use ARM64 architecture (doesn't reproduce there)
  test("complex WASM operations should not cause segfault", async () => {
    // Create a test that simulates complex WASM operations similar to what
    // tesseract.js would do - multiple WASM calls with large data buffers
    
    const dir = tempDirWithFiles("complex-wasm-test", {
      "test-complex-wasm.js": `
        // Simulate complex WASM operations that might trigger the crash
        async function testComplexWasm() {
          try {
            // Use the verified working WASM module from existing tests
            const wasmCode = Buffer.from("AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=", "base64");
            
            const module = await WebAssembly.compile(wasmCode);
            const instance = await WebAssembly.instantiate(module);
            
            const add = instance.exports.add;
            
            console.log('WASM module loaded successfully');
            
            // Perform extremely intensive WASM operations to stress the trampoline
            // This tries to reproduce the conditions that cause wasm_trampoline_wasm_ipint_call_wide32 crashes
            for (let iteration = 0; iteration < 10000; iteration++) {
              // Nested loops with intensive WASM calls
              let sum = 0;
              for (let i = 0; i < 50; i++) {
                for (let j = 0; j < 50; j++) {
                  // Chain many WASM calls together
                  const val1 = add(i, j);
                  const val2 = add(val1, iteration);
                  const val3 = add(val2, sum % 1000);
                  sum = add(sum, val3);
                }
              }
              
              // Rapid-fire calls with different patterns
              for (let k = 0; k < 100; k++) {
                add(k, iteration);
                add(iteration, k);
                add(k * iteration % 65536, k);
              }
              
              // Test edge cases with large numbers
              const largeNum = iteration * 65536;
              add(largeNum, largeNum);
              add(-largeNum, largeNum);
              add(0x7FFFFFFF, iteration);
            }
            
            console.log('Complex WASM operations completed successfully');
          } catch (error) {
            console.error('Complex WASM test failed:', error);
            process.exit(1);
          }
        }
        
        testComplexWasm();
      `
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-complex-wasm.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // The test should not crash with a segfault
    expect(exitCode).not.toBe(139); // SIGSEGV  
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic:");
    expect(stderr).not.toContain("wasm_trampoline_wasm_ipint_call_wide32");
    expect(stdout).toContain("Complex WASM operations completed successfully");
  });

  test.skip("tesseract.js should not cause WASM trampoline crash", async () => {
    // This test tries to reproduce the actual issue with tesseract.js
    // Skipped by default since it requires network access and is slow
    const dir = tempDirWithFiles("tesseract-crash-test", {
      "package.json": JSON.stringify({
        "name": "tesseract-crash-test",
        "dependencies": {
          "tesseract.js": "^5.1.1"
        }
      }),
      "test-tesseract.js": `
        const Tesseract = require('tesseract.js');
        
        async function testTesseract() {
          try {
            // Create a small test image that still triggers substantial WASM processing
            const testImageData = Buffer.from([
              // Small PNG with some text-like pattern that will stress OCR
              0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
              0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
              0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20,
              0x08, 0x00, 0x00, 0x00, 0x00, 0x5A, 0x81, 0x9D,
              0x9F, 0x00, 0x00, 0x00, 0x40, 0x49, 0x44, 0x41,
              0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
              0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
              0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
              0x42, 0x60, 0x82
            ]);
            
            console.log('Starting Tesseract OCR test...');
            
            // Process with tesseract which will trigger intensive WASM operations
            const result = await Tesseract.recognize(testImageData, 'eng', {
              logger: m => console.log(m.status, m.progress)
            });
            
            console.log('OCR completed:', result.data.text.length, 'characters');
            console.log('Tesseract test completed successfully');
          } catch (error) {
            console.error('Tesseract test failed:', error.message);
            // Don't exit with error for expected failures (e.g., network issues)
            // We're mainly testing for crashes
          }
        }
        
        testTesseract();
      `
    });

    // Install dependencies
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });

    await installProc.exited;

    // Run the tesseract test
    await using testProc = Bun.spawn({
      cmd: [bunExe(), "test-tesseract.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000, // 1 minute timeout
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      testProc.stdout.text(),
      testProc.stderr.text(),
      testProc.exited,
    ]);

    // The main thing we're testing is that it doesn't segfault
    expect(exitCode).not.toBe(139); // SIGSEGV
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic:");
    expect(stderr).not.toContain("wasm_trampoline_wasm_ipint_call_wide32");
  });

  test("WASM operations with IPInt disabled should not crash", async () => {
    // Test the BUN_JSC_useWasmIPInt=0 workaround
    const dir = tempDirWithFiles("wasm-ipint-disabled-test", {
      "test-wasm-no-ipint.js": `
        // Same intensive WASM test as above, but with IPInt disabled
        const wasmCode = Buffer.from("AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=", "base64");
        
        async function testWasmNoIPInt() {
          try {
            const module = await WebAssembly.compile(wasmCode);
            const instance = await WebAssembly.instantiate(module);
            const add = instance.exports.add;
            
            // Perform the same intensive operations as the main test
            for (let iteration = 0; iteration < 1000; iteration++) {
              for (let i = 0; i < 20; i++) {
                for (let j = 0; j < 20; j++) {
                  add(i, j);
                  add(j, iteration);
                }
              }
            }
            
            console.log('WASM with IPInt disabled completed successfully');
          } catch (error) {
            console.error('WASM with IPInt disabled failed:', error);
            process.exit(1);
          }
        }
        
        testWasmNoIPInt();
      `
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-wasm-no-ipint.js"],
      cwd: dir,
      env: {
        ...bunEnv,
        BUN_JSC_useWasmIPInt: "0" // Disable IPInt as workaround
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not crash and should complete successfully
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic:");
    expect(stderr).not.toContain("wasm_trampoline_wasm_ipint_call_wide32");
    expect(stdout).toContain("WASM with IPInt disabled completed successfully");
  });
  
  test("minimal WASM execution should not crash", async () => {
    // Test basic WASM functionality to ensure our WASM infrastructure works
    const dir = tempDirWithFiles("wasm-basic-test", {
      "test-wasm.js": `
        // Test basic WebAssembly functionality
        const wasmCode = new Uint8Array([
          0x00, 0x61, 0x73, 0x6D, // WASM magic number
          0x01, 0x00, 0x00, 0x00, // WASM version
          // Simple module that exports an "add" function
          0x01, 0x07, 0x01, 0x60, 0x02, 0x7F, 0x7F, 0x01, 0x7F, // type section
          0x03, 0x02, 0x01, 0x00, // function section
          0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section
          0x0A, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6A, 0x0B // code section
        ]);
        
        async function testWasm() {
          try {
            const module = await WebAssembly.compile(wasmCode);
            const instance = await WebAssembly.instantiate(module);
            
            const result = instance.exports.add(5, 3);
            console.log('WASM add result:', result);
            
            if (result !== 8) {
              console.error('Expected 8, got', result);
              process.exit(1);
            }
            
            console.log('Basic WASM test passed');
          } catch (error) {
            console.error('WASM test failed:', error);
            process.exit(1);
          }
        }
        
        testWasm();
      `
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-wasm.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("WASM add result: 8");
    expect(stdout).toContain("Basic WASM test passed");
  });
});