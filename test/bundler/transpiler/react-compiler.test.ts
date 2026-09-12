import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { itBundled, type BundlerTestInput } from "../expectBundled";

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

  // https://github.com/oven-sh/bun/issues/42224
  itBundled("react-compiler/UnderscoreAndDollarComponentTags", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { _Imported } from "./components";
        const Plain = () => <span>a</span>;
        const _Underscore = () => <span>b</span>;
        const $Dollar = () => <span>c</span>;

        export const App = () => (
          <p>
            <Plain />
            <_Underscore />
            <$Dollar />
            <_Imported />
          </p>
        );
      `,
      "/components.tsx": /* tsx */ `
        export const _Imported = () => <span>d</span>;
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("react/compiler-runtime");
      // Only a tag that starts with a lowercase letter is a host element. An
      // identifier that starts with `_` or `$` is a component reference.
      expect(out).toMatch(/jsx\w*\(Plain,/);
      expect(out).toMatch(/jsx\w*\(_Underscore,/);
      expect(out).toMatch(/jsx\w*\(\$Dollar,/);
      expect(out).toMatch(/jsx\w*\(_Imported,/);
      expect(out).not.toContain('"_Underscore"');
      expect(out).not.toContain('"$Dollar"');
      expect(out).not.toContain('"_Imported"');
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

  // https://github.com/oven-sh/bun/issues/37022
  // A full-stack build (--target=bun with an HTML import) bundles the browser
  // graph through a separate client transpiler. That transpiler must run the
  // React Compiler in client mode: the SSR pass inlines useState and drops the
  // setter binding, leaving `setIsAuth` as a dangling identifier in the client
  // bundle (ReferenceError at render).
  itBundled("react-compiler/FullstackHtmlImportCompilesClientGraphInClientMode", {
    outdir: "/out",
    entryPoints: ["/server.ts"],
    files: {
      "/server.ts": `
        import index from "./index.html";
        console.log(typeof index);
      `,
      "/index.html": `<!DOCTYPE html><html><head><script type="module" src="./main.jsx"></script></head><body><div id="root"></div></body></html>`,
      "/main.jsx": /* jsx */ `
        import { useState } from "react";
        function Login({ setAuth }) {
          return <button onClick={() => setAuth(true)}>login</button>;
        }
        export function App() {
          const [isAuth, setIsAuth] = useState(false);
          return isAuth === false ? <Login setAuth={setIsAuth} /> : <div>in</div>;
        }
        globalThis.App = App;
      `,
      "/node_modules/react/index.js": `exports.useState = i => [i, () => {}]; exports.default = exports;`,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = (t, p) => ({ t, p }); exports.jsxs = exports.jsx;`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (t, p) => ({ t, p });`,
      "/node_modules/react/compiler-runtime.js": `exports.c = n => new Array(n).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "bun",
    backend: "cli",
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir)
        .filter(f => f.endsWith(".js"))
        .map(f => api.readFile("/out/" + f));
      const chunk = chunks.find(c => c.includes("setIsAuth"));
      expect(chunk).toBeDefined();
      // Client mode keeps the useState destructure, so the setter has a
      // declaration in addition to its prop use. In SSR mode the destructure
      // is inlined away and only the dangling use remains.
      expect(chunk!).toMatch(/\[isAuth,\s*setIsAuth\]/);
      expect(chunk!.match(/\bsetIsAuth\b/g)!.length).toBeGreaterThanOrEqual(2);
      // Client mode memoizes through the compiler runtime; the SSR pass never
      // references the memo cache sentinel.
      expect(chunk!).toContain("react.memo_cache_sentinel");
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

  // With memoization off (ssr mode) the pipeline infers no reactive scopes for
  // the compiled function itself, so an object literal and its method
  // shorthands reach AlignObjectMethodScopes with no scope to align.
  //
  // The fake useState never returns its argument. The ssr pass inlines useState
  // to its initial value, so a function prints that value only when the
  // compiler compiled it and did not skip it.
  itBundled("react-compiler/SsrObjectMethodShorthand", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";

        function InJsxAttribute() {
          const [n] = useState(1);
          return <div data-v={{ m() { return n; } }} />;
        }
        function InBody({ label }) {
          const [n] = useState(2);
          const v = {
            m() { return label + n; },
            async am() { return n; },
            [label]() { return n; },
            nested() { return { inner() { return n; } }; },
          };
          return <div data-v={v} />;
        }
        function useApi(value) {
          const [n] = useState(3);
          return { get() { return value + n; } };
        }

        const a = InJsxAttribute().props["data-v"];
        const b = InBody({ label: "x" }).props["data-v"];
        console.log(JSON.stringify({
          InJsxAttribute: a.m(),
          InBody: [b.m(), await b.am(), b.x(), b.nested().inner()],
          useApi: useApi("v").get(),
        }));
      `,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
      "/node_modules/react/index.js": `exports.useState = () => ["not inlined", () => {}];`,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = (type, props) => ({ type, props });`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (type, props) => ({ type, props });`,
    },
    reactCompiler: true,
    target: "bun",
    backend: "cli",
    run: { stdout: '{"InJsxAttribute":1,"InBody":["x2",2,2,2],"useApi":"v3"}' },
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

  // Regression: codegen.rs PropertyDelete/ComputedDelete/UnaryExpression emitted
  // `E::Unary` with `UnaryFlags::empty()`. The parser sets
  // `WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS` for `delete <dot|index>`;
  // the printer re-wraps any `delete <dot|index>` lacking that flag as
  // `delete (0, obj.prop)`, which evaluates the property to a value and returns
  // `true` without deleting anything.
  itBundled("react-compiler/PropertyDeletePreservesReferenceSemantics", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useMemo } from "react";
        export function useThing(a, b) {
          return useMemo(() => {
            const x = { a, b, c: 3 };
            delete x.b;
            const key = "c";
            delete x[key];
            return x;
          }, [a, b]);
        }
        console.log(JSON.stringify(useThing(1, 2)));
      `,
      "/node_modules/react/index.js": `exports.useMemo = (f) => f();`,
      "/node_modules/react/compiler-runtime.js": `exports.c = n => new Array(n).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    run: { stdout: '{"a":1}' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The hook must be compiled (sanity: codegen, not a bailout, is on trial).
      // With react bundled the `_c` import is renamed, so assert on the
      // compiler-runtime body being linked in instead.
      expect(out).toContain("react.memo_cache_sentinel");
      // `delete (0, x.b)` / `delete (0, x[...])` evaluates to a value, not a
      // Reference — must not appear for either the dot or index form.
      expect(out).not.toMatch(/delete\s*\(\s*0\s*,/);
    },
  });

  // Sibling of the above: `WAS_ORIGINALLY_TYPEOF_IDENTIFIER` was also dropped,
  // so the printer wrapped `typeof undeclared` as `typeof (0, undeclared)`,
  // which throws ReferenceError instead of returning "undefined" — breaking
  // the common `typeof window !== "undefined"` SSR check.
  itBundled("react-compiler/TypeofUnboundIdentifierPreservesFlag", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useMemo } from "react";
        export function useIsBrowser() {
          return useMemo(() => typeof window !== "undefined", []);
        }
        // The folded-conditional form must keep throwing semantics: the visitor
        // wraps it as a real (0, x) comma expression, and codegen must not set
        // the flag just because the operand inlines to an identifier.
        export function useTypeofFolded() {
          return useMemo(() => {
            try {
              return typeof (true ? NotDeclaredAnywhere : Other);
            } catch {
              return "threw";
            }
          }, []);
        }
        console.log(useIsBrowser(), useTypeofFolded());
      `,
      "/node_modules/react/index.js": `exports.useMemo = (f) => f();`,
      "/node_modules/react/compiler-runtime.js": `exports.c = n => new Array(n).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    run: { stdout: "false threw" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Both hooks must be compiled (RC drops the `useMemo` wrapper); these
      // particular bodies need 0 memo slots so compiler-runtime is tree-shaken.
      expect(out).not.toContain("useMemo(");
      // `typeof window` must survive as-is; `typeof (true ? ...)` must stay wrapped.
      expect(out).toMatch(/\btypeof window\b(?!\s*\))/);
      expect(out).toMatch(/\btypeof\s*\(\s*0\s*,\s*NotDeclaredAnywhere\s*\)/);
    },
  });

  // `delete (true ? o.a : o.b)` is a no-op per spec (operand is a value, not a
  // Reference). The visitor folds the conditional to a bare EDot with the
  // delete-flag unset; lowering must not turn that into a real PropertyDelete.
  // Upstream's Babel plugin sees the unfolded ConditionalExpression and bails
  // with "Only object properties can be deleted", so bailing out here matches.
  itBundled("react-compiler/DeleteFoldedConditionalKeepsNoOpSemantics", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Comp({ a, b }) {
          const o = { a, b };
          const r = delete (true ? o.a : o.b);
          return <div>{r}{JSON.stringify(o)}</div>;
        }
        const el = Comp({ a: 1, b: 2 });
        console.log(el.props.children.join(""));
      `,
      "/node_modules/react/index.js": `module.exports = {};`,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = (t, p) => ({ t, props: p });`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (t, p) => ({ t, props: p });`,
      "/node_modules/react/compiler-runtime.js": `exports.c = n => new Array(n).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    run: { stdout: 'true{"a":1,"b":2}' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The component bails out of compilation (Babel parity), so the delete
      // stays in its post-visit `delete (0, o.a)` form.
      expect(out).toMatch(/delete\s*\(\s*0\s*,\s*o\.a\s*\)/);
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

  // A compiled component that needs zero memo slots must not import the
  // runtime. The import is registered from codegen next to the `_c(N)` call,
  // so a body with nothing to memoize leaves `react/compiler-runtime` out.
  // `.jsx`, not `.tsx`: the TypeScript path elides unused imports and would
  // hide a spurious one.
  itBundled("react-compiler/ZeroMemoSlotsNoRuntimeImport", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [count] = useState(0);
          const step = 1;
          const twice = step + step;
          return count + twice;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      // Constant propagation folded `twice` into the return, so the compiler
      // did run on this component.
      expect(out).toContain("return count + 2;");
      // It found nothing to memoize: no cache, and so no runtime import.
      expect(out).not.toMatch(/\b_c\(\d+\)/);
      expect(out).not.toContain("react/compiler-runtime");
    },
  });

  itBundled("react-compiler/ZeroMemoSlotsBeforeMemoizedComponent", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Counter() {
          const [count] = useState(0);
          const step = 1;
          const twice = step + step;
          return count + twice;
        }
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
      expect(out).toMatchSnapshot();
      expect(out).toContain("return count + 2;");
      // `Counter` compiled first with no slots. `Hello` memoizes its JSX, so
      // its codegen registers the runtime import: present exactly once, and
      // `_c` resolves to it.
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out.match(/from "react\/compiler-runtime"/g)).toHaveLength(1);
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

  // The parser turns `<div children="x">y</div>` into
  // `jsx("div", { children: "x", children: "y" })`: the JSX children are the
  // last property, so they replace every earlier `children` key. It also
  // inlines `{...{ k: v }}` into that object. The compiler reads the element
  // back from the call, and has to keep each key in place and keep a getter a
  // getter.
  itBundled("react-compiler/ChildrenAttributeIsNotAJsxChild", {
    files: {
      "/entry.jsx": /* jsx */ `
        function Attr(p) { return <div children="x">y</div>; }
        function AttrExpr(p) { return <div children={p.a}>{p.b}</div>; }
        function TwoAttrs(p) { return <div children="a" children="b" />; }
        function InlineSpread(p) { return <div {...{ children: "sp" }}>real</div>; }
        function AttrThenSpread(p) { return <div children="x" {...p} />; }
        function AttrSpreadChildren(p) { return <div children="x" {...p}>{p.a}{p.b}</div>; }
        function SpreadThenAttr(p) { return <div {...p} children="x" />; }
        function Getter(p) { return <i {...{ get g() { return p.a; } }} />; }
        console.log(JSON.stringify({
          Attr: Attr({}).p.children,
          AttrExpr: AttrExpr({ a: 1, b: "x" }).p.children,
          TwoAttrs: TwoAttrs({}).p.children,
          InlineSpread: InlineSpread({}).p.children,
          AttrThenSpread: [AttrThenSpread({ children: "q" }).p.children, AttrThenSpread({}).p.children],
          AttrSpreadChildren: AttrSpreadChildren({ a: 1, b: 2, children: "q" }).p.children,
          SpreadThenAttr: SpreadThenAttr({ children: "q" }).p.children,
          Getter: Getter({ a: 5 }).p.g,
        }));
      `,
      ...stubReact,
    },
    reactCompiler: true,
    target: "browser",
    backend: "api",
    run: {
      stdout: JSON.stringify({
        Attr: "y",
        AttrExpr: "x",
        TwoAttrs: "b",
        InlineSpread: "real",
        AttrThenSpread: ["q", "x"],
        AttrSpreadChildren: [1, 2],
        SpreadThenAttr: "x",
        Getter: 5,
      }),
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      const body = (name: string) => {
        const start = out.indexOf(`function ${name}(`);
        return out.slice(start, out.indexOf("\nfunction ", start + 1));
      };
      // A compiled component reads its memo cache. The getter has no JSX
      // attribute form, so that one component is left as written.
      const compiled = [
        "Attr",
        "AttrExpr",
        "TwoAttrs",
        "InlineSpread",
        "AttrThenSpread",
        "AttrSpreadChildren",
        "SpreadThenAttr",
        "Getter",
      ].filter(name => /\$\[\d+\]/.test(body(name)));
      expect(compiled).toEqual([
        "Attr",
        "AttrExpr",
        "TwoAttrs",
        "InlineSpread",
        "AttrThenSpread",
        "AttrSpreadChildren",
        "SpreadThenAttr",
      ]);
      expect(body("Getter")).toContain("get g()");
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

  // A closure reads a `let` that is declared below it (or by its own statement)
  // and reassigned later. Babel declares such a local with `DeclareContext
  // HoistedLet` in front of the closure, also when the local is already a
  // context variable because it is captured and reassigned.
  //
  // The fake `c` records the size of every memo cache, so the second element of
  // each pair is the `_c(n)` of that function. The sizes are the ones
  // babel-plugin-react-compiler 1.0.0 emits. A function that the compiler
  // skips has `[]` there.
  itBundled("react-compiler/ClosureAboveReassignedLet", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { sizes } from "react/compiler-runtime";

        const Row = "row";
        const wrap = fn => fn;

        function DeclarationReadsLetBelow(p) {
          function label() {
            return \`\${n} items\`;
          }
          let n = 0;
          for (const it of p.items) {
            n += it.qty;
          }
          return <b>{label()}</b>;
        }
        function ArrowReadsLetBelow(p) {
          const renderRow = () => <Row items={items} />;
          let items = p.items;
          if (p.onlyActive) {
            items = items.filter(i => i.active);
          }
          return <ul>{renderRow()}</ul>;
        }
        function ArrowReadsItself(p) {
          let render = () => <Row again={render} x={p.x} />;
          render = wrap(render);
          return <div>{render()}</div>;
        }
        function TernaryOnLetBelow(p) {
          const pick = () => (flag ? p.a : p.b);
          let flag = p.flag;
          flag = !flag;
          return <i>{pick()}</i>;
        }

        function render(fn, props) {
          const before = sizes().length;
          const result = fn(props);
          return [result.props.children, sizes().slice(before)];
        }
        console.log(JSON.stringify({
          DeclarationReadsLetBelow: render(DeclarationReadsLetBelow, { items: [{ qty: 2 }, { qty: 3 }] }),
          ArrowReadsLetBelow: render(ArrowReadsLetBelow, {
            items: [{ id: 1, active: true }, { id: 2, active: false }],
            onlyActive: true,
          }),
          ArrowReadsItself: render(ArrowReadsItself, { x: 7 }),
          TernaryOnLetBelow: render(TernaryOnLetBelow, { flag: true, a: "a", b: "b" }),
        }, (key, value) => (typeof value === "function" ? "function" : value)));
      `,
      "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
      "/node_modules/react/index.js": `exports.createElement = () => null;`,
      "/node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = (type, props) => ({ type, props });`,
      "/node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (type, props) => ({ type, props });`,
      "/node_modules/react/compiler-runtime.js": `
        const sizes = [];
        exports.c = size => {
          sizes.push(size);
          return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
        };
        exports.sizes = () => sizes;
      `,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    run: {
      stdout: JSON.stringify({
        DeclarationReadsLetBelow: ["5 items", [4]],
        ArrowReadsLetBelow: [{ type: "row", props: { items: [{ id: 1, active: true }] } }, [3]],
        ArrowReadsItself: [{ type: "row", props: { again: "function", x: 7 } }, [4]],
        TernaryOnLetBelow: ["b", [6]],
      }),
    },
  });

  // A temporary that has to survive as a variable is "promoted": the compiler
  // names it `#t<n>` (or `#T<n>` for a JSX tag, which has to be capitalised to
  // read as a component) after its declaration id, and the printer drops the
  // `#`. Several passes promote: the early return value of a reactive scope,
  // the result of an inlined IIFE with more than one return, and every
  // temporary read across scopes, all through `Environment::promote_temporary`
  // (src/react_compiler/hir/environment.rs). The early return, the IIFE and
  // the namespace-loaded tag below each take a different one of those paths.
  itBundled("react-compiler/PromotedTemporariesAreNamedAfterTheirDeclaration", {
    files: {
      "/entry.jsx": /* jsx */ `
        import * as Lib from "ext";
        import { makeArray } from "ext";

        export function Component({ cond, a, num }) {
          let x = [];
          if (cond) {
            x.push(a);
            return x;
          }
          const arr = (() => {
            if (num > 1) {
              return [];
            }
            return makeArray(num);
          })();
          return <Lib.Stringify value={arr.push(num)} />;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime", "ext"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatchSnapshot();
      // The props object is the component's first temporary.
      expect(out).toMatch(/function Component\(t0\)/);
      // The early return of the first scope is stored in a promoted temporary
      // and compared against the sentinel after the scope.
      expect(out).toMatch(/\bt1 = __EARLY_RETURN_SENTINEL;\s*bb0: \{/);
      expect(out).toMatch(/\bt1 = x;\s*break bb0;/);
      expect(out).toMatch(/if \(t1 !== __EARLY_RETURN_SENTINEL\)\s*return t1;/);
      // The IIFE is inlined into a labeled block. Its two returns assign the
      // promoted temporary that then feeds the `arr` local.
      expect(out).not.toContain("=> {");
      expect(out).toMatch(
        /\blet t3;\s*bb1: \{\s*if \(num > 1\) \{\s*t3 = \[\];\s*break bb1;\s*\}\s*t3 = makeArray\(num\);\s*\}\s*let arr = t3;/,
      );
      // The tag is loaded in one scope and used in another, so it is promoted
      // with the JSX tag spelling.
      expect(out).toMatch(/\blet T0, t2;/);
      expect(out).toContain("T0 = Lib.Stringify;");
      expect(out).toMatch(/\bjsx(?:DEV)?\(T0, \{/);
      // Every promoted name that is read has a `let` (t0 is the parameter).
      const declared = new Set([...out.matchAll(/\blet ([tT]\d+(?:, [tT]\d+)*);/g)].flatMap(m => m[1].split(", ")));
      expect([...declared].sort()).toEqual(["T0", "t1", "t2", "t3"]);
      const used = new Set([...out.matchAll(/\b([tT]\d+)\b/g)].map(m => m[1]));
      expect([...used].sort()).toEqual(["T0", "t0", "t1", "t2", "t3"]);
    },
  });

  // Dead code elimination keeps some stores to a local that nothing reads: the
  // last instruction of a catch handler or of a `for..of` head, and a store
  // whose own value is used (`f(v = 2)`). It pruned `let v` all the same. The
  // first store left then became the declaration, in a scope that did not
  // enclose the other stores: `ReferenceError: v is not defined`.
  const stubReactWithEffect = { ...stubReact, "/node_modules/react/index.js": `exports.useEffect = () => {};` };
  const deadStoreForms = {
    "/entry.js": /* js */ `
      import * as forms from "./forms";
      const props = { bad: "{bad", items: [1, 2], call() {} };
      const lines = [];
      for (const [name, form] of Object.entries(forms)) {
        try {
          lines.push(name + "=" + JSON.stringify(form(props).p));
        } catch (e) {
          lines.push(name + " threw " + e);
        }
      }
      console.log(lines.join("\\n"));
    `,
    "/forms.jsx": /* jsx */ `
      import { useEffect } from "react";

      export function NestedTry(p) {
        useEffect(() => {});
        let v;
        try {
          try {
            JSON.parse(p.bad);
          } catch {
            v = 1;
          }
          JSON.parse(p.bad);
        } catch {
          v = 2;
        }
        return <div />;
      }
      export function SequentialTry(p) {
        useEffect(() => {});
        let v;
        try {
          JSON.parse(p.bad);
        } catch {
          v = 1;
        }
        try {
          JSON.parse(p.bad);
        } catch {
          v = 2;
        }
        return <div />;
      }
      export function DestructureInHandler(p) {
        useEffect(() => {});
        let v;
        try {
          JSON.parse(p.bad);
        } catch {
          [v] = p.items;
        }
        try {
          JSON.parse(p.bad);
        } catch {
          [v] = p.items;
        }
        return <div />;
      }
      export function HandlerThenArgument(p) {
        useEffect(() => {});
        let v;
        try {
          JSON.parse(p.bad);
        } catch {
          v = 1;
        }
        p.call((v = 2));
        return <div />;
      }
      export function HandlerThenLogical(p) {
        useEffect(() => {});
        let v;
        if (p.items) {
          try {
            JSON.parse(p.bad);
          } catch {
            v = 1;
          }
        }
        p.items && (v = 2);
        return <div />;
      }
      // The one read of \`v\` folds to "final".
      export function EveryReadFolded(p) {
        useEffect(() => {});
        let v = "init";
        try {
          try {
            JSON.parse(p.bad);
          } catch {
            v = "a";
          }
          JSON.parse(p.bad);
        } catch {
          v = "b";
        }
        v = "final";
        return <div>{v}</div>;
      }
      // With \`let v\` kept, the compiler leaves these two alone: it does not
      // take a \`for..of\` or \`for..in\` that assigns an outer local.
      export function ForOfThenArgument(p) {
        let v;
        for (v of p.items) p.call();
        p.call((v = 2));
        return <div />;
      }
      export function ForInThenHandler(p) {
        let v;
        for (v in p.items) p.call();
        try {
          JSON.parse(p.bad);
        } catch {
          v = 2;
        }
        return <div />;
      }
    `,
    ...stubReactWithEffect,
  };
  for (const target of ["browser", "bun"] as const) {
    itBundled(`react-compiler/DeadStoreKeepsItsDeclaration-${target}`, {
      files: deadStoreForms,
      reactCompiler: true,
      backend: "cli",
      target,
      run: {
        stdout: `
          DestructureInHandler={}
          EveryReadFolded={"children":"final"}
          ForInThenHandler={}
          ForOfThenArgument={}
          HandlerThenArgument={}
          HandlerThenLogical={}
          NestedTry={}
          SequentialTry={}
        `,
      },
      onAfterBundle(api) {
        // Every form that calls useEffect compiled: the compiler outlines the
        // empty effect callback (client) or drops the effect (ssr), so no
        // call takes `() => {}` any more.
        expect(api.readFile("/out.js")).not.toMatch(/\(\(\) => \{\s*\}\)/);
      },
    });
  }

  // Same cause. In client mode the store left in the `for` update was then a
  // reassignment, inside a memo scope, of a local with no declaration:
  // `panic: Expected identifier to be initialized`.
  itBundled("react-compiler/DeadStoreInForUpdateKeepsItsDeclaration", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useEffect } from "react";

        function App(p) {
          useEffect(() => {});
          let v;
          for (let i = 0; i < 2; v = i++) p.call(i);
          for (let j = 0; j < 2; v = j++) p.call(j);
          return <div />;
        }
        const calls = [];
        App({ call: i => calls.push(i) });
        console.log(calls.join());
      `,
      ...stubReactWithEffect,
    },
    reactCompiler: true,
    backend: "cli",
    target: "browser",
    run: { stdout: "0,1,0,1" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toMatch(/\(\(\) => \{\s*\}\)/);
    },
  });

  // Outside the compiler, the bundler binds a local that holds a `require()` /
  // `import()` export to the export itself: `const { a } = require("./m")`
  // declares nothing, and `ns.a` off `const ns = require("./m")` is an import
  // that prints `ns.a` when it can't be bound. A compiled function gets new
  // symbols for its locals, and the compiler drops a `const ns` it sees no
  // read of. So in there the reads have to stay reads of the namespace object.
  for (const target of ["bun", "browser"] as const) {
    for (const minifyIdentifiers of [false, true]) {
      itBundled(`react-compiler/RequireAndImportLocals-${target}-identifiers=${minifyIdentifiers}`, {
        files: {
          "/entry.ts": /* ts */ `
            import { setFlag } from "./state";
            import * as forms from "./forms";
            setFlag(true);
            const lines: string[] = [];
            for (const [name, form] of Object.entries(forms)) {
              try {
                lines.push(name + "=" + (await form({})));
              } catch (e) {
                lines.push(name + " threw " + e);
              }
            }
            console.log(lines.join("\\n"));
          `,
          "/forms.tsx": /* tsx */ `
            import { useEffect, memo } from "react";
            import { keep } from "./keep";

            export function RequireDestructure() {
              useEffect(() => {});
              const { isFlag } = require("./state") as typeof import("./state");
              return String(isFlag());
            }
            export function RequireDestructureRenamed() {
              useEffect(() => {});
              let { isFlag: read } = require("./state");
              return String(read());
            }
            export function useRequireDestructure() {
              useEffect(() => {});
              const { isFlag } = require("./state");
              return String(isFlag());
            }
            export const MemoRequireDestructure = memo(() => {
              useEffect(() => {});
              const { isFlag } = require("./state");
              return String(isFlag());
            });
            export function AwaitDestructure() {
              useEffect(() => {});
              const load = async () => {
                const { isFlag } = await import("./state");
                return String(isFlag());
              };
              return load();
            }
            export function ThenDestructure() {
              useEffect(() => {});
              return import("./state").then(({ isFlag }) => String(isFlag()));
            }
            export function NamespaceDestructure() {
              useEffect(() => {});
              const ns = require("./state");
              const { isFlag } = ns;
              return String(isFlag());
            }
            export function NamespaceEscapes() {
              useEffect(() => {});
              const ns = require("./state");
              keep(ns);
              return String(ns.isFlag());
            }
            export function NamespaceOfLazyModule() {
              useEffect(() => {});
              const lazy = require("./lazy");
              return lazy.doubled();
            }
            export function NamespaceOfCommonJS() {
              useEffect(() => {});
              const cjs = require("./cjs.cjs");
              return cjs.hello() + cjs.suffix;
            }
            export function NamespaceOfBuiltin() {
              useEffect(() => {});
              const path = require("node:path");
              return path.posix.join("a", "b");
            }
            export function AwaitNamespaceOfBuiltin() {
              useEffect(() => {});
              const load = async () => {
                const path = await import("node:path");
                return path.posix.join("a", "b");
              };
              return load();
            }
            export function ThenNamespaceOfCommonJS() {
              useEffect(() => {});
              return import("./cjs.cjs").then(cjs => cjs.hello());
            }
            export function ThenNamespaceTwice() {
              useEffect(() => {});
              return import("./cjs.cjs")
                .then(cjs => import("./lazy").then(lazy => cjs.hello() + lazy.doubled()))
                .then(text => import("./cjs.cjs").then(cjs => text + cjs.suffix));
            }
            export function plainFunction() {
              const { onlyPlain } = require("./only-plain");
              return onlyPlain();
            }

            // Declared outside the compiled function: the compiler keeps
            // these symbols, so the reads stay bound to the exports.
            const moduleNs = require("./module-ns");
            const { isFlag: moduleIsFlag } = require("./state");
            export function ModuleNamespace() {
              useEffect(() => {});
              return moduleNs.value();
            }
            export function ModuleDestructure() {
              useEffect(() => {});
              return String(moduleIsFlag());
            }
            export function NestedDeclaration() {
              useEffect(() => {});
              function inner() {
                const { isFlag } = require("./state");
                return isFlag();
              }
              return String(inner());
            }
            // A component name, but no hook call and no JSX: not compiled.
            export function ComponentNameNotCompiled() {
              const { isFlag } = require("./state");
              return String(isFlag());
            }
            export function OptOut() {
              "use no memo";
              useEffect(keep);
              const { onlyOptOut } = require("./only-opt-out");
              return onlyOptOut();
            }
            export function optIn() {
              "use memo";
              const { isFlag } = require("./state");
              return String(isFlag());
            }
          `,
          "/state.ts": /* ts */ `
            let flag = false;
            export function setFlag(value: boolean) {
              flag = value;
            }
            export function isFlag() {
              return flag;
            }
          `,
          "/lazy.ts": /* ts */ `
            const table = [1, 2, 3].map(n => n * 2);
            export function doubled() {
              return table.join(",");
            }
          `,
          "/only-plain.ts": /* ts */ `
            export function onlyPlain() {
              return "plain";
            }
            export const notRead = "PLAIN_NOT_READ_SENTINEL";
          `,
          "/only-opt-out.ts": /* ts */ `
            export function onlyOptOut() {
              return "opt-out";
            }
            export const notRead = "OPT_OUT_NOT_READ_SENTINEL";
          `,
          "/module-ns.ts": /* ts */ `
            export function value() {
              return "module-ns";
            }
            export const notRead = "MODULE_NS_NOT_READ_SENTINEL";
          `,
          "/cjs.cjs": /* js */ `
            exports.hello = function () {
              return "hello";
            };
            exports.suffix = "!";
          `,
          "/keep.ts": /* ts */ `
            export function keep(value: unknown) {
              (globalThis as any).kept = value;
            }
          `,
          "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
          "/node_modules/react/index.js": /* js */ `
            export function useEffect() {}
            export function memo(component) {
              return component;
            }
          `,
          "/node_modules/react/compiler-runtime.js": /* js */ `
            export function c(size) {
              return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
            }
          `,
        },
        reactCompiler: true,
        backend: "cli",
        target,
        minifyIdentifiers,
        run: {
          stdout: `
            AwaitDestructure=true
            AwaitNamespaceOfBuiltin=a/b
            ComponentNameNotCompiled=true
            MemoRequireDestructure=true
            ModuleDestructure=true
            ModuleNamespace=module-ns
            NamespaceDestructure=true
            NamespaceEscapes=true
            NamespaceOfBuiltin=a/b
            NamespaceOfCommonJS=hello!
            NamespaceOfLazyModule=2,4,6
            NestedDeclaration=true
            OptOut=opt-out
            RequireDestructure=true
            RequireDestructureRenamed=true
            ThenDestructure=true
            ThenNamespaceOfCommonJS=hello
            ThenNamespaceTwice=hello2,4,6!
            optIn=true
            plainFunction=plain
            useRequireDestructure=true
          `,
        },
        onAfterBundle(api) {
          const out = api.readFile("/out.js");
          // Every component and hook above compiled: the compiler outlines the
          // empty effect callback (client) or drops the effect (ssr), so no
          // call takes `() => {}` any more. The callee name can be minified.
          expect(out).not.toMatch(/\(\(\) => \{\s*\}\)/);
          // A function the compiler leaves alone still reads the export
          // without a namespace object, so tree shaking drops the other one.
          expect(out).not.toContain("PLAIN_NOT_READ_SENTINEL");
          // So does one that opts out of the compiler.
          expect(out).not.toContain("OPT_OUT_NOT_READ_SENTINEL");
          // And a read, in a compiled function, of a local declared outside it.
          expect(out).not.toContain("MODULE_NS_NOT_READ_SENTINEL");
        },
      });
    }
  }

  // The bundler prints an import under the name of the export it links to:
  // `defaultTheme` below prints as `theme`. A compiled function gets new
  // symbols for its parameters, its locals and its temporaries (`t0`, `$`).
  // The renamer has to number them like the symbols of any other function, or
  // a local with the name of that export shadows it:
  // `let theme = custom ?? theme`.
  for (const target of ["bun", "browser"] as const) {
    for (const minifyIdentifiers of [false, true]) {
      itBundled(`react-compiler/LocalNamedLikeAnExportItReads-${target}-identifiers=${minifyIdentifiers}`, {
        files: {
          "/entry.ts": /* ts */ `
            import * as forms from "./forms";
            const lines: string[] = [];
            const check = (flag?: boolean) => {
              if (flag) throw "thrown";
            };
            for (const [name, form] of Object.entries(forms)) {
              try {
                lines.push(name + "=" + form({ custom: "mine", flag: true, list: [{ x: 1 }, { x: 2 }], check }));
                lines.push(name + "=" + form({ list: [{ x: 3 }], check }));
              } catch (e) {
                lines.push(name + " threw " + e);
              }
            }
            console.log(lines.join("\\n"));
          `,
          "/forms.tsx": /* tsx */ `
            import { useEffect, useState, memo, forwardRef } from "react";
            import * as values from "./values";
            import {
              Wrapped as BaseWrapped,
              theme as defaultTheme,
              custom as defaultCustom,
              item as defaultItem,
              s as format,
              e as suffix,
              t0 as first,
              t1 as second,
              $ as dollar,
            } from "./values";

            export function Local({ custom }) {
              useEffect(() => {});
              const theme = custom ?? defaultTheme;
              return theme;
            }
            export function useLocal({ custom }) {
              useEffect(() => {});
              let theme = defaultTheme;
              if (custom) theme = custom + "/" + defaultTheme;
              return theme;
            }
            export const MemoLocal = memo(({ custom }) => {
              useEffect(() => {});
              const theme = custom ?? defaultTheme;
              return theme;
            });
            export function Parameter({ custom }) {
              useEffect(() => {});
              return (custom ?? "none") + " " + defaultCustom;
            }
            export function NamespaceMember({ flag }) {
              useEffect(() => {});
              const theme = flag ? values.theme : "none";
              return theme;
            }
            // The compiler hoists a callback that captures nothing to module
            // level. Its parameter is a new symbol too.
            export function OutlinedParameter({ list }) {
              useEffect(() => {});
              return list.map(item => item.x + defaultItem.y).join(",") + ";" + list.map(s => format(s.x)).join(",");
            }
            export function NestedParameter({ list, custom }) {
              useEffect(() => {});
              return list.map(item => item.x + defaultItem.y + (custom ?? "")).join(",");
            }
            export function CatchBinding({ flag, check }) {
              useEffect(() => {});
              try {
                check(flag);
              } catch (e) {
                return e + suffix;
              }
              return "none" + suffix;
            }
            // The props object is \`t0\`, the memo cache is \`$\`, and the value
            // of a memo block is \`t1\`.
            export function Temporaries({ custom }) {
              const [count] = useState(1);
              const all = [String(custom), count, first, second, dollar];
              return all.join(" ");
            }
            // A function expression declares its own name in its own scope.
            // The compiled function keeps that name, so it is still numbered.
            export const OwnNameForwardRef = forwardRef(function Wrapped({ custom }, ref) {
              useEffect(() => {});
              return "<" + BaseWrapped({ custom, by: "forwardRef" }) + ">";
            });
            export const OwnNameMemo = memo(function Wrapped({ custom }) {
              useEffect(() => {});
              return "<" + BaseWrapped({ custom, by: "memo" }) + ">";
            });
            export const OwnNamePlain = function Wrapped({ custom }) {
              useEffect(() => {});
              return "<" + BaseWrapped({ custom, by: "plain" }) + ">";
            };
          `,
          "/values.ts": /* ts */ `
            export const theme = "dark";
            export const custom = "CUSTOM";
            export const item = { y: 10 };
            export function s(value: number) {
              return "<" + value + ">";
            }
            export const e = "!";
            export const t0 = "T0";
            export const t1 = "T1";
            export const $ = "DOLLAR";
            export function Wrapped({ custom, by }: { custom?: string; by: string }) {
              return by + ":" + custom;
            }
          `,
          "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
          "/node_modules/react/index.js": /* js */ `
            export function useEffect() {}
            export function useState(value) {
              return [value, () => {}];
            }
            export function memo(component) {
              return component;
            }
            export function forwardRef(component) {
              return component;
            }
          `,
          "/node_modules/react/compiler-runtime.js": /* js */ `
            export function c(size) {
              return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
            }
          `,
        },
        reactCompiler: true,
        backend: "cli",
        target,
        minifyIdentifiers,
        run: {
          stdout: `
            CatchBinding=thrown!
            CatchBinding=none!
            Local=mine
            Local=dark
            MemoLocal=mine
            MemoLocal=dark
            NamespaceMember=dark
            NamespaceMember=none
            NestedParameter=11mine,12mine
            NestedParameter=13
            OutlinedParameter=11,12;<1>,<2>
            OutlinedParameter=13;<3>
            OwnNameForwardRef=<forwardRef:mine>
            OwnNameForwardRef=<forwardRef:undefined>
            OwnNameMemo=<memo:mine>
            OwnNameMemo=<memo:undefined>
            OwnNamePlain=<plain:mine>
            OwnNamePlain=<plain:undefined>
            Parameter=mine CUSTOM
            Parameter=none CUSTOM
            Temporaries=mine 1 T0 T1 DOLLAR
            Temporaries=undefined 1 T0 T1 DOLLAR
            useLocal=mine/dark
            useLocal=dark
          `,
        },
        onAfterBundle(api) {
          if (minifyIdentifiers) return;
          const out = api.readFile("/out.js");
          // Every function above compiled: the compiler outlines the empty
          // effect callback (client) or drops the effect (ssr).
          expect(out).not.toMatch(/\(\(\) => \{\s*\}\)/);
          // A local that shares its name with nothing the function reads
          // keeps it.
          expect(out).toMatch(/function Local\(t0\) \{\s*let \{ custom \} = t0;/);
        },
      });
    }
  }

  // The compiler lowers the call the visit pass made of each JSX element into
  // HIR and builds a new call from that. Both steps have to use the call shape
  // of the file's JSX runtime. The classic runtime, and `key` after a spread in
  // the automatic one, calls `factory(type, props, ...children)`: the third
  // argument is a child and not a key, `key` stays in `props`, and no
  // `jsx`/`jsxDEV` is imported.
  const jsxCallShapeEntry = (prelude: string, jsx: string) => /* jsx */ `
    ${prelude}
    export function App({ a, k, rest }) {
      const o = { a };
      return (${jsx});
    }
    console.log(JSON.stringify(App({ a: "A", k: "K", rest: { id: "r" } })));
  `;
  const jsxCallShapeRuntime = {
    "/node_modules/react/package.json": `{"name":"react","main":"./index.js"}`,
    "/node_modules/react/index.js": /* js */ `
      exports.Fragment = "React.Fragment";
      exports.createElement = (type, props, ...children) => ({ createElement: type, props, children });
    `,
    "/node_modules/react/jsx-dev-runtime.js": /* js */ `
      exports.Fragment = "Fragment";
      exports.jsxDEV = (type, props, key) => ({ jsxDEV: type, props, key });
    `,
    "/node_modules/react/compiler-runtime.js": /* js */ `
      exports.c = function useMemoCache(size) {
        return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
      };
    `,
  };
  // `App` was compiled when its memo cache is in the bundle.
  const expectCompiled = (api: { readFile(file: string): string }) =>
    expect(api.readFile("/out.js")).toContain("useMemoCache");

  const classicRuntimes: Record<string, { prelude: string; tsconfig?: string; jsx?: BundlerTestInput["jsx"] }> = {
    Pragma: { prelude: `/** @jsxRuntime classic */ import React from "react";` },
    Tsconfig: { prelude: `import React from "react";`, tsconfig: `{ "compilerOptions": { "jsx": "react" } }` },
    Flags: {
      prelude: `import { createElement as h, Fragment as Frag } from "react";`,
      jsx: { runtime: "classic", factory: "h", fragment: "Frag" },
    },
  };
  for (const [name, { prelude, tsconfig, jsx }] of Object.entries(classicRuntimes)) {
    itBundled(`react-compiler/ClassicRuntime-${name}`, {
      files: {
        "/entry.jsx": jsxCallShapeEntry(
          prelude,
          /* jsx */ `
            <>
              <div title={o.a}>hi</div>
              <p key={k} {...rest}>{a}<b>x</b></p>
              <ul id="u"><li>1</li><li>2</li><li>3</li><li>4</li></ul>
              <span />
            </>
          `,
        ),
        ...(tsconfig && { "/tsconfig.json": tsconfig }),
        ...jsxCallShapeRuntime,
      },
      jsx,
      reactCompiler: true,
      target: "browser",
      backend: "cli",
      onAfterBundle: expectCompiled,
      run: {
        validate({ stdout }) {
          expect(JSON.parse(stdout)).toEqual({
            createElement: "React.Fragment",
            props: null,
            children: [
              { createElement: "div", props: { title: "A" }, children: ["hi"] },
              {
                createElement: "p",
                props: { key: "K", id: "r" },
                children: ["A", { createElement: "b", props: null, children: ["x"] }],
              },
              {
                createElement: "ul",
                props: { id: "u" },
                children: ["1", "2", "3", "4"].map(n => ({ createElement: "li", props: null, children: [n] })),
              },
              { createElement: "span", props: null, children: [] },
            ],
          });
        },
      },
    });
  }

  itBundled("react-compiler/AutomaticRuntimeKeyAfterSpread", {
    files: {
      "/entry.jsx": jsxCallShapeEntry(
        "",
        /* jsx */ `
          <div>
            <p {...rest} key={k}>{a}</p>
            <i key={k} {...rest}>{o.a}</i>
          </div>
        `,
      ),
      ...jsxCallShapeRuntime,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    bundleWarnings: {
      "/entry.jsx": ['"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.'],
    },
    onAfterBundle: expectCompiled,
    run: {
      validate({ stdout }) {
        expect(JSON.parse(stdout)).toEqual({
          jsxDEV: "div",
          props: {
            children: [
              { createElement: "p", props: { id: "r", key: "K" }, children: ["A"] },
              { jsxDEV: "i", props: { id: "r", children: "A" }, key: "K" },
            ],
          },
        });
      },
    },
  });

  // The classic factory is not an operand the compiler sees: it is resolved
  // again when the call is rebuilt. A factory that is a local of the component
  // would look unused and be dropped, so such a component stays uncompiled.
  itBundled("react-compiler/ClassicRuntimeLocalFactoryIsNotCompiled", {
    files: {
      "/entry.jsx": /* jsx */ `
        /** @jsxRuntime classic */
        /** @jsx h */
        export function App({ h, a }) {
          return <div title={a}>hi</div>;
        }
        const createElement = (type, props, ...children) => ({ h: type, props, children });
        console.log(JSON.stringify(App({ h: createElement, a: "A" })));
      `,
      ...jsxCallShapeRuntime,
    },
    reactCompiler: true,
    target: "browser",
    backend: "cli",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("useMemoCache");
    },
    run: { stdout: '{"h":"div","props":{"title":"A"},"children":["hi"]}' },
  });
});

// Three passes kept one copy of their work per basic block or per nesting
// level of a value, so memory grew with the square of the size of a component
// that has no loop at all. The fixpoint in InferMutationAliasingEffects kept
// the incoming state of every block. Codegen cloned the instructions of a
// sequence expression at each level of a `||` chain. The post-dominator graph
// rebuilt a hash index for each block it took out of a map. A chain of 400
// terms took 979 MB, and an array pattern of 300 elements with defaults 1 GB.
test("react-compiler memory does not grow with the square of the size of a component", async () => {
  // A debug build is 20 times slower, and its larger frames overflow the stack
  // on a longer chain.
  const small = isDebug || isASAN;
  const terms = small ? 100 : 400;
  const elements = small ? 120 : 300;
  using dir = tempDir("react-compiler-memory", {
    "empty.jsx": `export default function App() { return null; }`,
    "chain.jsx": `
      import { useState } from "react";
      export default function App(p) {
        const [s] = useState(0);
        const v = ${Array.from({ length: terms }, (_, i) => `(p.a === ${i})`).join(" || ")} || "f";
        return <div>{v}{s}</div>;
      }
    `,
    "pattern.jsx": `
      import { useState } from "react";
      export default function App(p) {
        const [s] = useState(0);
        const [${Array.from({ length: elements }, (_, i) => `e${i} = ${i}`).join(", ")}] = p.items;
        return <div>{e0 + e${elements - 1}}{s}</div>;
      }
    `,
  });

  const peakMB = async (entry: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--react-compiler", "--target=browser", "--external=*", entry],
      env: {
        ...bunEnv,
        // ASAN's quarantine keeps freed blocks resident, which hides the difference.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
          .filter(Boolean)
          .join(":"),
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The component compiled, or there is no component.
    expect(stdout.includes("react/compiler-runtime")).toBe(entry !== "empty.jsx");
    expect(exitCode).toBe(0);
    return proc.resourceUsage()!.maxRSS / 1024 / 1024;
  };

  const [empty, chain, pattern] = await Promise.all([peakMB("empty.jsx"), peakMB("chain.jsx"), peakMB("pattern.jsx")]);
  // Above the empty build, without the fixes: 110 MB and 125 MB for the small
  // inputs, 940 MB and 1050 MB for the large ones.
  const bound = small ? 70 : 300;
  expect(chain - empty).toBeLessThan(bound);
  expect(pattern - empty).toBeLessThan(bound);
});

// validate_locals_not_reassigned_after_render (src/react_compiler/validation)
// records the locals a component's closures capture while walking the
// component body, and reports a nested function that assigns to one of them,
// with a different diagnostic when that function, or one it is nested in, is
// async. `error` is the headline of the diagnostic, or null when the component
// compiles.
//
// In a normal build a reported component is silently left uncompiled, and the
// aliasing validator independently reports the same components, so the
// diagnostic text is the only place this validator's decision is observable.
// That needs the fixture pragma support, which turns compiler diagnostics into
// build errors and is compiled out of release builds (see
// react-compiler-fixtures.test.ts).
const localReassignmentCases = {
  InComponentBody: {
    error: null,
    source: /* jsx */ `
      export function Comp({ items }) {
        let count = 0;
        count = items.length;
        const onClick = () => console.log(count);
        return <button onClick={onClick}>{count}</button>;
      }
    `,
  },
  InSyncCallback: {
    error: "React Compiler: Error: Cannot reassign variable after render completes",
    source: /* jsx */ `
      import { useEffect } from "react";
      export function Comp({ items }) {
        let count = 0;
        useEffect(() => {
          count = items.length;
        });
        return <div>{count}</div>;
      }
    `,
  },
  InAsyncCallback: {
    error: "React Compiler: Error: Cannot reassign variable in async function",
    source: /* jsx */ `
      export function Comp({ load }) {
        let data = null;
        const onClick = async () => {
          data = await load();
        };
        return <button onClick={onClick}>{data}</button>;
      }
    `,
  },
  InSyncCallbackInsideAsyncCallback: {
    error: "React Compiler: Error: Cannot reassign variable in async function",
    source: /* jsx */ `
      export function Comp({ load }) {
        let data = null;
        const onClick = async () => {
          const store = value => {
            data = value;
          };
          store(await load());
        };
        return <button onClick={onClick}>{data}</button>;
      }
    `,
  },
};

test.skipIf(!isDebug && !isASAN)("react-compiler reports which kind of function reassigned a local", async () => {
  using dir = tempDir(
    "react-compiler-reassign",
    Object.fromEntries(Object.entries(localReassignmentCases).map(([name, { source }]) => [`${name}.jsx`, source])),
  );

  const results: Record<string, { error: string | null; memoized: boolean }> = {};
  for (const name of Object.keys(localReassignmentCases)) {
    const result = await Bun.build({
      entrypoints: [join(String(dir), `${name}.jsx`)],
      target: "browser",
      external: ["*"],
      reactCompiler: true,
      // @ts-expect-error test-only option, not in bun-types
      reactCompilerParseTestPragmas: true,
      throw: false,
    });
    const errors = result.logs.filter(log => log.level === "error");
    results[name] = {
      error: errors.length === 0 ? null : errors.map(log => String(log.message).split(".")[0]).join("\n"),
      memoized: result.success && /\b_c\(\d+\)/.test(await result.outputs[0].text()),
    };
  }

  expect(results).toEqual(
    Object.fromEntries(
      Object.entries(localReassignmentCases).map(([name, { error }]) => [name, { error, memoized: error === null }]),
    ),
  );
});

// RenameVariables reaches a nested function expression through its
// `visit_value` override. The shared walker for a function body recursed into
// it a second time, so a function at depth d was walked 2^d times: depth 25
// took 5 seconds and depth 30 did not finish.
test("react-compiler compile time is not exponential in the function nesting depth", async () => {
  const depth = 40;
  const open = "(() => ";
  const close = ")()";
  using dir = tempDir("react-compiler-nesting", {
    "entry.jsx": `
      import { useState } from "react";
      export default function App(p) {
        const [s] = useState(0);
        const v = ${Buffer.alloc(open.length * depth, open)}p.a + s${Buffer.alloc(close.length * depth, close)};
        return <div>{v}</div>;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--react-compiler", "--target=browser", "--external=*", "entry.jsx"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // The outermost call is inlined. The other arrows stay, in one memoized scope.
  expect(stdout).toContain("p.a + s");
  expect(stdout).toMatch(/\b_c\(\d+\)/);
  expect(exitCode).toBe(0);
});
