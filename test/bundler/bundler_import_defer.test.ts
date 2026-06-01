import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for `import defer * as ns from "..."` (TC39 deferred module evaluation)
// at the bundler level. Deferred ES modules are wrapped in a lazy `__esm`
// closure and evaluated on the first property access on the namespace instead
// of eagerly when the importing module runs.
describe("bundler", () => {
  itBundled("importdefer/LazyEvaluation", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log("value:", ns.value);
        console.log("again:", ns.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    run: {
      stdout: "before\ndep evaluated\nvalue: 42\nagain: 42",
    },
  });

  itBundled("importdefer/LazyEvaluationMinified", {
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log("value:", ns.value);
        console.log("again:", ns.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    run: {
      stdout: "before\ndep evaluated\nvalue: 42\nagain: 42",
    },
  });

  itBundled("importdefer/MethodCall", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log(ns.add(1, 2));
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export function add(a, b) {
          return a + b;
        }
      `,
    },
    run: {
      stdout: "before\ndep evaluated\n3",
    },
  });

  itBundled("importdefer/UnusedNeverEvaluated", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("done");
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    run: {
      stdout: "done",
    },
  });

  itBundled("importdefer/TransitiveDependenciesDeferred", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log(ns.value);
      `,
      "/dep.js": /* js */ `
        import { base } from "./dep2.js";
        export { reexported } from "./dep3.js";
        console.log("dep evaluated");
        export const value = base + 1;
      `,
      "/dep2.js": /* js */ `
        console.log("dep2 evaluated");
        export const base = 41;
      `,
      "/dep3.js": /* js */ `
        console.log("dep3 evaluated");
        export const reexported = "unused";
      `,
    },
    run: {
      stdout: "before\ndep2 evaluated\ndep3 evaluated\ndep evaluated\n42",
    },
  });

  itBundled("importdefer/EagerImportElsewhereEvaluatesEagerly", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        import { value } from "./dep.js";
        console.log("before", value);
        console.log(ns.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    run: {
      stdout: "dep evaluated\nbefore 42\n42",
    },
  });

  itBundled("importdefer/NamespaceCapturedFallsBackToEager", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        const captured = ns;
        console.log("captured", typeof captured);
        console.log(captured.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    bundleWarnings: {
      "/entry.js": ['This "import defer" is evaluated eagerly'],
    },
    onAfterBundle(api) {
      // The eager fallback must not wrap the module in a lazy closure.
      expect(api.readFile("out.js")).not.toContain("__esm(");
    },
    run: {
      stdout: "dep evaluated\ncaptured object\n42",
    },
  });

  itBundled("importdefer/CommonJSTargetFallsBackToEager", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.cjs";
        console.log("before");
        console.log(ns.value);
      `,
      "/dep.cjs": /* js */ `
        console.log("dep evaluated");
        module.exports = { value: 42 };
      `,
    },
    bundleWarnings: {
      "/entry.js": ['This "import defer" is evaluated eagerly'],
    },
    run: {
      stdout: "dep evaluated\nbefore\n42",
    },
  });

  itBundled("importdefer/TopLevelAwaitFallsBackToEager", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log(ns.value);
      `,
      "/dep.js": /* js */ `
        const resolved = await Promise.resolve(42);
        console.log("dep evaluated");
        export const value = resolved;
      `,
    },
    bundleWarnings: {
      "/entry.js": ['This "import defer" is evaluated eagerly'],
    },
    run: {
      stdout: "dep evaluated\nbefore\n42",
    },
  });

  itBundled("importdefer/ExternalImportPreserved", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "some-external-pkg";
        export function get() {
          return ns.value;
        }
      `,
    },
    external: ["some-external-pkg"],
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("import defer * as");
    },
  });

  itBundled("importdefer/CodeSplittingSharedDeferredModule", {
    files: {
      "/a.js": /* js */ `
        import defer * as ns from "./shared.js";
        console.log("a before");
        console.log("a:", ns.value);
      `,
      "/b.js": /* js */ `
        import { value } from "./shared.js";
        console.log("b:", value);
      `,
      "/shared.js": /* js */ `
        console.log("shared evaluated");
        export const value = 42;
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      {
        file: "/out/a.js",
        stdout: "a before\nshared evaluated\na: 42",
      },
      {
        file: "/out/b.js",
        stdout: "shared evaluated\nb: 42",
      },
    ],
  });

  itBundled("importdefer/ObjectShorthandProperty", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        const obj = { value: ns.value };
        console.log(obj.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    run: {
      stdout: "before\ndep evaluated\n42",
    },
  });

  itBundled("importdefer/TSEnumAccessTriggersEvaluation", {
    files: {
      "/entry.ts": /* ts */ `
        import defer * as ns from "./enums.ts";
        console.log("before");
        console.log(ns.Color.Red);
        console.log(-ns.Color.Neg);
      `,
      "/enums.ts": /* ts */ `
        console.log("enums evaluated");
        export enum Color {
          Red = 1,
          Neg = -1,
        }
      `,
    },
    onAfterBundle(api) {
      // The inlined enum value sits inside the explicit "(init_enums(), ...)"
      // parens, so it must not be parenthesized again:
      // "(init_enums(), -1)", not "(init_enums(), (-1))".
      expect(api.readFile("out.js")).not.toContain("(-1)");
    },
    run: {
      stdout: "before\nenums evaluated\n1\n1",
    },
  });
});
