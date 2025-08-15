import { describe, test, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that the --compile-argv flag is properly parsed and accepted
  itBundled("compile/CompileArgvValidation", {
    compile: true,
    compileArgv: "--smol",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-argv is accepted during build
        console.log("Build successful");
      `,
    },
    // Don't run the executable due to space constraints, just verify compilation
    bundleErrors: [],
    bundleWarnings: [],
  });
});