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
