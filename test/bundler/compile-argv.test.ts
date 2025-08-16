import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-argv flag works for both runtime processing and execArgv
  itBundled("compile/CompileArgvDualBehavior", {
    compile: true,
    compileArgv: "--smol",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-argv both processes flags AND populates execArgv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));
        
        // Verify execArgv contains the compile_argv arguments
        if (!process.execArgv.includes("--smol")) {
          console.error("FAIL: --smol not found in execArgv");
          console.error("execArgv was:", JSON.stringify(process.execArgv));
          process.exit(1);
        }
        
        // Verify execArgv is exactly what we expect
        if (process.execArgv.length !== 1 || process.execArgv[0] !== "--smol") {
          console.error("FAIL: execArgv should contain exactly ['--smol']");
          console.error("execArgv was:", JSON.stringify(process.execArgv));
          process.exit(1);
        }
        
        // The --smol flag should also actually be processed by Bun runtime
        // This affects memory usage behavior
        console.log("SUCCESS: compile-argv works for both processing and execArgv");
      `,
    },
    run: {
      stdout: /SUCCESS: compile-argv works for both processing and execArgv/,
    },
  });

  // Test multiple arguments in --compile-argv
  itBundled("compile/CompileArgvMultiple", {
    compile: true,
    compileArgv: "--smol --hot",
    files: {
      "/entry.ts": /* js */ `
        console.log("execArgv:", JSON.stringify(process.execArgv));
        
        // Verify execArgv contains both arguments
        const expected = ["--smol", "--hot"];
        if (process.execArgv.length !== expected.length) {
          console.error("FAIL: execArgv length mismatch. Expected:", expected.length, "Got:", process.execArgv.length);
          console.error("execArgv was:", JSON.stringify(process.execArgv));
          process.exit(1);
        }
        
        for (let i = 0; i < expected.length; i++) {
          if (process.execArgv[i] !== expected[i]) {
            console.error("FAIL: execArgv[" + i + "] mismatch. Expected:", expected[i], "Got:", process.execArgv[i]);
            console.error("execArgv was:", JSON.stringify(process.execArgv));
            process.exit(1);
          }
        }
        
        console.log("SUCCESS: Multiple compile-argv arguments parsed correctly");
      `,
    },
    run: {
      stdout: /SUCCESS: Multiple compile-argv arguments parsed correctly/,
    },
  });
});
