import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("top_level_await_error/TopLevelAwaitInCJSFormat", {
    files: {
      "/entry.ts": /* ts */ `
        async function sum(a: number, b: number) {
          return a + b;
        }

        await sum(5, 5);
      `,
    },
    format: "cjs",
    bundleErrors: {
      "/entry.ts": ["Top-level await can only be used when output format is ESM"],
    },
  });

  itBundled("top_level_await_error/TopLevelAwaitInIIFEFormat", {
    files: {
      "/entry.ts": /* ts */ `
        async function getData() {
          return "data";
        }

        await getData();
      `,
    },
    format: "iife",
    bundleErrors: {
      "/entry.ts": ["Top-level await can only be used when output format is ESM", 'Expected "=>" but found ";"'],
    },
  });

  itBundled("top_level_await_error/TopLevelAwaitInESMFormatShouldWork", {
    files: {
      "/entry.ts": /* ts */ `
        async function sum(a: number, b: number) {
          return a + b;
        }

        const result = await sum(5, 5);
        console.log(result);
      `,
    },
    format: "esm",
    run: {
      stdout: "10",
    },
  });

  itBundled("top_level_await_error/AwaitInAsyncFunctionShouldStillWork", {
    files: {
      "/entry.ts": /* ts */ `
        async function main() {
          async function sum(a: number, b: number) {
            return a + b;
          }

          const result = await sum(5, 5);
          console.log(result);
        }

        main();
      `,
    },
    format: "cjs",
    run: {
      stdout: "10",
    },
  });
});
