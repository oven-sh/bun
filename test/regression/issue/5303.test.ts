import { describe } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

// https://github.com/oven-sh/bun/issues/5303
describe("bundler", () => {
  itBundled("plugin/OnLoadReturnsNullFallsBackToFilesystem", {
    files: {
      "index.ts": /* ts */ `
        import { foo } from "./foo.ts";
        console.log(foo);
      `,
      "foo.ts": /* ts */ `
        export const foo = "from filesystem";
      `,
    },
    plugins(builder) {
      builder.onLoad({ filter: /foo\.ts$/ }, args => {
        // Return null to fallback to filesystem
        return null as any;
      });
    },
    run: {
      stdout: "from filesystem",
    },
  });

  itBundled("plugin/OnLoadReturnsUndefinedFallsBackToFilesystem", {
    files: {
      "index.ts": /* ts */ `
        import { bar } from "./bar.ts";
        console.log(bar);
      `,
      "bar.ts": /* ts */ `
        export const bar = "from filesystem";
      `,
    },
    plugins(builder) {
      builder.onLoad({ filter: /bar\.ts$/ }, args => {
        // Return undefined to fallback to filesystem
        return undefined as any;
      });
    },
    run: {
      stdout: "from filesystem",
    },
  });

  itBundled("plugin/OnLoadReturnsNullAsyncFallsBackToFilesystem", {
    files: {
      "index.ts": /* ts */ `
        import { baz } from "./baz.ts";
        console.log(baz);
      `,
      "baz.ts": /* ts */ `
        export const baz = "from filesystem";
      `,
    },
    plugins(builder) {
      builder.onLoad({ filter: /baz\.ts$/ }, async args => {
        // Return null asynchronously to fallback to filesystem
        return null as any;
      });
    },
    run: {
      stdout: "from filesystem",
    },
  });

  itBundled("plugin/OnLoadConditionalFallback", {
    files: {
      "index.ts": /* ts */ `
        import { magic } from "./magic.ts";
        import { normal } from "./normal.ts";
        console.log(magic, normal);
      `,
      "magic.ts": /* ts */ `
        export const magic = "from filesystem (should be overridden)";
      `,
      "normal.ts": /* ts */ `
        export const normal = "from filesystem";
      `,
    },
    plugins(builder) {
      builder.onLoad({ filter: /\.ts$/ }, args => {
        // Only handle magic.ts, fallback for everything else
        if (args.path.endsWith("magic.ts")) {
          return {
            contents: `export const magic = "from plugin";`,
            loader: "ts",
          };
        }
        // Return null to let other files be loaded from filesystem
        return null as any;
      });
    },
    run: {
      stdout: "from plugin from filesystem",
    },
  });

  itBundled("plugin/OnLoadReturnsNullForVirtualModule", {
    files: {
      "index.ts": /* ts */ `
        import { value } from "virtual:test";
        console.log(value);
      `,
    },
    plugins(builder) {
      builder.onResolve({ filter: /^virtual:/ }, args => {
        return {
          path: args.path,
          namespace: "virtual",
        };
      });

      // First plugin returns null, second handles it
      builder.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
        return null as any;
      });

      builder.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
        return {
          contents: `export const value = "from second plugin";`,
          loader: "ts",
        };
      });
    },
    run: {
      stdout: "from second plugin",
    },
  });

  // Test that other primitives also fallback (not error) per BundlerPlugin.ts line 544
  itBundled("plugin/OnLoadReturnsBooleanFallsBack", {
    files: {
      "index.ts": /* ts */ `
        import { value } from "./test.ts";
        console.log(value);
      `,
      "test.ts": `export const value = "from filesystem";`,
    },
    plugins(builder) {
      builder.onLoad({ filter: /test\.ts$/ }, args => {
        // Non-object primitives also fallback per BundlerPlugin.ts
        return true as any;
      });
    },
    run: {
      stdout: "from filesystem",
    },
  });

  itBundled("plugin/OnLoadReturnsUndefinedAsyncFallback", {
    files: {
      "index.ts": /* ts */ `
        import { value } from "./test.ts";
        console.log(value);
      `,
      "test.ts": `export const value = "from filesystem";`,
    },
    plugins(builder) {
      builder.onLoad({ filter: /test\.ts$/ }, async args => {
        // Async function returning undefined should also fallback
        return undefined as any;
      });
    },
    run: {
      stdout: "from filesystem",
    },
  });
});
