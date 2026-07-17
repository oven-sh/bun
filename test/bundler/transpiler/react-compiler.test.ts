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
        // minifyWhitespace is off, so the call argument is printed as
        // `(<name>)` with no surrounding whitespace. Use a literal
        // substring so a `$` in the minified name cannot be misread as a
        // regex metacharacter.
        expect(out).toContain(`(${name})`);
        if (minifyIdentifiers) {
          // With identifier minification every react-compiler-generated
          // `_temp*` name must be renamed; a surviving literal is an
          // orphaned reference.
          expect(out).not.toMatch(/\b_temp\d*\b/);
        }
      },
    });
  }

  // A later declarator that reads an earlier declarator in the same
  // `const a = x, b = f(a)` statement is a plain left-to-right read, not a
  // forward reference. Upstream's BlockStatement hoisting only emits a
  // `DeclareContext` when the reference sits inside a nested function (or the
  // binding is a function declaration), so `meta` must stay a plain local.
  // Bun's port hoisted it unconditionally, turning `meta` into a spurious
  // context variable, which tripped codegen's "MethodCall::property must be an
  // unpromoted + unmemoized MemberExpression" invariant on the `Math.max`
  // property load and silently bailed the whole component out of compilation.
  itBundled("react-compiler/MultiDeclaratorReferencesEarlierDeclarator", {
    files: {
      "/entry.tsx": /* tsx */ `
        function Text(p) { return p.children; }
        function width(s) { return s.length; }
        export function T({ label }) {
          const meta = label, room = Math.max(12, width(meta));
          return <Text>{meta}{room}</Text>;
        }
      `,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    external: ["*"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  // `minify: { syntax: true }` runs the statement mangler on nested blocks
  // (the `if` body here) before the React Compiler sees them, merging the two
  // adjacent `const` declarations into the multi-declarator shape above. The
  // compiler must accept the same set of components with and without
  // minify.syntax; a bailout here is a silent loss of memoization.
  for (const minifySyntax of [false, true] as const) {
    itBundled(`react-compiler/MathCallArgInMinifiedConditionalBranch-syntax=${minifySyntax}`, {
      files: {
        "/entry.tsx": /* tsx */ `
          import * as React from "react";
          function Text(p: { children?: React.ReactNode }) { return p.children; }
          function width(s: string): number { return s.length; }
          export function T({ w, label, on }: { w: number; label: string; on: boolean }) {
            let subline: React.ReactNode;
            if (on) {
              const meta = label;
              const room = Math.max(12, w - width(meta) - 3);
              subline = <Text>{meta}{room}</Text>;
            }
            return <Text>{subline}</Text>;
          }
        `,
      },
      reactCompiler: true,
      target: "browser",
      backend: "cli",
      minifySyntax,
      external: ["*"],
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("react/compiler-runtime");
        expect(out).toMatch(/\b_c\(\d+\)/);
      },
    });
  }

  // A user's local `jsx` / `jsxs` / `jsxDEV` / `Fragment` binding in the
  // component body scope must not capture the automatic JSX runtime import
  // when the React Compiler rewrites the component.
  itBundled("react-compiler/AutomaticLocalShadow", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Comp({ a, b }) {
          let jsx = a
          let jsxs = b
          let jsxDEV = a
          let Fragment = b
          return <><span>{jsx}</span><span>{jsxs}{jsxDEV}{Fragment}</span></>
        }
        console.log(JSON.stringify(Comp({ a: "A", b: "B" })))
      `,
      "/node_modules/react/compiler-runtime.js": `
        exports.c = function (n) { return new Array(n).fill(Symbol.for("react.memo_cache_sentinel")); };
      `,
      "/node_modules/react/index.js": `exports.createElement = () => null;`,
      "/node_modules/react/jsx-runtime.js": `
        exports.jsx = (type, props) => ({ $: "jsx", type: typeof type === "symbol" ? "Fragment" : type, props });
        exports.jsxs = (type, props) => ({ $: "jsxs", type: typeof type === "symbol" ? "Fragment" : type, props });
        exports.Fragment = Symbol.for("fragment");
      `,
      "/node_modules/react/jsx-dev-runtime.js": `
        exports.jsxDEV = (type, props) => ({ $: "jsxDEV", type: typeof type === "symbol" ? "Fragment" : type, props });
        exports.Fragment = Symbol.for("fragment");
      `,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "api",
    run: {
      stdout:
        '{"$":"jsxDEV","type":"Fragment","props":{"children":[{"$":"jsxDEV","type":"span","props":{"children":"A"}},{"$":"jsxDEV","type":"span","props":{"children":["B","A","B"]}}]}}',
    },
  });

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

  itBundled("react-compiler/SuppressionInsideTSNamespaceDoesNotLeak", {
    files: {
      "/entry.tsx": /* tsx */ `
        namespace N {
          export function Foo() {
            // eslint-disable-next-line react-hooks/rules-of-hooks
            useState();
          }
        }
        export function Component({ name }: { name: string }) {
          return <div>Hello {name}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The next-line suppression inside the namespace member must be consumed
      // there and not bail the compiler out of the sibling Component.
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
    },
  });

  // Stub react packages shared by the unbound-ref regression tests below.
  const stubReact = {
    "/node_modules/react/index.js": /* js */ `
      exports.useState = i => [i, () => {}];
      exports.createElement = () => null;
      exports.default = exports;
    `,
    "/node_modules/react/jsx-runtime.js": `exports.jsx = (t, p) => ({ t, p }); exports.jsxs = exports.jsx;`,
    "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (t, p) => ({ t, p });`,
    "/node_modules/react/compiler-runtime.js": `exports.c = n => new Array(n).fill(Symbol.for("react.memo_cache_sentinel"));`,
    "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
  };

  // Regression: native RC codegen minted refs for `_c` / `jsx` / `jsxs` via
  // `Host::new_generated` (Kind::Other, not in `is_import_item`) and emitted
  // call sites as `EIdentifier`. The printer's namespace-alias rewrite is only
  // in the `EImportIdentifier` branch, so the bundle had
  // `var react_compiler_runtimeN = __toESM(require_compiler_runtime())` but
  // bare `_cN(...)` with no decl -> ReferenceError at runtime.
  itBundled("react-compiler/CJSBindsMemoCacheImport", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { useState } from "react";
        function Counter({ label }: { label: string }) {
          const [n] = useState(0);
          return <div>{label}: {n}</div>;
        }
        console.log(JSON.stringify(Counter({ label: "hi" })));
      `,
      ...stubReact,
    },
    reactCompiler: true,
    target: "browser",
    format: "cjs",
    backend: "api",
    run: { stdout: '{"t":"div","p":{"children":["hi",": ",0]}}' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const compBody = out.slice(out.indexOf("function Counter("));
      // The memo-cache call must be a property access on the wrapped CJS
      // namespace (or otherwise bound), never a bare `_c(` / `jsx(`.
      expect(compBody).not.toMatch(/(?<![.\w])_c\d*\s*\(/);
      expect(compBody).not.toMatch(/(?<![.\w])jsxs?\s*\(/);
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  itBundled("react-compiler/ESMBindsMemoCacheImport", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { useState } from "react";
        function Counter({ label }: { label: string }) {
          const [n] = useState(0);
          return <div>{label}: {n}</div>;
        }
        console.log(JSON.stringify(Counter({ label: "hi" })));
      `,
      ...stubReact,
    },
    reactCompiler: true,
    target: "browser",
    format: "esm",
    backend: "api",
    run: { stdout: '{"t":"div","p":{"children":["hi",": ",0]}}' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const compBody = out.slice(out.indexOf("function Counter("));
      expect(compBody).not.toMatch(/(?<![.\w])_c\d*\s*\(/);
      expect(compBody).not.toMatch(/(?<![.\w])jsxs?\s*\(/);
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  // Regression: `codegen.rs well_known()` minted fresh `Kind::Other` symbols
  // for `Symbol` / `NaN` / `Infinity`. The renamer treated them as renameable
  // locals, so minified bundles had `tQE.for("react.memo_cache_sentinel")`
  // where `tQE` is renamed-but-never-declared `Symbol`.
  itBundled("react-compiler/WellKnownGlobalsNotRenamed", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { useState } from "react";
        function Counter({ label }: { label: string }) {
          const [n] = useState(0);
          return <div>{label}: {n}</div>;
        }
        console.log(JSON.stringify(Counter({ label: "hi" })));
      `,
      ...stubReact,
    },
    reactCompiler: true,
    target: "browser",
    format: "cjs",
    minifyIdentifiers: true,
    backend: "api",
    run: { stdout: '{"t":"div","p":{"children":["hi",": ",0]}}' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // RC emits `Symbol.for("react.memo_cache_sentinel")` for the slot init
      // guard; the only `.for("react.memo_cache_sentinel")` callee in the
      // bundle must be the literal global `Symbol`.
      const callees = [...out.matchAll(/([A-Za-z_$][\w$]*)\.for\("react\.memo_cache_sentinel"\)/g)].map(m => m[1]);
      expect(callees.length).toBeGreaterThan(0);
      expect(new Set(callees)).toEqual(new Set(["Symbol"]));
      new Bun.Transpiler({ loader: "js" }).transformSync(out);
    },
  });

  itBundled("react-compiler/HoistsMemoCacheSentinel", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function A() {
          return <div>a</div>;
        }
        export function B() {
          return <span>b</span>;
        }
        export function C() {
          return <p>c</p>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Bun routes the memo-cache sentinel through `p.runtime_imports`
      // (`__MEMO_CACHE_SENTINEL`, same mechanism as `__toESM`/`__require`),
      // so the bundler runtime defines `Symbol.for("react.memo_cache_sentinel")`
      // exactly once for the whole bundle (Babel/upstream emits the call inline
      // at every memo-slot comparison). Three components with no-dep scopes ⇒
      // three comparisons, but only one `Symbol.for` call.
      const calls = [...out.matchAll(/Symbol\.for\("react\.memo_cache_sentinel"\)/g)];
      expect(calls).toHaveLength(1);
      // The runtime export is referenced by name at each comparison. Allow the
      // `/* @__PURE__ */` annotation between `=` and `Symbol.for`, and accept a
      // mid-declarator (`, name =`) match since the runtime is printed as one
      // collapsed `var` statement.
      const decl = out.match(
        /[,\s]([A-Za-z_$][\w$]*)\s*=\s*(?:\/\*\s*@__PURE__\s*\*\/\s*)?Symbol\.for\("react\.memo_cache_sentinel"\)/,
      );
      expect(decl).not.toBeNull();
      const sentinel = decl![1];
      const refs = [...out.matchAll(new RegExp(String.raw`\$\[\d+\]\s*===\s*` + sentinel.replace(/\$/g, "\\$"), "g"))];
      expect(refs).toHaveLength(3);
    },
  });

  // `import()` lowers as a CallExpression whose callee carries the original
  // `EImport` (with `import_record_index`) as a BunOpaque LoadGlobal; codegen
  // reconstructs `E::Import` so the bundler's chunk linkage is preserved.
  // Previously the callee was `UnsupportedNode("Import")`, which bailed at codegen.
  itBundled("react-compiler/DynamicImportInRender", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { use } from "react";
        export function Comp() {
          const M = use(import("./mod"));
          return <div>{M.x}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime", "./mod"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out).toMatch(/\bimport\("\.\/mod"\)/);
    },
  });

  itBundled("react-compiler/DynamicImportInEffectClosure", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useEffect } from "react";
        export function Comp({ x }) {
          useEffect(() => { import("./mod").then(m => m.init()); }, []);
          return <div>{x}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime", "./mod"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toContain("react/compiler-runtime");
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out).toMatch(/\bimport\("\.\/mod"\)/);
    },
  });

  itBundled("react-compiler/DynamicImportPreservesImportRecord", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { use } from "react";
        export function Comp() {
          const M = use(import("./mod.js"));
          return <div>{M.x}</div>;
        }
      `,
      "/mod.js": `export const x = 42;`,
    },
    reactCompiler: true,
    backend: "cli",
    target: "browser",
    splitting: true,
    outdir: "/out",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out/entry.js");
      expect(out).toMatch(/\b_c\(\d+\)/);
      // The bundler chunked /mod.js and rewrote the specifier; if RC dropped
      // `import_record_index`, the rewrite wouldn't apply and the literal
      // "./mod.js" would survive (or the chunk wouldn't be emitted at all).
      expect(out).not.toMatch(/import\("\.\/mod\.js"\)/);
      const m = out.match(/import\("(\.\/[\w-]+\.js)"\)/);
      expect(m).not.toBeNull();
      api.assertFileExists("/out/" + m![1].slice(2));
    },
  });

  // prune_non_escaping_scopes treats `arr.push(jsx)` args as escaping so the
  // per-element JSX scope isn't merged into the outer mutation scope; this
  // asserts the Fragment's `key` survives the round-trip when the JSX temp is
  // captured into a mutable array inside a wider mutation scope.
  itBundled("react-compiler/KeyedFragmentAsArrayPushArg", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { Fragment } from "react";
        export function Comp({ keys }) {
          const parts = [];
          for (const k of keys) {
            parts.push(<Fragment key={k}><span>{k}</span></Fragment>);
          }
          return <>{parts}</>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      expect(out).toMatch(/\b_c\(\d+\)/);
      // jsx/jsxDEV(Fragment, props, key, ...) — `k` must be the third arg of
      // the inner Fragment call (the only `Fragment,` callee; the outer is
      // `Fragment2,`). The props object closes on its own line so anchor on
      // `\n      }, k`.
      expect(out).toMatch(/jsx(?:DEV|s)?\(Fragment, \{\n[\s\S]*?\n {6}\}, k\b/);
    },
  });

  // A 0-arg call to an unknown import is non-reactive in InferReactivePlaces
  // (no operand is reactive, callee isn't a hook), so its scope's deps prune
  // to empty and it becomes a sentinel-only block. Babel does the same; this
  // is React Compiler's purity assumption (module-level functions are pure
  // w.r.t. props/state).
  itBundled("react-compiler/ZeroArgGlobalCallMatchesBabel", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { globalFn } from "./mod";
        export function Comp() {
          const x = globalFn();
          return <div>{x}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime", "./mod"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      // Parity with Babel: `globalFn()` is inside the sentinel-only block.
      const m = out.match(/\b_c\((\d+)\)/);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("1");
      expect(out).toMatch(/__MEMO_CACHE_SENTINEL\)\s*\{[^}]*globalFn\(\)/);
    },
  });
});
