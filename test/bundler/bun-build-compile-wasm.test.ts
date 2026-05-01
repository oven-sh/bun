import { describe, expect, test } from "bun:test";
import { bunEnv, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.build compile with wasm", () => {
  test("compile with wasm module imports", async () => {
    // This test ensures that embedded wasm modules compile and run correctly
    // The regression was that the module prefix wasn't being set correctly

    const dir = tempDirWithFiles("build-compile-wasm", {
      "app.js": `
        // Import a wasm module and properly instantiate it
        import wasmPath from "./test.wasm";

        async function main() {
          try {
            // Read the wasm file as ArrayBuffer
            const wasmBuffer = await Bun.file(wasmPath).arrayBuffer();
            const { instance } = await WebAssembly.instantiate(wasmBuffer);

            // Call the add function from wasm
            const result = instance.exports.add(2, 3);
            console.log("WASM result:", result);

            if (result === 5) {
              console.log("WASM module loaded successfully");
              process.exit(0);
            } else {
              console.error("WASM module returned unexpected result:", result);
              process.exit(1);
            }
          } catch (error) {
            console.error("Failed to load WASM module:", error.message);
            process.exit(1);
          }
        }

        main();
      `,
      // A real WebAssembly module that exports an 'add' function
      // (module
      //   (func $add (param i32 i32) (result i32)
      //     local.get 0
      //     local.get 1
      //     i32.add)
      //   (export "add" (func $add)))
      "test.wasm": Buffer.from([
        0x00,
        0x61,
        0x73,
        0x6d, // WASM magic number
        0x01,
        0x00,
        0x00,
        0x00, // WASM version 1
        // Type section
        0x01,
        0x07,
        0x01,
        0x60,
        0x02,
        0x7f,
        0x7f,
        0x01,
        0x7f,
        // Function section
        0x03,
        0x02,
        0x01,
        0x00,
        // Export section
        0x07,
        0x07,
        0x01,
        0x03,
        0x61,
        0x64,
        0x64,
        0x00,
        0x00,
        // Code section
        0x0a,
        0x09,
        0x01,
        0x07,
        0x00,
        0x20,
        0x00,
        0x20,
        0x01,
        0x6a,
        0x0b,
      ]),
    });

    // Test compilation with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir, "app.js")],
      compile: {
        outfile: join(dir, "app-wasm"),
      },
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
    expect(stdout).toContain("WASM result: 5");
    expect(stdout).toContain("WASM module loaded successfully");
    expect(stderr).toBe("");
  });
});
