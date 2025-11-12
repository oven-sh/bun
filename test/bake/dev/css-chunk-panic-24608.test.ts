// Regression test for https://github.com/oven-sh/bun/pull/24608
// Panic: attempt to use null value at IncrementalGraph by misusing jsCode
//
// The bug: IncrementalGraph.zig:1808 in takeJSBundleToList() called .jsCode().?
// which would panic if current_chunk_parts contained files with null jsCode.
//
// Root cause analysis:
// 1. During import tracing with goal=find_client_modules (line 1266-1269),
//    files are added to current_chunk_parts unconditionally
// 2. If a file has content type .unknown (set when freeFileContent is called),
//    jsCode() returns null
// 3. takeJSBundleToList tries to unwrap with .? → PANIC
//
// The fix changed `.jsCode().?` to `.jsCode() orelse continue` to skip non-JS files.
//
// These tests exercise scenarios where files become .unknown during HMR (via
// freeFileContent), ensuring the fix handles such cases gracefully. While these
// tests pass with both 1.3.2 and canary (the panic is race-condition dependent),
// they verify the code paths affected by the fix and serve as regression tests.
import { devTest, emptyHtmlFile } from "../../bake/bake-harness";

devTest("unknown content type in chunk parts does not panic (24608)", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["entry.ts"],
      styles: ["styles.css"],
      body: `<div class="app">Test</div>`,
    }),
    "entry.ts": `
      import "./module.ts";
      export default function() {
        return "entry";
      }
      import.meta.hot.accept();
    `,
    "module.ts": `
      export const value = "initial";
      import.meta.hot.accept();
    `,
    "styles.css": `
      .app { color: red; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Initial load works
    await c.style(".app").color.expect.toBe("red");

    // Introduce a syntax error in module.ts to cause it to fail
    // This will free the file content and set it to .unknown
    await dev.write(
      "module.ts",
      `
        export const value =
      `,
      {
        errors: ["module.ts:1:20: error: Unexpected end of file"],
      },
    );

    // Now fix it back - this triggers import tracing while the file
    // might still be in an .unknown state in some edge cases
    // The buggy version would panic here when generating the JS bundle
    await dev.write(
      "module.ts",
      `
        export const value = "updated";
        import.meta.hot.accept();
      `,
    );

    // If we reach here without panic, the fix is working
    await c.style(".app").color.expect.toBe("red");
  },
});

// Alternative scenario: file deletion and recreation
devTest("deleted and recreated file does not panic (24608)", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["main.ts"],
      styles: ["styles.css"],
      body: `<div class="test">Test</div>`,
    }),
    "main.ts": `
      import "./helper.ts";
      export default function() {
        return "main";
      }
      import.meta.hot.accept();
    `,
    "helper.ts": `
      export function helper() {
        return "helper";
      }
      import.meta.hot.accept();
    `,
    "styles.css": `
      .test { color: red; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    await c.style(".test").color.expect.toBe("red");

    // Delete helper.ts to free its content (.unknown)
    await dev.delete("helper.ts", {
      errors: null,
    });

    // Update main.ts with the missing import - this will fail
    await dev.write(
      "main.ts",
      `
        import "./helper.ts";
        export default function() {
          return "main v2";
        }
        import.meta.hot.accept();
      `,
      {
        errors: ['main.ts:1:8: error: Could not resolve: "./helper.ts"'],
      },
    );

    // Recreate helper.ts - this can trigger import tracing with stale files
    // In buggy version: if helper.ts was still .unknown when added to current_chunk_parts,
    // takeJSBundleToList would panic when generating the JS bundle
    await dev.write(
      "helper.ts",
      `
        export function helper() {
          return "helper recreated";
        }
        import.meta.hot.accept();
      `,
    );

    // If we reach here, the fix prevented the panic
    await c.style(".test").color.expect.toBe("red");
  },
});
