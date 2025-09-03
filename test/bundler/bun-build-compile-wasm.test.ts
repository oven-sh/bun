import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.build compile with wasm", () => {
  test("compile with wasm module imports", async () => {
    // This test ensures that embedded wasm modules work correctly
    // The regression was that the module prefix wasn't being set correctly
    
    const dir = tempDirWithFiles("build-compile-wasm", {
      "app.js": `
        // Import a simple wasm module
        import wasmModule from "./test.wasm";
        
        async function main() {
          try {
            const instance = await WebAssembly.instantiate(wasmModule);
            console.log("WASM module loaded successfully");
            process.exit(0);
          } catch (error) {
            console.error("Failed to load WASM module:", error.message);
            process.exit(1);
          }
        }
        
        main();
      `,
      // A minimal valid WebAssembly module (just exports an empty module)
      "test.wasm": Buffer.from([
        0x00, 0x61, 0x73, 0x6d, // WASM magic number
        0x01, 0x00, 0x00, 0x00, // WASM version 1
      ]),
    });

    // Test compilation with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir, "app.js")],
      compile: true,
      outfile: "app-wasm",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    
    // Run the compiled version to verify it works
    const proc = Bun.spawn({
      cmd: [result.outputs[0].path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(), 
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("WASM module loaded successfully");
    expect(stderr).toBe("");
  });
});