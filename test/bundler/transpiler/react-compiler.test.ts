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
