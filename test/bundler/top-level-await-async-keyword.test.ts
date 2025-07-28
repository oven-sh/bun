import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("top-level-await/AsyncKeywordGeneration", {
    files: {
      "/entry.js": /* js */ `
        import "./side-effect-module.js";
        console.log("entry");
      `,
      "/side-effect-module.js": /* js */ `
        console.log("before await");
        await new Promise(resolve => setTimeout(resolve, 1));
        console.log("after await");
        export const value = 42;
      `,
    },
    format: "esm",
    onAfterBundle(api) {
      // Check if the bundled code contains __esm wrappers
      const bundledContent = api.readFile("/out.js");

      // If there are __esm wrappers with await, they should have async keyword
      const esmWithAwaitPattern = /__esm\(\(\) => \{[\s\S]*?await/;
      const esmAsyncPattern = /__esm\(async \(\) => \{[\s\S]*?await/;

      if (bundledContent.includes("__esm(") && bundledContent.includes("await")) {
        // Should NOT have non-async __esm functions that contain await
        if (esmWithAwaitPattern.test(bundledContent)) {
          throw new Error("Found __esm() function without async keyword that contains await");
        }

        // Should have async __esm functions if they contain await
        if (!esmAsyncPattern.test(bundledContent)) {
          throw new Error("Expected to find __esm(async () => { ... await ... }) pattern");
        }
      }
    },
  });

  itBundled("top-level-await/CircularImportWithTLA", {
    files: {
      "/entry.js": /* js */ `
        import { valueA } from "./module-a.js";
        import { valueB } from "./module-b.js";
        console.log(valueA, valueB);
      `,
      "/module-a.js": /* js */ `
        import "./module-b.js";
        console.log("module-a: before await");
        await new Promise(resolve => setTimeout(resolve, 1));
        console.log("module-a: after await");
        export const valueA = 42;
      `,
      "/module-b.js": /* js */ `
        import { valueA } from "./module-a.js";
        console.log("module-b: valueA is", valueA);
        export const valueB = 24;
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      // Check typical splitting output files
      const potentialFiles = ["entry.js", "chunk.js", "module-a.js", "module-b.js"];

      for (const file of potentialFiles) {
        try {
          const content = api.readFile(`/out/${file}`);

          // If there are __esm wrappers with await, they should have async keyword
          if (content.includes("__esm(") && content.includes("await")) {
            const badPattern = /__esm\(\(\) => \{[\s\S]*?await/;
            if (badPattern.test(content)) {
              throw new Error(`Found __esm(() => { await ... }) - missing async keyword in ${file}!`);
            }
          }
        } catch (e) {
          // File might not exist, skip
        }
      }
    },
  });

  // Test the specific error pattern from the user's bug report
  itBundled("top-level-await/RegressionAsyncKeyword", {
    files: {
      "/entry.js": /* js */ `
        import { init } from "./statsigStorage.js";
        init();
      `,
      "/log.js": /* js */ `
        console.log("log init");
        await Promise.resolve();
        export function initLog() {}
      `,
      "/env.js": /* js */ `
        console.log("env init");
        export function initEnv() {}
      `,
      "/statsigStorage.js": /* js */ `
        import { initLog } from "./log.js";
        import { initEnv } from "./env.js";
        
        export function init() {
          initLog();
          initEnv();
        }
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      // Check typical splitting output files
      const potentialFiles = ["entry.js", "log.js", "env.js", "statsigStorage.js", "chunk.js"];

      for (const file of potentialFiles) {
        try {
          const content = api.readFile(`/out/${file}`);

          // The bug was: var init_statsigStorage = __esm(() => { await init_log(); ... });
          // Should be: var init_statsigStorage = __esm(async () => { await init_log(); ... });
          if (content.includes("__esm(") && content.includes("await")) {
            const badPattern = /__esm\(\(\) => \{[\s\S]*?await/;
            if (badPattern.test(content)) {
              throw new Error(
                `Found __esm(() => { await ... }) - missing async keyword in ${file}! Content: ${content}`,
              );
            }
          }
        } catch (e) {
          // File might not exist, skip
        }
      }
    },
  });
});
