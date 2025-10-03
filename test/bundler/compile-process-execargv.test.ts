import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("compile/ProcessExecArgvEmpty", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        // In compiled executables, execArgv should be empty
        // since arguments like "-a" and "--b" are for the script, not bun
        if (process.execArgv.length !== 0) {
          console.error("FAIL: execArgv should be empty but got:", process.execArgv);
          process.exit(1);
        }
        
        // argv should contain all arguments including script arguments
        if (!process.argv.includes("-a") || !process.argv.includes("--b")) {
          console.error("FAIL: argv missing expected arguments:", process.argv);
          process.exit(1);
        }
        
        console.log("PASS");
      `,
    },
    run: {
      stdout: "PASS",
      args: ["-a", "--b"],
    },
  });

  itBundled("compile/ProcessExecArgvWithComplexArgs", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        // Test with various argument patterns
        if (process.execArgv.length !== 0) {
          console.error("FAIL: execArgv should be empty but got:", process.execArgv);
          process.exit(1);
        }
        
        // Check that all arguments are in argv
        const expectedArgs = ["--verbose", "-p", "8080", "--config=test.json", "arg1", "arg2"];
        let missingArgs = [];
        
        for (const arg of expectedArgs) {
          if (!process.argv.includes(arg)) {
            missingArgs.push(arg);
          }
        }
        
        if (missingArgs.length > 0) {
          console.error("FAIL: argv missing arguments:", missingArgs);
          console.error("Got argv:", process.argv);
          process.exit(1);
        }
        
        console.log("PASS");
      `,
    },
    run: {
      stdout: "PASS",
      args: ["--verbose", "-p", "8080", "--config=test.json", "arg1", "arg2"],
    },
  });
});
