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

  // Test that exec argv options don't leak into process.argv when no user arguments are provided
  itBundled("compile/CompileExecArgvNoLeak", {
    compile: {
      execArgv: ["--user-agent=test-agent", "--smol"],
    },
    files: {
      "/entry.ts": /* js */ `
        // Test that compile-exec-argv options don't appear in process.argv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        // Check that execArgv contains the expected options
        if (process.execArgv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in execArgv, got", process.execArgv.length);
          process.exit(1);
        }

        if (process.execArgv[0] !== "--user-agent=test-agent") {
          console.error("FAIL: Expected --user-agent=test-agent in execArgv[0], got", process.execArgv[0]);
          process.exit(1);
        }

        if (process.execArgv[1] !== "--smol") {
          console.error("FAIL: Expected --smol in execArgv[1], got", process.execArgv[1]);
          process.exit(1);
        }

        // Check that argv only contains the executable and script name, NOT the exec argv options
        if (process.argv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in argv (executable and script), got", process.argv.length, "items:", process.argv);
          process.exit(1);
        }

        // argv[0] should be "bun" for standalone executables
        if (process.argv[0] !== "bun") {
          console.error("FAIL: Expected argv[0] to be 'bun', got", process.argv[0]);
          process.exit(1);
        }

        // argv[1] should be the script path (contains the bundle path)
        if (!process.argv[1].includes("bunfs")) {
          console.error("FAIL: Expected argv[1] to contain 'bunfs' path, got", process.argv[1]);
          process.exit(1);
        }

        // Make sure exec argv options are NOT in process.argv
        for (const arg of process.argv) {
          if (arg.includes("--user-agent") || arg === "--smol") {
            console.error("FAIL: exec argv option leaked into process.argv:", arg);
            process.exit(1);
          }
        }

        console.log("SUCCESS: exec argv options are properly separated from process.argv");
      `,
    },
    run: {
      // No user arguments provided - this is the key test case
      args: [],
      stdout: /SUCCESS: exec argv options are properly separated from process.argv/,
    },
  });

  // Test that user arguments are properly passed through when exec argv is present
  itBundled("compile/CompileExecArgvWithUserArgs", {
    compile: {
      execArgv: ["--user-agent=test-agent", "--smol"],
    },
    files: {
      "/entry.ts": /* js */ `
        // Test that user arguments are properly included when exec argv is present
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        // Check execArgv
        if (process.execArgv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in execArgv, got", process.execArgv.length);
          process.exit(1);
        }

        if (process.execArgv[0] !== "--user-agent=test-agent" || process.execArgv[1] !== "--smol") {
          console.error("FAIL: Unexpected execArgv:", process.execArgv);
          process.exit(1);
        }

        // Check argv contains executable, script, and user arguments
        if (process.argv.length !== 4) {
          console.error("FAIL: Expected exactly 4 items in argv, got", process.argv.length, "items:", process.argv);
          process.exit(1);
        }

        if (process.argv[0] !== "bun") {
          console.error("FAIL: Expected argv[0] to be 'bun', got", process.argv[0]);
          process.exit(1);
        }

        if (!process.argv[1].includes("bunfs")) {
          console.error("FAIL: Expected argv[1] to contain 'bunfs' path, got", process.argv[1]);
          process.exit(1);
        }

        if (process.argv[2] !== "user-arg1") {
          console.error("FAIL: Expected argv[2] to be 'user-arg1', got", process.argv[2]);
          process.exit(1);
        }

        if (process.argv[3] !== "user-arg2") {
          console.error("FAIL: Expected argv[3] to be 'user-arg2', got", process.argv[3]);
          process.exit(1);
        }

        // Make sure exec argv options are NOT mixed with user arguments
        if (process.argv.includes("--user-agent=test-agent") || process.argv.includes("--smol")) {
          console.error("FAIL: exec argv options leaked into process.argv");
          process.exit(1);
        }

        console.log("SUCCESS: user arguments properly passed with exec argv present");
      `,
    },
    run: {
      args: ["user-arg1", "user-arg2"],
      stdout: /SUCCESS: user arguments properly passed with exec argv present/,
    },
  });
});
