import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for tree-shaking dynamic imports with static property access
// The goal is to convert `const foo = await import("bar"); foo.baz` to ImportIdentifier
// so that unused exports from "bar" can be tree-shaken out

describe("bundler", () => {
  itBundled("dce/DynamicImportWithStaticPropertyAccess", {
    files: {
      "/entry.ts": /* js */ `
        const foo = await import("./bar");
        console.log(foo.baz);
      `,
      "/bar.ts": /* js */ `
        export const baz = "used";
        export const qux = "unused";
        export const quux = "also_unused";
        export function unusedFn() {
          return "this_should_be_removed";
        }
      `,
    },
    dce: true,
    run: {
      stdout: "used",
    },
  });

  itBundled("dce/DynamicImportWithMultipleStaticProperties", {
    files: {
      "/entry.ts": /* js */ `
        const mod = await import("./lib");
        console.log(mod.foo);
        console.log(mod.bar);
      `,
      "/lib.ts": /* js */ `
        export const foo = "kept1";
        export const bar = "kept2";
        export const baz = "removed1";
        export const qux = "removed2";
      `,
    },
    dce: true,
    run: {
      stdout: "kept1\nkept2",
    },
  });

  itBundled("dce/DynamicImportWithDestructuring", {
    files: {
      "/entry.ts": /* js */ `
        const mod = await import("./lib");
        const { a, b } = mod;
        console.log(a);
        console.log(b);
      `,
      "/lib.ts": /* js */ `
        export const a = "used_a";
        export const b = "used_b";
        export const c = "unused_c";
        export const d = "unused_d";
      `,
    },
    dce: true,
    run: {
      stdout: "used_a\nused_b",
    },
  });

  itBundled("dce/DynamicImportKeepAllWithDynamicAccess", {
    files: {
      "/entry.ts": /* js */ `
        const mod = await import("./lib");
        const key = "foo";
        console.log(mod[key]);
      `,
      "/lib.ts": /* js */ `
        export const foo = "might_be_used";
        export const bar = "might_be_used_too";
      `,
    },
    // When using dynamic property access, all exports should be kept
    // This test documents the expected behavior - no tree-shaking
    run: {
      stdout: "might_be_used",
    },
  });

  itBundled("dce/DynamicImportWithDefaultAndNamed", {
    files: {
      "/entry.ts": /* js */ `
        const mod = await import("./lib");
        console.log(mod.default);
        console.log(mod.named1);
      `,
      "/lib.ts": /* js */ `
        export default "default_export";
        export const named1 = "used_named";
        export const named2 = "unused_named";
      `,
    },
    dce: true,
    run: {
      stdout: "default_export\nused_named",
    },
  });

  itBundled("dce/DynamicImportInFunction", {
    files: {
      "/entry.ts": /* js */ `
        async function test() {
          const lib = await import("./lib");
          return lib.kept;
        }
        test().then(console.log);
      `,
      "/lib.ts": /* js */ `
        export const kept = "kept_export";
        export const removed = "removed_export";
      `,
    },
    dce: true,
    run: {
      stdout: "kept_export",
    },
  });
});