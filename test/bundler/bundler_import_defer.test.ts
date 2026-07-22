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

  // --- Bytecode cache ---

  itBundled("importdefer/Bytecode", {
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./dep.js";
        console.log("before");
        console.log(ns.value);
        console.log(ns.value);
      `,
      "/dep.js": /* js */ `
        console.log("dep evaluated");
        export const value = 42;
      `,
    },
    onAfterBundle(api) {
      api.assertFileExists("out/entry.js.jsc");
    },
    run: {
      stdout: "before\ndep evaluated\n42\n42",
      env: {
        BUN_JSC_verboseDiskCache: "1",
      },
      validate({ stderr }) {
        // The lowered output must actually execute from the bytecode cache,
        // not fall back to re-parsing the JavaScript.
        expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
      },
    },
  });

  itBundled("importdefer/BytecodeComplexSideEffects", {
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import defer * as a from "./a.js";
        import defer * as b from "./b.js";
        console.log("start");
        console.log(b.tag);
        a.bump();
        a.bump();
        console.log(a.count);
        console.log(b.tag);
      `,
      "/a.js": /* js */ `
        console.log("a evaluated");
        export let count = 0;
        export function bump() { count++; }
      `,
      "/b.js": /* js */ `
        console.log("b evaluated");
        export const tag = "b";
      `,
    },
    run: {
      // Evaluation must follow access order (b before a), each module must
      // evaluate exactly once, and live bindings must observe mutations.
      stdout: "start\nb evaluated\nb\na evaluated\n2\nb",
      env: {
        BUN_JSC_verboseDiskCache: "1",
      },
      validate({ stderr }) {
        expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
      },
    },
  });

  // --- Adversarial side-effect patterns ---

  itBundled("importdefer/EvaluationOrderFollowsAccessOrder", {
    files: {
      "/entry.js": /* js */ `
        import defer * as a from "./a.js";
        import defer * as b from "./b.js";
        import defer * as c from "./c.js";
        console.log("start");
        console.log(c.name);
        console.log(a.name);
        console.log(b.name);
      `,
      "/a.js": /* js */ `
        console.log("a evaluated");
        export const name = "a";
      `,
      "/b.js": /* js */ `
        console.log("b evaluated");
        export const name = "b";
      `,
      "/c.js": /* js */ `
        console.log("c evaluated");
        export const name = "c";
      `,
    },
    run: {
      // Modules evaluate in first-access order, not import declaration order.
      stdout: "start\nc evaluated\nc\na evaluated\na\nb evaluated\nb",
    },
  });

  itBundled("importdefer/ThrowingModuleErrorAtFirstAccess", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./throws.js";
        console.log("before access");
        try {
          console.log(ns.value);
        } catch (e) {
          console.log("caught:", e.message);
        }
        console.log("program continues");
      `,
      "/throws.js": /* js */ `
        console.log("throws.js evaluating");
        throw new Error("boom from module evaluation");
        export const value = 1;
      `,
    },
    run: {
      // The throw must happen at the first property access (not at import
      // time), be catchable there, and not prevent later statements from
      // running.
      //
      // Note: unlike the runtime, the bundled "__esm" wrapper does not rethrow
      // the evaluation error on *subsequent* accesses. That deviation is
      // shared with every other lazily-wrapped module (CJS interop, cycles)
      // and is not asserted here.
      stdout: "before access\nthrows.js evaluating\ncaught: boom from module evaluation\nprogram continues",
    },
  });

  itBundled("importdefer/LiveBindings", {
    files: {
      "/entry.js": /* js */ `
        import defer * as ns from "./counter.js";
        console.log("start");
        console.log("count:", ns.count);
        ns.increment();
        ns.increment();
        console.log("count:", ns.count);
        console.log("snapshot:", ns.snapshot);
      `,
      "/counter.js": /* js */ `
        console.log("counter evaluated");
        export let count = 0;
        export function increment() { count++; }
        let internal = 10;
        internal = 20;
        export const snapshot = internal;
      `,
    },
    run: {
      // Mutations of "export let" bindings after deferred evaluation must be
      // observable through the namespace, and module-internal mutations that
      // happen during evaluation must be reflected in exported values.
      stdout: "start\ncounter evaluated\ncount: 0\ncount: 2\nsnapshot: 20",
    },
  });

  itBundled("importdefer/SharedDependencyEvaluatedOnce", {
    files: {
      "/entry.js": /* js */ `
        import { value } from "./shared.js";
        import defer * as lazy from "./lazy.js";
        console.log("entry sees:", value);
        console.log("lazy tag:", lazy.tag);
        console.log("lazy sees:", lazy.sharedValue);
      `,
      "/lazy.js": /* js */ `
        import { value } from "./shared.js";
        console.log("lazy evaluated");
        export const tag = "lazy";
        export const sharedValue = value;
      `,
      "/shared.js": /* js */ `
        console.log("shared evaluated");
        export const value = "shared";
      `,
    },
    run: {
      // The exact-match stdout proves "shared evaluated" prints exactly once:
      // evaluating the deferred module later must not re-run dependencies that
      // were already evaluated eagerly.
      stdout: "shared evaluated\nentry sees: shared\nlazy evaluated\nlazy tag: lazy\nlazy sees: shared",
    },
  });

  itBundled("importdefer/CyclicDependencyWithDefer", {
    files: {
      "/entry.js": /* js */ `
        import { readB, nameA } from "./a.js";
        console.log("entry start, nameA =", nameA);
        console.log("readB() =", readB());
      `,
      "/a.js": /* js */ `
        import defer * as b from "./b.js";
        console.log("a evaluated");
        export const nameA = "a";
        export function readB() { return b.nameB; }
      `,
      "/b.js": /* js */ `
        import { nameA } from "./a.js";
        console.log("b evaluated, sees nameA =", nameA);
        export const nameB = "b";
      `,
    },
    run: {
      // "a" defer-imports "b" while "b" eagerly imports "a" back. The deferred
      // half of the cycle must stay lazy, and once it evaluates it must see
      // the already-initialized bindings of "a".
      stdout: "a evaluated\nentry start, nameA = a\nb evaluated, sees nameA = a\nreadB() = b",
    },
  });

  itBundled("importdefer/AccessInsideFunctionDefersUntilCall", {
    files: {
      "/entry.js": /* js */ `
        import defer * as heavy from "./heavy.js";
        function lazyCompute(n) {
          return heavy.compute(n);
        }
        console.log("module loaded");
        console.log("result:", lazyCompute(21));
        console.log("second:", lazyCompute(10));
      `,
      "/heavy.js": /* js */ `
        console.log("heavy evaluated");
        export function compute(n) { return n * 2; }
      `,
    },
    run: {
      // Defining a function that closes over the namespace must not trigger
      // evaluation; only calling it does, and only the first call evaluates.
      stdout: "module loaded\nheavy evaluated\nresult: 42\nsecond: 20",
    },
  });
});
