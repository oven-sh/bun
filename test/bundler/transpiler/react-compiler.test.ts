import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

// The React Compiler emits `import { c as _c } from "react/compiler-runtime"` and
// rewrites component bodies to call `_c(n)` to allocate a memo cache of `n` slots.
// See vendor/react-compiler/crates/react_compiler/src/entrypoint/imports.rs
// (`add_memo_cache_import` / `get_react_compiler_runtime_module`).

describe("bundler", () => {
  itBundled("react-compiler/SimpleComponent", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Hello({ name }) {
          return <div>Hello {name}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Snapshot the full transformed output so changes to the compiler's
      // codegen are reviewable.
      expect(out).toMatchSnapshot();
      // The compiler-runtime memo cache import must be present.
      expect(out).toContain("react/compiler-runtime");
      // The component body should call the memo cache hook (`_c(n)`) with a
      // numeric slot count.
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  itBundled("react-compiler/ComponentWithHooks", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";

        export function Counter({ step }) {
          const [count, setCount] = useState(0);
          const doubled = count * 2;
          const onClick = () => setCount(c => c + step);
          return <button onClick={onClick}>{doubled}</button>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      // `onClick` and the JSX return value should be memoized into cache
      // slots; the slot count must be > 1.
      const m = out.match(/\b_c\((\d+)\)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(1);
      // Memoized values are read back from the cache array via indexed access.
      expect(out).toMatch(/\$\[\d+\]/);
    },
  });

  itBundled("react-compiler/ObjectPatternRestInProps", {
    files: {
      "/entry.tsx": /* tsx */ `
        export function Comp({ a, b, ...rest }: { a: number; b: number }) {
          return <div data-a={a} data-b={b} {...rest} />;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      // Regression: codegen_assignment_target's Object Spread arm wrapped the
      // rest binding in E::Spread *and* set PropertyKind::Spread, so the
      // hoisted destructure printed `......rest`.
      expect(out).not.toContain("......");
      expect(out).toContain("...rest");
      // Output must round-trip through Bun's own parser.
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  itBundled("react-compiler/OutputModeDefaultsByTarget-Browser", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [n] = useState(0);
          return <div>{n}</div>;
        }
      `,
    },
    reactCompiler: true,
    target: "browser",
    backend: "api",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // target: "browser" with no reactCompilerOutputMode → client (memoized).
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  itBundled("react-compiler/OutputModeDefaultsByTarget-Bun", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [n] = useState(0);
          return <div>{n}</div>;
        }
      `,
    },
    reactCompiler: true,
    target: "bun",
    backend: "api",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // target: "bun" with no reactCompilerOutputMode → ssr (no memoization,
      // no compiler-runtime import; useState lowered to its initial value).
      expect(out).not.toContain("react/compiler-runtime");
      expect(out).not.toMatch(/\b_c\(\d+\)/);
    },
  });

  itBundled("react-compiler/OutputModeExplicitSsrOverridesTarget", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [n] = useState(0);
          return <div>{n}</div>;
        }
      `,
    },
    reactCompiler: true,
    reactCompilerOutputMode: "ssr",
    target: "browser",
    backend: "api",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // reactCompilerOutputMode: "ssr" with reactCompiler: true overrides the
      // target-derived default (browser → client) and skips memoization.
      expect(out).not.toContain("react/compiler-runtime");
      expect(out).not.toMatch(/\b_c\(\d+\)/);
      // useState is still lowered by the SSR pass (the named import may
      // survive, but no call remains).
      expect(out).not.toContain("useState(");
    },
  });

  // https://github.com/oven-sh/bun/pull/32504#discussion_r3447488111
  itBundled("react-compiler/OutputModeIgnoredWhenCompilerDisabled-Client", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Hello({ name }) {
          return <div>Hello {name}</div>;
        }
      `,
    },
    reactCompiler: false,
    reactCompilerOutputMode: "client",
    backend: "api",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // reactCompilerOutputMode must not enable the pass on its own.
      expect(out).not.toContain("react/compiler-runtime");
      expect(out).not.toMatch(/\b_c\(\d+\)/);
    },
  });

  itBundled("react-compiler/OutputModeIgnoredWhenCompilerDisabled-Ssr", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [n] = useState(0);
          return <div>{n}</div>;
        }
      `,
    },
    reactCompiler: false,
    reactCompilerOutputMode: "ssr",
    backend: "api",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // reactCompilerOutputMode: "ssr" with reactCompiler: false must not run
      // the SSR pass either: useState stays as a runtime call.
      expect(out).not.toContain("react/compiler-runtime");
      expect(out).not.toMatch(/\b_c\(\d+\)/);
      expect(out).toContain("useState(");
    },
  });

  itBundled("react-compiler/BundledReactPreservesImportRefs", {
    files: {
      "/entry.tsx": /* tsx */ `
        import React, { useSyncExternalStore, useContext, createContext } from "react";
        const Ctx = createContext(0);
        const sub = () => () => {};
        const get = () => 1;
        export function Comp() {
          const v = useSyncExternalStore(sub, get);
          const c = useContext(Ctx);
          return <div>{v}{c}</div>;
        }
      `,
      // Stub react packages so we don't depend on node_modules. These just
      // need to satisfy the resolver — the test asserts on import-ref
      // preservation, not runtime behaviour.
      "/node_modules/react/index.js": `
        exports.useSyncExternalStore = () => 0;
        exports.useContext = () => 0;
        exports.createContext = () => ({});
        exports.createElement = () => null;
        exports.default = exports;
      `,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = () => null; exports.jsxs = () => null;`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = () => null;`,
      "/node_modules/react/compiler-runtime.js": `exports.c = () => [];`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    // No `external` — react is bundled, so the linker rewrites named-import
    // refs to namespace property accesses.
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("compiler-runtime");
      // Regression: codegen emitted fresh string-named identifiers for free
      // variables (LoadGlobal/imported bindings) instead of preserving the
      // original Ref. With react bundled, the linker resolves the original
      // Ref to `import_reactN.useSyncExternalStore`; a fresh identifier
      // prints bare and ReferenceErrors at runtime.
      const compBody = out.slice(out.indexOf("function Comp("));
      expect(compBody).not.toMatch(
        /(?<![.\w])useSyncExternalStore\(|(?<![.\w])useContext\(|(?<![.\w])React\.createElement\b/,
      );
      // Output must round-trip through Bun's own parser.
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  // https://github.com/oven-sh/bun/pull/32504#discussion_r3447488114
  itBundled("react-compiler/BundledCjsCompilerRuntimeSurvivesTreeShaking", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Hello({ name }) {
          return <div>Hello {name}</div>;
        }
        console.log(typeof Hello({ name: "world" }));
      `,
      // CJS compiler-runtime so the linker must wire a wrapper dependency
      // from the ReactCompiler part to this module via import_record_indices.
      "/node_modules/react/compiler-runtime.js": `
        exports.c = function (n) { return new Array(n).fill(Symbol.for("RC_RUNTIME_SENTINEL")); };
      `,
      "/node_modules/react/index.js": `exports.createElement = () => null;`,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = () => "jsx"; exports.jsxs = () => "jsx";`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = () => "jsx";`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "api",
    run: { stdout: "string" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The ReactCompiler part must declare its import record so the linker
      // keeps react/compiler-runtime live, orders it before the entry, and
      // wires the CJS wrapper dependency. Without import_record_indices the
      // module body can be dropped or left uninitialized, and _c is undefined
      // at runtime. (The linker may rename `_c`, so assert on the runtime
      // body's sentinel string instead.)
      expect(out).toContain("RC_RUNTIME_SENTINEL");
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  itBundled("react-compiler/RequireStringPreservesImportRecord", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Comp() {
          const mod = require("./other");
          const path = require.resolve("./other");
          return <div>{mod.value}{path}</div>;
        }
      `,
      "/other.js": `exports.value = "BUNDLED_OTHER_SENTINEL";`,
    },
    reactCompiler: true,
    backend: "cli",
    target: "browser",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Lowering ERequireString to a plain `require("./other")` call drops the
      // import_record_index, so the bundler would stop tracking the dependency
      // and emit a runtime require of the literal path. Round-tripping the
      // import record means the component is memoized AND `./other` is bundled.
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out).toContain("BUNDLED_OTHER_SENTINEL");
      expect(out).not.toMatch(/require\(["']\.\/other["']\)/);
      expect(out).not.toMatch(/require\.resolve\(["']\.\/other["']\)/);
    },
  });

  itBundled("react-compiler/BranchBooleanFeatureFlagPreservesDCE", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { feature } from "bun:bundle";
        export function Comp() {
          if (feature("FLAG")) {
            return <div>DEAD_BRANCH_SENTINEL</div>;
          }
          return <span>live</span>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    target: "browser",
    // FLAG is NOT in the enabled feature set, so feature("FLAG") lowers to an
    // EBranchBoolean(false). The visitor folds `if (false)` before the React
    // Compiler runs, so the dead arm is dropped and only the live span is
    // memoized.
    features: [],
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out).not.toContain("DEAD_BRANCH_SENTINEL");
      expect(out).not.toContain("feature(");
      expect(out).not.toContain("bun:bundle");
    },
  });

  itBundled("react-compiler/ForwardRefSiblingFn", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { useState } from "react";
        export function Comp({ onDone }) {
          const [x] = useState(0);
          async function onSubmit() { done(1); }
          const done = (n) => onDone(n + x);
          return <button onClick={onSubmit}>{x}</button>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  itBundled("react-compiler/SelfRefConstArrow", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { useState, useLayoutEffect } from "react";
        export function useTick() {
          const [n, setN] = useState(0);
          useLayoutEffect(() => {
            const tick = () => { setN(1); setTimeout(tick, 10); };
            setTimeout(tick, 10);
          }, []);
          return n;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  // Function outlining hoists the anonymous callback to a module-level
  // `function _temp(s) { ... }` and rewrites the call site to reference it.
  // With minify.syntax on, the single-use `v` is substituted into the `if`
  // test and the mangle pass re-visits the resulting `!useBar(_temp)`. That
  // re-visit must keep the generated `_temp` `Ref` instead of resolving the
  // name through `find_symbol`, which only walks `scope.members` and would
  // mint a fresh unbound symbol that the identifier renamer never sees.
  for (const [minifySyntax, minifyIdentifiers] of [
    [false, true],
    [true, false],
    [true, true],
  ] as const) {
    itBundled(`react-compiler/OutlinedFunctionMinify-syntax=${minifySyntax}-identifiers=${minifyIdentifiers}`, {
      files: {
        "/entry.tsx": /* tsx */ `
            import { useFoo, useBar } from "ext";
            export function C() {
              useFoo();
              const v = useBar(s => s.x > 0);
              if (!v) return null;
              return <div />;
            }
          `,
      },
      reactCompiler: true,
      target: "browser",
      backend: "cli",
      minifySyntax,
      minifyIdentifiers,
      external: ["*"],
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        // The outlined function's declaration and its call site must share
        // the same printed name. Match the decl name, then require that
        // same name to appear as a bare identifier argument in a call.
        const decl = out.match(/function\s+([A-Za-z_$][\w$]*)\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*return\b/);
        expect(decl).not.toBeNull();
        const name = decl![1];
        expect(out).toMatch(new RegExp(String.raw`\(\s*${name}\s*\)`));
        if (minifyIdentifiers) {
          // With identifier minification every react-compiler-generated
          // `_temp*` name must be renamed; a surviving literal is an
          // orphaned reference.
          expect(out).not.toMatch(/\b_temp\d*\b/);
        }
      },
    });
  }

  itBundled("react-compiler/NonComponentUntouched", {
    files: {
      "/entry.jsx": /* jsx */ `
        // Lowercase function name: not a component, not a hook. The React
        // Compiler must leave it alone.
        export function helper(name) {
          return <div>{name}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      // No memo cache import or call should be emitted for a non-component.
      expect(out).not.toContain("react/compiler-runtime");
      expect(out).not.toMatch(/\b_c\(\d+\)/);
    },
  });
});
