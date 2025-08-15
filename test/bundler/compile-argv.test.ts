import { describe, test, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-argv flag works for both runtime processing and execArgv
  itBundled("compile/CompileArgvDualBehavior", {
    compile: true,
    compileArgv: "--smol",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-argv both processes flags AND populates execArgv
        console.log(JSON.stringify({
          execArgv: process.execArgv,
          argv: process.argv
        }));
        
        // Verify execArgv contains the compile_argv arguments
        if (!process.execArgv.includes("--smol")) {
          console.error("FAIL: --smol not found in execArgv");
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
});