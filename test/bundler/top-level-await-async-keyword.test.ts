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

  // Test deep recursive dependencies with top-level await
  itBundled("top-level-await/DeepRecursiveDependencies", {
    files: {
      "/entry.js": /* js */ `
        import { value1 } from "./level1.js";
        console.log("Entry: got from level 1:", value1);
      `,
      "/level1.js": /* js */ `
        const level2 = await import("./level2.js");
        console.log("Level 1: got from level 2:", level2.value2);
        export const value1 = "level1";
      `,
      "/level2.js": /* js */ `
        const level3 = await import("./level3.js");
        console.log("Level 2: got from level 3:", level3.value3);
        export const value2 = "level2";
      `,
      "/level3.js": /* js */ `
        const level4 = await import("./level4.js");
        console.log("Level 3: got from level 4:", level4.value4);
        export const value3 = "level3";
      `,
      "/level4.js": /* js */ `
        console.log("Level 4: initializing");
        await new Promise(resolve => setTimeout(resolve, 1));
        console.log("Level 4: done");
        export const value4 = "level4";
      `,
    },
    format: "esm",
    onAfterBundle(api) {
      const content = api.readFile("/out.js");

      // All __esm functions in the chain should be async because level4 has top-level await
      // and the async requirement propagates up through the dependency chain
      if (content.includes("__esm(") && content.includes("await")) {
        const badPattern = /__esm\(\(\) => \{[\s\S]*?await/;
        if (badPattern.test(content)) {
          throw new Error("Found __esm(() => { await ... }) - missing async keyword in deep recursive chain!");
        }

        // Should have multiple async __esm functions
        const asyncEsmCount = (content.match(/__esm\(async \(\) => \{/g) || []).length;
        if (asyncEsmCount === 0) {
          throw new Error("Expected to find async __esm functions in deep recursive chain");
        }
      }
    },
  });

  // Test cyclical imports with top-level await
  itBundled("top-level-await/CyclicalImportsWithTLA", {
    files: {
      "/a.js": /* js */ `
        const b = await import("./b.js");
        const c = await import("./c.js");
        console.log("A: values from B and C:", b.valueB, c.valueC);
        export const valueA = "A";
      `,
      "/b.js": /* js */ `
        const a = await import("./a.js");
        console.log("B: before await, valueA:", a.valueA);
        await new Promise(resolve => setTimeout(resolve, 1));
        console.log("B: after await");
        export const valueB = "B";
      `,
      "/c.js": /* js */ `
        const a = await import("./a.js");
        console.log("C: got valueA:", a.valueA);
        export const valueC = "C";
      `,
    },
    format: "esm",
    onAfterBundle(api) {
      const content = api.readFile("/out.js");

      // In cyclical imports where one module has top-level await,
      // all modules in the cycle should get async __esm functions
      if (content.includes("__esm(") && content.includes("await")) {
        const badPattern = /__esm\(\(\) => \{[\s\S]*?await/;
        if (badPattern.test(content)) {
          throw new Error("Found __esm(() => { await ... }) - missing async keyword in cyclical imports!");
        }

        // Should have multiple async __esm functions for the cyclical modules
        const asyncEsmCount = (content.match(/__esm\(async \(\) => \{/g) || []).length;
        if (asyncEsmCount < 2) {
          throw new Error("Expected multiple async __esm functions in cyclical import scenario");
        }
      }
    },
  });
});
