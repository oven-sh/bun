import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// React Compiler (experimental) — `bun build --react-compiler` /
// `Bun.build({ reactCompiler: true })`. The compiler rewrites components and
// hooks to use a memo cache from `react/compiler-runtime` (ships with
// react >= 19). These tests stub that runtime (plus the jsx runtime) with a
// single-instance cache so the bundle can execute without installing React:
// calling a component twice with the same props must only invoke the jsx
// factory once when compilation happened.
//
// Each test runs the full compiler pipeline (parse -> semantic analysis ->
// HIR/SSA/inference/codegen -> emit) in the spawned build process, so scale
// the 5s local-release timeout like other heavier bundler suites do
// (bundler_plugin.test.ts, bundler_edgecase.test.ts). CI uses its own
// timeouts and ignores this.
const timeoutScale = 3;
//
// NOTE: the first key of `files` is the entry point, so the stubs must be
// spread after it.
const runtimeStubs = {
  "/node_modules/react/compiler-runtime.js": /* js */ `
    const sentinel = Symbol.for("react.memo_cache_sentinel");
    let cache = null;
    export function c(n) {
      if (cache === null) {
        cache = new Array(n).fill(sentinel);
      }
      return cache;
    }
  `,
  "/node_modules/react/jsx-runtime.js": /* js */ `
    export function jsx(type, props, key) {
      globalThis.jsxCalls = (globalThis.jsxCalls ?? 0) + 1;
      return { type, props, key };
    }
    export const jsxs = jsx;
    export const Fragment = Symbol.for("jsx.fragment");
  `,
  "/node_modules/react/jsx-dev-runtime.js": /* js */ `
    export function jsxDEV(type, props, key, source, self) {
      globalThis.jsxCalls = (globalThis.jsxCalls ?? 0) + 1;
      return { type, props, key };
    }
    export const Fragment = Symbol.for("jsx.fragment");
  `,
};

describe("bundler", () => {
  for (const backend of ["cli", "api"] as const) {
    itBundled(`react-compiler/${backend}/MemoizesComponent`, {
      backend,
      reactCompiler: true,
      timeoutScale,
      files: {
        "/entry.jsx": /* jsx */ `
          function Box({ label }) {
            const upper = label.toUpperCase();
            return <div>{upper}</div>;
          }
          const first = Box({ label: "hello" });
          const second = Box({ label: "hello" });
          console.log(globalThis.jsxCalls);
          console.log(first === second);
          console.log(first.props.children);
        `,
        ...runtimeStubs,
      },
      run: {
        stdout: "1\ntrue\nHELLO",
      },
      onAfterBundle(api) {
        api.expectFile("out.js").toInclude("react/compiler-runtime");
      },
    });
  }

  itBundled("react-compiler/OffByDefault", {
    timeoutScale,
    files: {
      "/entry.jsx": /* jsx */ `
        function Box({ label }) {
          return <div>{label}</div>;
        }
        Box({ label: "a" });
        Box({ label: "a" });
        console.log(globalThis.jsxCalls);
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "2",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("react/compiler-runtime");
    },
  });

  itBundled("react-compiler/UseNoMemoDirective", {
    backend: "cli",
    reactCompiler: true,
    timeoutScale,
    files: {
      "/entry.jsx": /* jsx */ `
        function Box({ label }) {
          "use no memo";
          return <div>{label}</div>;
        }
        Box({ label: "a" });
        Box({ label: "a" });
        console.log(globalThis.jsxCalls);
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "2",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("react/compiler-runtime");
    },
  });

  itBundled("react-compiler/SkipsNodeModules", {
    backend: "cli",
    reactCompiler: true,
    timeoutScale,
    files: {
      "/entry.jsx": /* jsx */ `
        import { LibBox } from "some-ui-lib";
        LibBox({ label: "a" });
        LibBox({ label: "a" });
        console.log(globalThis.jsxCalls);
      `,
      "/node_modules/some-ui-lib/index.jsx": /* jsx */ `
        export function LibBox({ label }) {
          return <div>{label}</div>;
        }
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "2",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("react/compiler-runtime");
    },
  });

  // The vendored oxc -> Babel AST converter has `todo!()` panics for a few
  // constructs (`#field in obj`, `import foo = require(...)`, ...). Bun must
  // skip such files instead of reaching those panics (panic = abort).
  itBundled("react-compiler/UnsupportedSyntaxBailsGracefully", {
    backend: "cli",
    reactCompiler: true,
    timeoutScale,
    files: {
      "/entry.jsx": /* jsx */ `
        class Brand {
          static #tag;
          static has(obj) {
            return #tag in obj;
          }
        }
        function Box({ label }) {
          return <div>{label + Brand.has({})}</div>;
        }
        const el = Box({ label: "x" });
        console.log(el.props.children);
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "xfalse",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("react/compiler-runtime");
    },
  });

  itBundled("react-compiler/TypeScriptComponent", {
    backend: "cli",
    reactCompiler: true,
    timeoutScale,
    files: {
      "/entry.tsx": /* tsx */ `
        interface Props {
          label: string;
        }
        function Box({ label }: Props) {
          const upper: string = label.toUpperCase();
          return <div>{upper}</div>;
        }
        const first = Box({ label: "ts" });
        const second = Box({ label: "ts" });
        console.log(globalThis.jsxCalls);
        console.log(first === second);
        console.log(first.props.children);
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "1\ntrue\nTS",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toInclude("react/compiler-runtime");
    },
  });

  itBundled("react-compiler/CustomHookMemoized", {
    backend: "cli",
    reactCompiler: true,
    timeoutScale,
    files: {
      "/entry.jsx": /* jsx */ `
        import { useStyles } from "./useStyles.js";
        function Box({ size }) {
          const styles = useStyles(size);
          return <div>{styles.width}</div>;
        }
        const first = Box({ size: 2 });
        const second = Box({ size: 2 });
        console.log(first === second);
        console.log(first.props.children);
      `,
      "/useStyles.js": /* js */ `
        export function useStyles(size) {
          return { width: size * 100 };
        }
      `,
      ...runtimeStubs,
    },
    run: {
      stdout: "true\n200",
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toInclude("react/compiler-runtime");
    },
  });
});
