import { describe, test, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-argv flag populates process.execArgv correctly
  itBundled("compile/CompileArgvExecArgv", {
    compile: true,
    compileArgv: "--smol --user-agent=TestBot/1.0",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-argv populates process.execArgv
        console.log(JSON.stringify({
          execArgv: process.execArgv,
          argv: process.argv
        }));
        
        // Verify execArgv contains the compile_argv arguments
        if (!process.execArgv.includes("--smol")) {
          console.error("FAIL: --smol not found in execArgv");
          process.exit(1);
        }
        
        if (!process.execArgv.includes("--user-agent=TestBot/1.0")) {
          console.error("FAIL: --user-agent not found in execArgv");
          process.exit(1);
        }
        
        console.log("SUCCESS: execArgv populated correctly");
      `,
    },
    run: {
      stdout: /SUCCESS: execArgv populated correctly/,
    },
  });
});