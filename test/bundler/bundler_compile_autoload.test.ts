import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that .env files are loaded by default in standalone executables
  itBundled("compile/AutoloadDotenvDefault", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test that .env files can be disabled with autoloadDotenv: false
  itBundled("compile/AutoloadDotenvDisabled", {
    compile: {
      autoloadDotenv: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "not found",
      setCwd: true,
    },
  });

  // Test that .env files can be explicitly enabled with autoloadDotenv: true
  itBundled("compile/AutoloadDotenvEnabledExplicitly", {
    compile: {
      autoloadDotenv: true,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test that process environment variables take precedence over .env files
  itBundled("compile/AutoloadDotenvWithExistingEnv", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_shell",
      setCwd: true,
      env: {
        TEST_VAR: "from_shell",
      },
    },
  });

  // Test that bunfig.toml is loaded by default (preload is executed)
  itBundled("compile/AutoloadBunfigDefault", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test that bunfig.toml can be disabled with autoloadBunfig: false
  itBundled("compile/AutoloadBunfigDisabled", {
    compile: {
      autoloadBunfig: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      // When bunfig is disabled, preload should NOT execute
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test that bunfig.toml can be explicitly enabled with autoloadBunfig: true
  itBundled("compile/AutoloadBunfigEnabled", {
    compile: {
      autoloadBunfig: true,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadDotenv: false
  itBundled("compile/AutoloadDotenvDisabledCLI", {
    compile: {
      autoloadDotenv: false,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "not found",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadDotenv: true
  itBundled("compile/AutoloadDotenvEnabledCLI", {
    compile: {
      autoloadDotenv: true,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadBunfig: false
  itBundled("compile/AutoloadBunfigDisabledCLI", {
    compile: {
      autoloadBunfig: false,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadBunfig: true
  itBundled("compile/AutoloadBunfigEnabledCLI", {
    compile: {
      autoloadBunfig: true,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test that both flags can be disabled together without interference
  itBundled("compile/AutoloadBothDisabled", {
    compile: {
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "not found\nENTRY",
      setCwd: true,
    },
  });
});
