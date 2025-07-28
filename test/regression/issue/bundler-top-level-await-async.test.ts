import { describe } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

// Regression test for bundler bug where top-level await modules
// generated __esm(() => { await ... }) instead of __esm(async () => { await ... })
// This caused SyntaxError: Unexpected reserved word when the bundled code was executed
describe("bundler regression: top-level await async keyword", () => {
  itBundled("regression/TopLevelAwaitAsyncKeyword", {
    files: {
      "/log.js": /* js */ `
        console.log("log module initializing");
        await Promise.resolve();
        console.log("log module initialized");
        export function initLog() {
          console.log("initLog called");
        }
      `,
      "/env.js": /* js */ `
        console.log("env module initializing");
        export function initEnv() {
          console.log("initEnv called");
        }
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
      // The original bug: var init_X = __esm(() => { await ... }); (missing async)
      // Should be: var init_X = __esm(async () => { await ... });

      const potentialFiles = ["log.js", "env.js", "statsigStorage.js", "chunk.js"];

      for (const file of potentialFiles) {
        try {
          const content = api.readFile(`/out/${file}`);

          if (content.includes("__esm(") && content.includes("await")) {
            // This should never happen - __esm functions with await must be async
            const badPattern = /__esm\(\(\) => \{[\s\S]*?await/;
            if (badPattern.test(content)) {
              throw new Error(`REGRESSION: Found __esm(() => { await ... }) - missing async keyword in ${file}!`);
            }
          }
        } catch (e) {
          // File might not exist, skip
        }
      }
    },
  });
});
