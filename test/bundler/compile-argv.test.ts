import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-exec-argv flag works for both runtime processing and execArgv
  itBundled("compile/CompileExecArgvDualBehavior", {
    compile: {
      execArgv: ["--title=CompileExecArgvDualBehavior", "--smol"],
    },
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-exec-argv both processes flags AND populates execArgv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        if (process.argv.findIndex(arg => arg === "runtime") === -1) {
          console.error("FAIL: runtime not found in argv");
          process.exit(1);
        }

        if (process.argv.findIndex(arg => arg === "test") === -1) {
          console.error("FAIL: test not found in argv");
          process.exit(1);
        }
        
        if (process.execArgv.findIndex(arg => arg === "--title=CompileExecArgvDualBehavior") === -1) {
          console.error("FAIL: --title=CompileExecArgvDualBehavior not found in execArgv");
          process.exit(1);
        }

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv");
          process.exit(1);
        }

        if (process.title !== "CompileExecArgvDualBehavior") {
          console.error("FAIL: process.title mismatch. Expected: CompileExecArgvDualBehavior, Got:", process.title);
          process.exit(1);
        }

        console.log("SUCCESS: process.title and process.execArgv are both set correctly");
      `,
    },
    run: {
      args: ["runtime", "test"],
      stdout: /SUCCESS: process.title and process.execArgv are both set correctly/,
    },
  });
});
