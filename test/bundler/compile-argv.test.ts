import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-argv flag works for both runtime processing and execArgv
  itBundled("compile/CompileArgvDualBehavior", {
    compile: true,
    compileArgv: "--title=CompileArgvDualBehavior --smol",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-argv both processes flags AND populates execArgv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));
        
        if (process.execArgv.findIndex(arg => arg === "--title=CompileArgvDualBehavior") === -1) {
          console.error("FAIL: --title=CompileArgvDualBehavior not found in execArgv");
          process.exit(1);
        }

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv");
          process.exit(1);
        }

        if (process.title !== "CompileArgvDualBehavior") {
          console.error("FAIL: process.title mismatch. Expected: CompileArgvDualBehavior, Got:", process.title);
          process.exit(1);
        }

        console.log("SUCCESS: process.title and process.execArgv are both set correctly");
      `,
    },
    run: {
      stdout: /SUCCESS: process.title and process.execArgv are both set correctly/,
    },
  });
});
