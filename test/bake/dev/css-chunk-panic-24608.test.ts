// Regression test for https://github.com/oven-sh/bun/pull/24608
// Panic: attempt to use null value at IncrementalGraph by misusing jsCode
//
// The bug occurred in IncrementalGraph.zig:1808 where takeJSBundleToList called
// .jsCode().? (unconditional unwrap) on files that could have null jsCode
// (e.g., CSS files, stale files, unknown content types).
//
// The fix changed `.jsCode().?` to `.jsCode() orelse continue` to safely skip
// non-JS files when generating JS bundles.
//
// These tests verify scenarios where CSS files could be present in current_chunk_parts
// during JS bundle generation, ensuring they are handled gracefully.
import { devTest, emptyHtmlFile } from "../../bake/bake-harness";

devTest("stale css file in chunk parts does not panic", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["client.ts"],
      body: `<div class="app">Hello</div>`,
    }),
    "client.ts": `
      import "./styles.css";
      export default function() {
        return "client";
      }
      import.meta.hot.accept();
    `,
    "styles.css": `
      @import "./imported.css";
      .app {
        color: red;
      }
    `,
    "imported.css": `
      .imported {
        color: blue;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Verify initial load
    await c.style(".app").color.expect.toBe("red");

    // Delete the imported CSS file to make it stale/unknown
    // Then quickly update the main CSS file before the error is resolved
    // This can cause the imported.css to be in an unknown/stale state
    // when traceImports runs with find_client_modules goal
    await dev.delete("imported.css", { errors: null });

    // Update styles.css to trigger rebuild with the broken import
    await dev.write(
      "styles.css",
      `
        @import "./imported.css";
        .app {
          color: green;
        }
      `,
      {
        errors: ['styles.css:1:1: error: Could not resolve: "./imported.css"'],
      },
    );

    // Re-create the file to trigger another rebuild
    // In buggy version: imported.css might still be in current_chunk_parts as unknown/stale
    // and .jsCode().? would panic
    await dev.write(
      "imported.css",
      `
        .imported {
          color: yellow;
        }
      `,
    );

    // If we get here without panic, the fix is working
    await c.style(".app").color.expect.toBe("green");
  },
});

devTest("css file referenced from server component does not panic", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["entry.ts"],
      body: `<div class="test">Test</div>`,
    }),
    "entry.ts": `
      import "./component.ts";
      import "./styles.css";
      export default function() {
        return "entry";
      }
      import.meta.hot.accept();
    `,
    "component.ts": `
      // This creates a scenario where CSS is traced with find_client_modules goal
      import "./component-styles.css";
      export function Component() {
        return "component";
      }
      import.meta.hot.accept();
    `,
    "styles.css": `
      .test { color: red; }
    `,
    "component-styles.css": `
      .component { color: blue; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".test").color.expect.toBe("red");

    // Update the component CSS which gets traced during import resolution
    // This exercises the path where CSS files can end up in current_chunk_parts
    await dev.write(
      "component-styles.css",
      `
        .component { color: green; }
      `,
    );

    // Update the JS file to trigger HMR with CSS dependencies
    await dev.write(
      "component.ts",
      `
        import "./component-styles.css";
        export function Component() {
          return "component updated";
        }
        import.meta.hot.accept();
      `,
    );

    // If we reach here, the fix prevented the panic
    await c.style(".test").color.expect.toBe("red");
  },
});
