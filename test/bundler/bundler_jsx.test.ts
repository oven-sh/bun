import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { BundlerTestInput, itBundled } from "./expectBundled";

const helpers = {
  "/node_modules/bun-test-helpers/index.js": /* js */ `
    export function print(arg) {
      const replacer = (_, val) => {
        if(typeof val === "function") {
          if(val.name) return 'Function:' + val.name;
          return val.toString();
        }
        if(typeof val === "symbol") return val.toString();
        if(val === undefined) return "undefined";
        if(val === null) return "null";
        return val;
      }
      const stringified = JSON.stringify(arg, replacer);
      if(!process.env.IS_TEST_RUNNER) {
        console.log(arg);
      }
      console.log(stringified);
    }
  `,
  "/node_modules/react/jsx-dev-runtime.js": /* js */ `
    const $$typeof = Symbol.for("jsxdev");
    export function jsxDEV(type, props, key, source, self) {
      return {
        $$typeof, type, props, key, source, self
      } 
    }
    export const Fragment = Symbol.for("jsxdev.fragment");
  `,
  "/node_modules/react/jsx-runtime.js": /* js */ `
    const $$typeof = Symbol.for("jsx");
    export function jsx(type, props, key) {
      return {
        $$typeof, type, props, key
      } 
    }
    export const Fragment = Symbol.for("jsx.fragment");
  `,
  "/node_modules/custom-jsx-dev/index.js": /* js */ `
    export function jsxDEV(type, props, key, source, self) {
      return ['custom-jsx-dev', type, props, key, source, self]
    }
    export const Fragment = "CustomFragment"
  `,
  "/node_modules/custom-jsx/index.js": /* js */ `
    export function jsx(a, b, c) {
      return ['custom-jsx', a, b, c]
    }
    export const Fragment = "CustomFragment"
  `,
  "/node_modules/custom-classic/index.js": /* js */ `
    export function createElement(type, props, ...children) {
      return ['custom-classic', type, props, children]
    }
    export const Fragment = "CustomFragment"
    export const something = "something"
  `,
  "/node_modules/custom-automatic/jsx-runtime.js": /* js */ `
    const $$typeof = Symbol.for("custom_jsx");
    export function jsx(type, props, key) {
      return {
        $$typeof, type, props, key
      } 
    }
    export const Fragment = Symbol.for("custom.fragment");
  `,
  "/node_modules/custom-automatic/jsx-dev-runtime.js": /* js */ `
    const $$typeof = Symbol.for("custom_jsxdev");
    export function jsxDEV(type, props, key, source, self) {
      return {
        $$typeof, type, props, key, source, self
      } 
    }
    export const Fragment = Symbol.for("custom_dev.fragment");
  `,
  "/node_modules/custom-automatic/index.js": /* js */ `
    export const Fragment = "FAILED"
  `,
  "/node_modules/react/index.js": /* js */ `
    export function createElement(type, props, ...children) {
      return ['react', type, props, children]
    }
    export const Fragment = Symbol.for("react.fragment")

    export const fn = () => {
      throw new Error('test failed')
    }
    export const something = 'test failed';
  `,
  "/node_modules/custom-renamed/index.js": /* js */ `
    export function fn(type, props, ...children) {
      return ['custom-renamed', type, props, children]
    }
    export const Fragment = "CustomFragment"
    export const something = "something"
  `,
  "/node_modules/preact/index.js": /* js */ `
    export function h(type, props, ...children) {
      return ['preact', type, props, children]
    }
    export const Fragment = "PreactFragment"
  `,
};

function itBundledDevAndProd(
  id: string,
  opts: BundlerTestInput & {
    devStdout?: string;
    prodStdout?: string;
    devTodo?: boolean;
    prodTodo?: boolean;
  },
) {
  const { devStdout, prodStdout, devTodo, prodTodo, ...rest } = opts;
  itBundled(id + "Dev", {
    ...rest,
    todo: rest.todo || devTodo,
    env: {
      NODE_ENV: "development",
    },
    run: devStdout
      ? {
          ...(rest.run === true ? {} : rest.run),
          stdout: devStdout,
        }
      : rest.run,
  });
  itBundled(id + "Prod", {
    ...rest,
    todo: rest.todo || prodTodo,
    env: {
      NODE_ENV: "production",
    },
    run: prodStdout
      ? {
          ...(rest.run === true ? {} : rest.run),
          stdout: prodStdout,
        }
      : rest.run,
  });
}

describe("bundler", () => {
  itBundledDevAndProd("jsx/Automatic", {
    files: {
      "index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        const Component = 'hello'
        print(<div>Hello World</div>)
        print(<div className="container"><Component prop={2}><h1 onClick={() => 1}>hello</h1></Component></div>)
      `,
      ...helpers,
    },
    target: "bun",
    devStdout: `
      {"$$typeof":"Symbol(jsxdev)","type":"div","props":{"children":"Hello World"},"key":"undefined","source":false,"self":"undefined"}
      {"$$typeof":"Symbol(jsxdev)","type":"div","props":{"className":"container","children":{"$$typeof":"Symbol(jsxdev)","type":"hello","props":{"prop":2,"children":{"$$typeof":"Symbol(jsxdev)","type":"h1","props":{"onClick":"Function:onClick","children":"hello"},"key":"undefined","source":false,"self":"undefined"}},"key":"undefined","source":false,"self":"undefined"}},"key":"undefined","source":false,"self":"undefined"}
    `,
    prodStdout: `
      {"$$typeof":"Symbol(jsx)","type":"div","props":{"children":"Hello World"},"key":"undefined"}
      {"$$typeof":"Symbol(jsx)","type":"div","props":{"className":"container","children":{"$$typeof":"Symbol(jsx)","type":"hello","props":{"prop":2,"children":{"$$typeof":"Symbol(jsx)","type":"h1","props":{"onClick":"Function:onClick","children":"hello"},"key":"undefined"}},"key":"undefined"}},"key":"undefined"}
    `,
  });
  // bun does not do the production transform for fragments as good as it could be right now.
  itBundledDevAndProd("jsx/AutomaticFragment", {
    todo: true,
    files: {
      "index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        const Component = 'hello'
        print(<div>Hello World</div>)
        print(<div className="container"><Component prop={2}><h1 onClick={() => 1}>hello</h1></Component></div>)
        print(<>Fragment</>)
      `,
      ...helpers,
    },
    target: "bun",
    devStdout: `
      {"$$typeof":"Symbol(jsxdev)","type":"Symbol(jsxdev.fragment)","props":{"children":"Fragment"},"key":"undefined","source":false,"self":"undefined"}
    `,
    prodStdout: `
      {"$$typeof":"Symbol(jsx)","type":"Symbol("jsx.fragment")","key":"null","ref":"null","props":{"children":"Fragment"},"_owner":"null"}
    `,
  });
  // A used `Fragment` import must not be reported as a duplicate of the
  // auto-imported JSX `Fragment` helper that shares its name at module scope.
  itBundledDevAndProd("jsx/AutomaticFragmentNamedImport", {
    files: {
      "/index.tsx": /* tsx */ `
        import { print } from 'bun-test-helpers'
        import { Fragment } from 'react'
        const F = Fragment
        const el = <>hi</>
        print([typeof F, typeof el])
      `,
      ...helpers,
    },
    target: "bun",
    devStdout: `["symbol","object"]`,
    prodStdout: `["symbol","object"]`,
  });
  // A user's local `jsx` / `jsxDEV` / `Fragment` binding in the scope
  // containing the first JSX element must not capture the automatic JSX
  // runtime import.
  itBundledDevAndProd("jsx/AutomaticLocalShadow", {
    files: {
      "/index.tsx": /* tsx */ `
        import { print } from 'bun-test-helpers'
        function f() {
          let jsx: any
          let jsxDEV: any
          let Fragment: any
          const el = <><div /></>
          return [el, jsx, jsxDEV, Fragment]
        }
        const [el, a, b, c] = f()
        print([el, a, b, c])
      `,
      ...helpers,
    },
    target: "bun",
    devStdout: `
      [{"$$typeof":"Symbol(jsxdev)","type":"Symbol(jsxdev.fragment)","props":{"children":{"$$typeof":"Symbol(jsxdev)","type":"div","props":{},"key":"undefined","source":false,"self":"undefined"}},"key":"undefined","source":false,"self":"undefined"},"undefined","undefined","undefined"]
    `,
    prodStdout: `
      [{"$$typeof":"Symbol(jsx)","type":"Symbol(jsx.fragment)","props":{"children":{"$$typeof":"Symbol(jsx)","type":"div","props":{},"key":"undefined"}},"key":"undefined"},"undefined","undefined","undefined"]
    `,
  });
  // Same as above but with `--minify-identifiers`. Covers jsx / jsxs /
  // Fragment / createElement (prod) and jsxDEV / Fragment (dev).
  // The property under test is that the minified names assigned to the
  // auto-imported runtime helpers and the user's local `let` bindings are
  // pairwise distinct; literal minified slot names are not pinned.
  function expectMinifiedRuntimeImportsNotShadowed(out: string, runtimeKinds: string[]) {
    const importClauses = [...out.matchAll(/^import \{([^}]+)\} from /gm)].map(m => m[1]).join(",");
    const importAliases: Record<string, string> = {};
    for (const [, orig, alias] of importClauses.matchAll(/\b(\w+) as (\w+)\b/g)) {
      importAliases[orig] = alias;
    }
    const locals = [...out.matchAll(/\blet (\w+);/g)].map(m => m[1]);
    expect(Object.keys(importAliases).sort()).toEqual([...runtimeKinds].sort());
    expect(locals).toHaveLength(runtimeKinds.length);
    for (const kind of runtimeKinds) {
      expect({ kind, alias: importAliases[kind], locals }).toEqual({
        kind,
        alias: expect.not.stringMatching(new RegExp(`^(${locals.join("|")})$`)),
        locals,
      });
    }
  }
  itBundled("jsx/AutomaticLocalShadowMinifyIdentifiersProd", {
    files: {
      "/index.tsx": /* tsx */ `
        export function f() {
          let jsx: any
          let jsxs: any
          let Fragment: any
          let createElement: any
          const props = {}
          const els = [<div />, <div><a/><b/></div>, <><div /></>, <div {...props} key="k" />]
          return [els, jsx, jsxs, Fragment, createElement]
        }
      `,
    },
    external: ["react", "react/*"],
    minifyIdentifiers: true,
    env: {
      NODE_ENV: "production",
    },
    bundleWarnings: {
      "/index.tsx": ['"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.'],
    },
    onAfterBundle(api) {
      expectMinifiedRuntimeImportsNotShadowed(api.readFile("out.js"), ["jsx", "jsxs", "Fragment", "createElement"]);
    },
  });
  itBundled("jsx/AutomaticLocalShadowMinifyIdentifiersDev", {
    files: {
      "/index.tsx": /* tsx */ `
        export function f() {
          let jsxDEV: any
          let Fragment: any
          const els = [<div />, <><div /></>]
          return [els, jsxDEV, Fragment]
        }
      `,
    },
    external: ["react", "react/*"],
    minifyIdentifiers: true,
    env: {
      NODE_ENV: "development",
    },
    onAfterBundle(api) {
      expectMinifiedRuntimeImportsNotShadowed(api.readFile("out.js"), ["jsxDEV", "Fragment"]);
    },
  });
  itBundledDevAndProd("jsx/ImportSource", {
    prodTodo: true,
    files: {
      "/index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      importSource: "custom-automatic",
    },
    devStdout: `
      [{"$$typeof":"Symbol(custom_jsxdev)","type":"div","props":{"props":123,"children":"Hello World"},"key":"undefined","source":false,"self":"undefined"},{"$$typeof":"Symbol(custom_jsxdev)","type":"Symbol(custom_dev.fragment)","props":{"children":"Fragment"},"key":"undefined","source":false,"self":"undefined"}]
    `,
    prodStdout: `
      [{"$$typeof":"Symbol(custom_jsx)","type":"div","props":{"props":123,"children":"Hello World"},"key":"undefined"},{"$$typeof":"Symbol(custom_jsx)","type":"Symbol(custom_dev.fragment)","props":{"children":"Fragment"},"key":"undefined"}]
    `,
  });
  itBundledDevAndProd("jsx/Classic", {
    files: {
      "/index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        // not react to catch if bun auto imports or uses the global
        import * as React from 'custom-classic'
        print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      importSource: "ignore-me",
    },
    run: {
      stdout: `
        [["custom-classic","div",{"props":123},["Hello World"]],["custom-classic","CustomFragment","null",["Fragment"]]]
      `,
    },
  });
  itBundledDevAndProd("jsx/ClassicPragma", {
    files: {
      "/index.jsx": /* js*/ `
        // @jsx fn
        // @jsxFrag something
        import { print } from 'bun-test-helpers'
        import { fn, something } from 'custom-renamed'
        print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      importSource: "ignore-me",
    },
    run: {
      stdout: `
        [["custom-renamed","div",{"props":123},["Hello World"]],["custom-renamed","something","null",["Fragment"]]]
      `,
    },
  });
  itBundledDevAndProd("jsx/PragmaMultiple", {
    todo: true,
    files: {
      "/index.jsx": /* js*/ `
        import './classic.jsx'
        import './classic-renamed.jsx'
        import './automatic.jsx'
        import './automatic-source2.jsx'
      `,
      "/classic.jsx": /* js*/ `
        /* @jsxRuntime classic */
        import { print } from 'bun-test-helpers'
        // not react to catch if bun auto imports or uses the global
        import * as React from 'custom-classic'
        print(['classic.jsx',<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      "/classic-renamed.jsx": /* js*/ `
        /* @jsxRuntime classic */
        // @jsx fn
        // @jsxFrag something
        import { print } from 'bun-test-helpers'
        import { fn, something } from 'custom-renamed'
        print(['classic-renamed.jsx',<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      "/automatic.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        print(['automatic.jsx',<div props={123}>Hello World</div>, process.env.NODE_ENV === 'production' ? '' : <>Fragment</>])
      `,
      "/automatic-source2.jsx": /* js*/ `
        // @jsxImportSource custom-automatic
        import { print } from 'bun-test-helpers'
        print(['automatic-source2.jsx',<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    devStdout: `
      ["classic.jsx",["custom-classic","div",{"props":123},["Hello World"]],["custom-classic","CustomFragment","null",["Fragment"]]]
      ["classic-renamed.jsx",["custom-renamed","div",{"props":123},["Hello World"]],["custom-renamed","something","null",["Fragment"]]]
      ["automatic.jsx",{"$$typeof":"Symbol(jsxdev)","type":"div","props":{"props":123,"children":"Hello World"},"key":"undefined","source":false,"self":"undefined"},{"$$typeof":"Symbol(jsxdev)","type":"Symbol(jsxdev.fragment)","props":{"children":"Fragment"},"key":"undefined","source":false,"self":"undefined"}]
      ["automatic-source2.jsx",{"$$typeof":"Symbol(custom_jsxdev)","type":"div","props":{"props":123,"children":"Hello World"},"key":"undefined","source":false,"self":"undefined"},{"$$typeof":"Symbol(custom_jsxdev)","type":"Symbol(custom_dev.fragment)","props":{"children":"Fragment"},"key":"undefined","source":false,"self":"undefined"}]
    `,
    prodStdout: `
      ["classic.jsx",["custom-classic","div",{"props":123},["Hello World"]],["custom-classic","CustomFragment","null",["Fragment"]]]
      ["classic-renamed.jsx",["custom-renamed","div",{"props":123},["Hello World"]],["custom-renamed","something","null",["Fragment"]]]
      ["automatic.jsx",{"$$typeof":"Symbol(react.element)","type":"div","key":"null","ref":"null","props":{"props":123,"children":"Hello World"},"_owner":"null"},""]
      ["automatic-source2.jsx",{"$$typeof":"Symbol(custom_jsx)","type":"div","props":{"props":123,"children":"Hello World"},"key":"undefined"},{"$$typeof":"Symbol(custom_jsx)","type":"Symbol(custom.fragment)","props":{"children":"Fragment"},"key":"undefined"}]
    `,
  });
  itBundledDevAndProd("jsx/Factory", {
    files: {
      "/index.jsx": /* js*/ `
        const h = () => 'hello'
        const Fragment = 123;

        import * as React from "react";
        import { print } from 'bun-test-helpers'
        print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      factory: "h",
    },
    run: {
      stdout: `
        [\"hello\",\"hello\"]
      `,
    },
  });
  itBundledDevAndProd("jsx/FactoryImport", {
    files: {
      "/index.jsx": /* js*/ `
      import { h, fragment } from './jsx.ts';
      const Fragment = 123;
      
      import { print } from 'bun-test-helpers'
      print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      "/jsx.ts": /* ts */ `
        export const h = () => 'hello factory';
        export const fragment = () => 'hello fragment';
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      factory: "h",
      fragment: "fragment",
    },
    run: {
      stdout: `
        [\"hello factory\",\"hello factory\"]
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).toContain("h(fragment");
    },
  });
  itBundledDevAndProd("jsx/FactoryImportExplicitReactDefault", {
    files: {
      "/index.jsx": /* js*/ `
      import { print } from 'bun-test-helpers'
      import * as React from 'react';
      print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      factory: "React.createElement",
      fragment: "React.Fragment",
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).toContain(" createElement");
      expect(api.readFile("out.js")).toContain("(Fragment");
    },
  });
  itBundledDevAndProd("jsx/FactoryImportExplicitReactDefaultExternal", {
    files: {
      "/index.jsx": /* js*/ `
      import { print } from 'bun-test-helpers'
      import * as React from 'react';
      print([<div props={123}>Hello World</div>, <>Fragment</>])
      `,
      ...helpers,
    },
    target: "bun",
    jsx: {
      runtime: "classic",
      factory: "React.createElement",
      fragment: "React.Fragment",
    },
    external: ["react"],
    onAfterBundle(api) {
      const file = api.readFile("out.js");
      expect(file).toContain("React.createElement");
      expect(file).toContain("React.Fragment");
      expect(file).toContain('import * as React from "react"');
    },
  });
  itBundled("jsx/jsxImportSource pragma works", {
    files: {
      "/index.jsx": /* jsx */ `
      // @jsxImportSource hello
      console.log(<div>Hello World</div>);
      `,
      "/node_modules/hello/jsx-dev-runtime.js": /* js */ `
        export function jsxDEV(type, props, key) {
          return {
            $$typeof: Symbol("hello_jsxDEV"), type, props, key
          }
        }
      `,
    },
    outdir: "/out",
    target: "browser",
    run: {
      stdout: `{\n  $$typeof: Symbol(hello_jsxDEV),\n  type: \"div\",\n  props: {\n    children: \"Hello World\",\n  },\n  key: undefined,\n}`,
    },
  });

  // The automatic runtime passes a lone spread object directly as props.
  {
    const config = { a: 1, nested: { list: [2, "three", { four: null }] } };
    const withChild = { ...config, children: "kid" };
    itBundled("jsx/SpreadOfObjectDefineKeepsOtherUses", {
      files: {
        "/index.jsx": /* jsx */ `
          import { inOtherFile } from "./other.jsx";
          const before = CONFIG;
          const spread = <div {...CONFIG} />;
          const child = <div {...CONFIG}>kid</div>;
          console.log(JSON.stringify([before, spread.props, child.props, CONFIG, inOtherFile]));
        `,
        "/other.jsx": /* jsx */ `
          const child = <a {...CONFIG}>kid</a>;
          export const inOtherFile = [child.props, CONFIG];
        `,
        ...helpers,
      },
      target: "bun",
      define: { CONFIG: JSON.stringify(config) },
      run: { stdout: JSON.stringify([config, config, withChild, config, [withChild, config]]) },
    });
  }

  // The classic transform reads the first member of the factory and fragment
  // member lists. A factory or fragment option whose text has no identifier
  // in it ("." or "..") must keep the list that was configured before it,
  // instead of reaching the parser as an empty list (which crashed it with
  // "index out of bounds: the len is 0 but the index is 0").
  describe("factoryMemberList", () => {
    // Defines the default factory and fragment (React.createElement and
    // React.Fragment), so the output shows which factory the transform used.
    const defaultFactoryPrelude = /* js */ `
      const React = {
        createElement: (tag, props) => ["default factory", tag, props],
        Fragment: "default fragment",
      };
    `;
    const defaultFactoryStdout = `[["default factory","a",null],["default factory","default fragment",null]]`;

    itBundled("jsx/TsconfigFactoryWithoutIdentifierKeepsDefault", {
      files: {
        "/index.tsx": /* tsx */ `
          ${defaultFactoryPrelude}
          console.log(JSON.stringify([<a></a>, <></>]));
        `,
        "/tsconfig.json": /* json */ `{
          "compilerOptions": {
            "jsx": "react",
            "jsxFactory": ".",
            "jsxFragmentFactory": ".."
          }
        }`,
      },
      target: "bun",
      bundleWarnings: {
        "/tsconfig.json": ['Invalid JSX member expression: "."', 'Invalid JSX member expression: ".."'],
      },
      run: { stdout: defaultFactoryStdout },
    });

    itBundled("jsx/TsconfigFactoryNotAnIdentifierKeepsDefault", {
      files: {
        "/index.tsx": /* tsx */ `
          ${defaultFactoryPrelude}
          console.log(JSON.stringify([<a></a>, <></>]));
        `,
        "/tsconfig.json": /* json */ `{
          "compilerOptions": {
            "jsx": "react",
            "jsxFactory": "foo-bar",
            "jsxFragmentFactory": ""
          }
        }`,
      },
      target: "bun",
      // An empty string is treated as unset and does not warn.
      bundleWarnings: {
        "/tsconfig.json": ['Invalid JSX member expression: "foo-bar"'],
      },
      run: { stdout: defaultFactoryStdout },
    });

    test("bun run keeps the default factory when tsconfig jsxFactory has no identifier", async () => {
      using dir = tempDir("jsx-factory-without-identifier", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: ".", jsxFragmentFactory: "." },
        }),
        "index.tsx": `
          ${defaultFactoryPrelude}
          console.log(JSON.stringify([<a></a>, <></>]));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.tsx"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe(defaultFactoryStdout + "\n");
      expect(stderr).toContain('Invalid JSX member expression: "."');
      expect(exitCode).toBe(0);
    });

    test("Bun.Transpiler keeps the default factory when tsconfig jsxFactory is empty", async () => {
      const tsconfig = JSON.stringify({
        compilerOptions: { jsx: "react", jsxFactory: "", jsxFragmentFactory: "" },
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const transpiler = new Bun.Transpiler({ loader: "jsx", tsconfig: ${JSON.stringify(tsconfig)} });
           console.log(transpiler.transformSync("export default [<a></a>, <></>];"));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe(
        'export default [React.createElement("a", null), React.createElement(React.Fragment, null)];\n\n',
      );
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    itBundled("jsx/PragmaFactoryWithoutIdentifierKeepsDefault", {
      files: {
        "/index.jsx": /* jsx */ `
          // @jsx .
          // @jsxFrag ..
          ${defaultFactoryPrelude}
          console.log(JSON.stringify([<a></a>, <></>]));
        `,
      },
      target: "bun",
      jsx: { runtime: "classic" },
      bundleWarnings: {
        "/index.jsx": ['Invalid JSX factory: "."', 'Invalid JSX fragment: ".."'],
      },
      run: { stdout: defaultFactoryStdout },
    });

    // "React" is a prefix of the default "React.createElement" / "React.Fragment".
    // It used to compare equal to the default, which left the default in place.
    const prefixPrelude = /* js */ `
      function React(tag, props) {
        return [tag === React ? "fragment" : tag, props];
      }
    `;
    const prefixStdout = `[["a",null],["fragment",null]]`;

    // "cli" passes the option as --jsx-factory, "api" as Bun.build({ jsx: { factory } }).
    for (const backend of ["cli", "api"] as const) {
      itBundled(`jsx/FactoryPrefixOfDefault-${backend}`, {
        files: {
          "/index.jsx": /* jsx */ `
            ${prefixPrelude}
            console.log(JSON.stringify([<a></a>, <></>]));
          `,
        },
        backend,
        target: "bun",
        jsx: { runtime: "classic", factory: "React", fragment: "React" },
        run: { stdout: prefixStdout },
        onAfterBundle(api) {
          expect(api.readFile("out.js")).toContain("React(React, null)");
        },
      });
    }

    itBundled("jsx/PragmaFactoryPrefixOfDefault", {
      files: {
        "/index.jsx": /* jsx */ `
          // @jsx React
          // @jsxFrag React
          ${prefixPrelude}
          console.log(JSON.stringify([<a></a>, <></>]));
        `,
      },
      target: "bun",
      jsx: { runtime: "classic" },
      run: { stdout: prefixStdout },
      onAfterBundle(api) {
        expect(api.readFile("out.js")).toContain("React(React, null)");
      },
    });
  });

  // Test for jsxSideEffects option - equivalent to esbuild's TestJSXSideEffects
  describe("jsxSideEffects", () => {
    itBundled("jsx/sideEffectsDefault", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "classic",
        factory: "React.createElement",
        fragment: "React.Fragment",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // Default behavior: should include /* @__PURE__ */ comments
        expect(file).toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // index.jsx
          console.log(/* @__PURE__ */ React.createElement("a", null));
          console.log(/* @__PURE__ */ React.createElement(React.Fragment, null));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrue", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "classic",
        factory: "React.createElement",
        fragment: "React.Fragment",
        sideEffects: true,
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(file).toContain("React.createElement");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // index.jsx
          console.log(React.createElement("a", null));
          console.log(React.createElement(React.Fragment, null));"
        `);
      },
    });

    // Test automatic JSX runtime with side effects
    itBundled("jsx/sideEffectsDefaultAutomatic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "automatic",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // Default behavior: should include /* @__PURE__ */ comments
        expect(file).toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-dev-runtime.js
          var $$typeof = Symbol.for("jsxdev");
          function jsxDEV(type, props, key, source, self) {
            return {
              $$typeof,
              type,
              props,
              key,
              source,
              self
            };
          }
          var Fragment = Symbol.for("jsxdev.fragment");

          // index.jsx
          console.log(/* @__PURE__ */ jsxDEV("a", {}, undefined, false, undefined, this));
          console.log(/* @__PURE__ */ jsxDEV(Fragment, {}, undefined, false, undefined, this));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueAutomatic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "automatic",
        sideEffects: true,
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-dev-runtime.js
          var $$typeof = Symbol.for("jsxdev");
          function jsxDEV(type, props, key, source, self) {
            return {
              $$typeof,
              type,
              props,
              key,
              source,
              self
            };
          }
          var Fragment = Symbol.for("jsxdev.fragment");

          // index.jsx
          console.log(jsxDEV("a", {}, undefined, false, undefined, this));
          console.log(jsxDEV(Fragment, {}, undefined, false, undefined, this));"
        `);
      },
    });

    // Test JSX production mode (non-development) with side effects
    itBundled("jsx/sideEffectsDefaultProductionClassic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "classic",
        factory: "React.createElement",
        fragment: "React.Fragment",
      },
      env: {
        NODE_ENV: "production",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // Default behavior in production: should include /* @__PURE__ */ comments
        expect(file).toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // index.jsx
          console.log(/* @__PURE__ */ React.createElement("a", null));
          console.log(/* @__PURE__ */ React.createElement(React.Fragment, null));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueProductionClassic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      backend: "api",
      jsx: {
        runtime: "classic",
        factory: "React.createElement",
        fragment: "React.Fragment",
        sideEffects: true,
      },
      env: {
        NODE_ENV: "production",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true in production: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(file).toContain("React.createElement");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // index.jsx
          console.log(React.createElement("a", null));
          console.log(React.createElement(React.Fragment, null));"
        `);
      },
    });

    itBundled("jsx/sideEffectsDefaultProductionAutomatic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      jsx: {
        runtime: "automatic",
      },
      env: {
        NODE_ENV: "production",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // Default behavior in production: should include /* @__PURE__ */ comments
        expect(file).toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-runtime.js
          var $$typeof = Symbol.for("jsx");
          function jsx(type, props, key) {
            return {
              $$typeof,
              type,
              props,
              key
            };
          }
          var Fragment = Symbol.for("jsx.fragment");

          // index.jsx
          console.log(/* @__PURE__ */ jsx("a", {}));
          console.log(/* @__PURE__ */ jsx(Fragment, {}));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueProductionAutomatic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        ...helpers,
      },
      target: "bun",
      backend: "api",
      jsx: {
        runtime: "automatic",
        sideEffects: true,
        development: false,
      },
      env: {
        NODE_ENV: "production",
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true in production: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-runtime.js
          var $$typeof = Symbol.for("jsx");
          function jsx(type, props, key) {
            return {
              $$typeof,
              type,
              props,
              key
            };
          }
          var Fragment = Symbol.for("jsx.fragment");

          // index.jsx
          console.log(jsx("a", {}));
          console.log(jsx(Fragment, {}));"
        `);
      },
    });

    // Test tsconfig.json parsing for jsxSideEffects option
    itBundled("jsx/sideEffectsDefaultTsconfig", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        "/tsconfig.json": /* json */ `{"compilerOptions": {}}`,
        ...helpers,
      },
      target: "bun",
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // Default behavior via tsconfig: should include /* @__PURE__ */ comments
        expect(file).toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-dev-runtime.js
          var $$typeof = Symbol.for("jsxdev");
          function jsxDEV(type, props, key, source, self) {
            return {
              $$typeof,
              type,
              props,
              key,
              source,
              self
            };
          }
          var Fragment = Symbol.for("jsxdev.fragment");

          // index.jsx
          console.log(/* @__PURE__ */ jsxDEV("a", {}, undefined, false, undefined, this));
          console.log(/* @__PURE__ */ jsxDEV(Fragment, {}, undefined, false, undefined, this));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueTsconfig", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        "/tsconfig.json": /* json */ `{"compilerOptions": {}}`,
        ...helpers,
      },
      jsx: {
        sideEffects: true,
      },
      target: "bun",
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true via tsconfig: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-dev-runtime.js
          var $$typeof = Symbol.for("jsxdev");
          function jsxDEV(type, props, key, source, self) {
            return {
              $$typeof,
              type,
              props,
              key,
              source,
              self
            };
          }
          var Fragment = Symbol.for("jsxdev.fragment");

          // index.jsx
          console.log(jsxDEV("a", {}, undefined, false, undefined, this));
          console.log(jsxDEV(Fragment, {}, undefined, false, undefined, this));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueTsconfigClassic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        "/tsconfig.json": /* json */ `{"compilerOptions": {"jsx": "react"}}`,
        ...helpers,
      },
      jsx: {
        runtime: "classic",
        factory: "React.createElement",
        fragment: "React.Fragment",
        sideEffects: true,
      },
      target: "bun",
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true via tsconfig with classic jsx: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(file).toContain("React.createElement");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // index.jsx
          console.log(React.createElement("a", null));
          console.log(React.createElement(React.Fragment, null));"
        `);
      },
    });

    itBundled("jsx/sideEffectsTrueTsconfigAutomatic", {
      files: {
        "/index.jsx": /* jsx */ `console.log(<a></a>); console.log(<></>);`,
        "/tsconfig.json": /* json */ `{"compilerOptions": {"jsx": "react-jsx"}}`,
        ...helpers,
      },
      jsx: {
        runtime: "automatic",
        sideEffects: true,
      },
      target: "bun",
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        // When sideEffects is true via tsconfig with automatic jsx: should NOT include /* @__PURE__ */ comments
        expect(file).not.toContain("/* @__PURE__ */");
        expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(`
          "// @bun
          // node_modules/react/jsx-dev-runtime.js
          var $$typeof = Symbol.for("jsxdev");
          function jsxDEV(type, props, key, source, self) {
            return {
              $$typeof,
              type,
              props,
              key,
              source,
              self
            };
          }
          var Fragment = Symbol.for("jsxdev.fragment");

          // index.jsx
          console.log(jsxDEV("a", {}, undefined, false, undefined, this));
          console.log(jsxDEV(Fragment, {}, undefined, false, undefined, this));"
        `);
      },
    });
  });

  // https://github.com/oven-sh/bun/issues/6858
  // The automatic JSX runtime import is synthesized by the bundler. When every
  // JSX expression in a file is tree-shaken, nothing references the generated
  // `jsx`/`jsxDEV`/`Fragment` bindings and the import itself should disappear
  // instead of being kept "for side effects" and dragging React into the bundle.
  describe("autoImportTreeShaking", () => {
    itBundledDevAndProd("jsx/AutoImportDroppedWhenJsxUnusedExternal", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          export default 'hi';
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).not.toContain("react/jsx-runtime");
        expect(file).not.toContain("react/jsx-dev-runtime");
        expect(file).not.toContain("jsxDEV");
        expect(file).not.toContain("jsx(");
        expect(file).not.toContain("unused");
      },
    });

    // With jsx.sideEffects: true the lowered calls carry no pure annotation,
    // so even otherwise-unused JSX keeps the call and therefore the import.
    itBundledDevAndProd("jsx/AutoImportKeptWhenJsxSideEffectsTrue", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          export default 'hi';
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic", sideEffects: true },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/);
        expect(file).toMatch(/jsx(DEV)?\(/);
      },
    });

    itBundledDevAndProd("jsx/AutoImportKeptWhenJsxUsedExternal", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          export const live = <span>live</span>;
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/);
        expect(file).toContain("live");
        expect(file).not.toContain("unused");
      },
    });

    itBundledDevAndProd("jsx/AutoImportDroppedFragUnusedExternal", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <><a/><b/></>;
          export default 1;
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).not.toContain("react");
        expect(file).not.toContain("Fragment");
        expect(file).not.toContain("unused");
      },
    });

    // CommonJS JSX source with no "sideEffects" field: previously the
    // auto-import forced the whole module into the bundle even though the JSX
    // was dead code.
    itBundled("jsx/AutoImportDroppedWhenJsxUnusedBundledCjs", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          console.log('only-this');
        `,
        "/node_modules/react/package.json": JSON.stringify({
          name: "react",
          exports: {
            "./jsx-runtime": "./jsx-runtime.js",
            "./jsx-dev-runtime": "./jsx-dev-runtime.js",
          },
        }),
        "/node_modules/react/jsx-runtime.js": /* js */ `
          console.log('JSX_RUNTIME_SIDE_EFFECT');
          exports.jsx = function (type, props) { return { type, props }; };
          exports.jsxs = exports.jsx;
          exports.Fragment = 'F';
        `,
        "/node_modules/react/jsx-dev-runtime.js": /* js */ `
          console.log('JSX_RUNTIME_SIDE_EFFECT');
          exports.jsxDEV = function (type, props) { return { type, props }; };
          exports.Fragment = 'F';
        `,
      },
      target: "bun",
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).not.toContain("JSX_RUNTIME_SIDE_EFFECT");
        expect(file).not.toContain("jsx-runtime");
        expect(file).not.toContain("unused");
      },
      run: { stdout: "only-this" },
    });

    // Same CJS source, but the JSX is actually used: the JSX source must still
    // be bundled and its top-level code must still run.
    itBundled("jsx/AutoImportKeptWhenJsxUsedBundledCjs", {
      files: {
        "/index.tsx": /* tsx */ `
          const el = <div>live</div>;
          console.log(JSON.stringify(el));
        `,
        "/node_modules/react/package.json": JSON.stringify({
          name: "react",
          exports: {
            "./jsx-runtime": "./jsx-runtime.js",
            "./jsx-dev-runtime": "./jsx-dev-runtime.js",
          },
        }),
        "/node_modules/react/jsx-runtime.js": /* js */ `
          console.log('JSX_RUNTIME_SIDE_EFFECT');
          exports.jsx = function (type, props) { return { type: type, props: props }; };
          exports.jsxs = exports.jsx;
          exports.Fragment = 'F';
        `,
        "/node_modules/react/jsx-dev-runtime.js": /* js */ `
          console.log('JSX_RUNTIME_SIDE_EFFECT');
          exports.jsxDEV = function (type, props) { return { type: type, props: props }; };
          exports.Fragment = 'F';
        `,
      },
      target: "bun",
      jsx: { runtime: "automatic" },
      run: {
        stdout: `JSX_RUNTIME_SIDE_EFFECT\n{"type":"div","props":{"children":"live"}}`,
      },
    });

    // key-after-spread falls back to `createElement` from the bare JSX package,
    // which is a second synthesized JsxImport part. When the only reference is
    // inside a dead function, that import must go too.
    itBundled("jsx/AutoImportDroppedCreateElementDeadFunction", {
      files: {
        "/index.tsx": /* tsx */ `
          function dead() {
            const p = {};
            return <div {...p} key="k" />;
          }
          export default 'hi';
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      bundleWarnings: {
        "/index.tsx": ['"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.'],
      },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).not.toContain("createElement");
        expect(file).not.toContain('"react"');
        expect(file).not.toContain("react/jsx");
        expect(file).not.toContain("dead");
      },
    });

    // JSX that only appears under a compile-time-false branch is dropped by
    // define-DCE before tree-shaking runs. The synthesized import must follow.
    itBundled("jsx/AutoImportDroppedDefineDeadBranch", {
      files: {
        "/index.tsx": /* tsx */ `
          if (process.env.DEBUG) {
            console.log(<div/>);
          }
          console.log('only-this');
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      define: { "process.env.DEBUG": "false" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).not.toContain("react");
        expect(file).not.toContain("jsxDEV");
      },
    });

    // React Compiler can hoist a callback that contains the file's only JSX
    // into a separate top-level function. The original component's part still
    // carries the jsx symbol use that was recorded while visiting the
    // unhoisted body, so the JSX import must remain live.
    itBundled("jsx/AutoImportKeptReactCompilerOutlined", {
      files: {
        "/index.tsx": /* tsx */ `
          import { useMemo } from "react";
          export function Live({items}) {
            const mapped = useMemo(() => items.map(x => <li key={x}>{x}</li>), [items]);
            return mapped;
          }
        `,
      },
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      reactCompiler: true,
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/);
        expect(file).toMatch(/jsx(DEV)?\(/);
      },
    });

    // Transpile-only output (--no-bundle, same single-file path as the
    // runtime transpiler) never tree-shakes parts, so the synthesized runtime
    // import must survive even when every JSX expression is dead.
    itBundled("jsx/AutoImportKeptWhenNotBundling", {
      files: {
        "/index.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          console.log('only-this');
        `,
      },
      bundling: false,
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const file = api.readFile("out.js");
        expect(file).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/);
        // Transpile-only keeps the hashed import alias, e.g. `jsx_w77yafs4(`.
        expect(file).toMatch(/jsx(DEV)?(_\w+)?\(/);
      },
    });

    // Two entry modules: one where JSX survives, one where it is all dead.
    // The JSX source must be bundled (for the live entry) without leaking an
    // extra import into the dead entry's chunk.
    itBundled("jsx/AutoImportMixedEntries", {
      files: {
        "/live.tsx": /* tsx */ `
          export const el = <div>live</div>;
        `,
        "/dead.tsx": /* tsx */ `
          const unused = <div>dead</div>;
          export default 'dead-entry';
        `,
      },
      entryPoints: ["/live.tsx", "/dead.tsx"],
      external: ["react", "react/*"],
      jsx: { runtime: "automatic" },
      onAfterBundle(api) {
        const live = api.readFile("out/live.js");
        const dead = api.readFile("out/dead.js");
        expect(live).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/);
        expect(dead).not.toContain("react");
        expect(dead).not.toContain("unused");
      },
    });
  });

  describe.concurrent("a hook call in a method, with React Fast Refresh", () => {
    const prelude = /* js */ `
      globalThis.$RefreshSig$ = () => fn => fn;
      globalThis.$RefreshReg$ = () => {};
      function useThing() { return 1; }
    `;
    const signatures = (file: string) =>
      file.match(/(\$RefreshSig\$|createSignatureFunctionForTransform)\(\)/g)?.length ?? 0;

    for (const ext of ["tsx", "jsx"]) {
      itBundled(`jsx/FastRefreshClassStatementMethods.${ext}`, {
        files: {
          [`/index.${ext}`]: /* js */ `
            ${prelude}
            class C {
              constructor() { this.c = useThing(); }
              m() { return useThing(); }
              get g() { return useThing(); }
              set s(v) { this.v = v + useThing(); }
              static t() { return useThing(); }
              #p() { return useThing(); }
              p() { return this.#p(); }
            }
            const c = new C();
            c.s = 1;
            console.log(c.c, c.m(), c.g, c.v, C.t(), c.p());
          `,
        },
        backend: "cli",
        reactFastRefresh: true,
        onAfterBundle(api) {
          expect(signatures(api.readFile("out.js"))).toBe(0);
        },
        run: { stdout: "1 1 1 2 1 1" },
      });

      itBundled(`jsx/FastRefreshClassExpressionMethod.${ext}`, {
        files: {
          [`/index.${ext}`]: /* js */ `
            ${prelude}
            const C = class { m() { return useThing(); } };
            console.log(new C().m());
          `,
        },
        backend: "cli",
        reactFastRefresh: true,
        onAfterBundle(api) {
          expect(signatures(api.readFile("out.js"))).toBe(0);
        },
        run: { stdout: "1" },
      });

      itBundled(`jsx/FastRefreshObjectMethodKeepsSuper.${ext}`, {
        files: {
          [`/index.${ext}`]: /* js */ `
            ${prelude}
            const o = { __proto__: { m() { return 1; } }, m() { return super.m() + useThing(); } };
            console.log(o.m());
          `,
        },
        backend: "cli",
        reactFastRefresh: true,
        onAfterBundle(api) {
          expect(signatures(api.readFile("out.js"))).toBe(0);
        },
        run: { stdout: "2" },
      });
    }

    // The call in the method counts for neither function. The one in the function inside it does.
    itBundled("jsx/FastRefreshFunctionsAroundAndInsideAMethod", {
      files: {
        "/index.tsx": /* js */ `
          ${prelude}
          function Around() {
            return { m() { useThing(); return function Inside() { return useThing(); }; } };
          }
          console.log(Around().m()());
        `,
        "/node_modules/react-refresh/runtime.js": /* js */ `
          export const createSignatureFunctionForTransform = () => fn => fn;
          export const register = () => {};
        `,
      },
      backend: "api",
      reactFastRefresh: true,
      onAfterBundle(api) {
        expect(signatures(api.readFile("out.js"))).toBe(1);
      },
      run: { stdout: "1" },
    });
  });

  // The refresh runtime keeps the state of a component between two values that a module
  // registers under one id. This runtime prints each call, so stdout is what a module registers.
  describe.concurrent("a component in a wrapper call, with React Fast Refresh", () => {
    const runtime = {
      "/node_modules/react/index.js": /* js */ `
        export const memo = (type, compare) => ({ kind: "memo", of: type });
        export const forwardRef = render => ({ kind: "forwardRef", of: render });
        export const createContext = () => ({ kind: "context" });
        export const useState = value => [value, () => {}];
      `,
      "/node_modules/react/jsx-dev-runtime.js": /* js */ `
        export const jsxDEV = type => ({ kind: "element" });
      `,
      "/node_modules/react-refresh/runtime.js": /* js */ `
        const show = value =>
          typeof value === "function" ? "function" : value?.kind ? value.kind + "(" + (value.of ? show(value.of) : "") + ")" : typeof value;
        exports.register = (value, id) => console.log("register " + id + " = " + show(value));
        exports.createSignatureFunctionForTransform = () => (value, key, force, hooks) => {
          if (typeof key === "string") console.log("sign " + show(value) + (hooks ? " with " + hooks().length + " custom" : ""));
          return value;
        };
      `,
    };
    // The bundle loads the runtime when it runs.
    const external = ["react-refresh/runtime"];
    const lines = (text: string) =>
      text
        .trim()
        .split("\n")
        .map(line => line.trim())
        .join("\n");

    const registered = {
      "/index.jsx": /* js */ `
        import * as React from "react";
        import { memo, forwardRef, useState } from "react";
        import { withTheme } from "./wrappers.js";

        export const Plain = () => <div />;
        export const Memo = memo(() => <div />);
        export const Both = memo(forwardRef((props, ref) => <div ref={ref} />));
        export const Member = React.memo(function Named() { return <div />; });
        export const Compare = memo(() => <div />, () => true);
        const NotExported = withTheme(() => <div />);
        export const OfAWrapper = withTheme(Memo);
        export default memo(() => <div />);
      `,
      "/wrappers.js": /* js */ `
        export const withTheme = Inner => ({ kind: "withTheme", of: Inner });
      `,
    };
    const registeredStdout = lines(`
      register index.jsx:Plain = function
      register index.jsx:Memo$memo = function
      register index.jsx:Memo%memo = memo(function)
      register index.jsx:Both$memo$forwardRef = function
      register index.jsx:Both$memo%forwardRef = forwardRef(function)
      register index.jsx:Both%memo$forwardRef = memo(forwardRef(function))
      register index.jsx:Member$memo = function
      register index.jsx:Member%memo = memo(function)
      register index.jsx:Compare$memo = function
      register index.jsx:Compare%memo = memo(function)
      register index.jsx:NotExported$withTheme = function
      register index.jsx:NotExported%withTheme = withTheme(function)
      register index.jsx:OfAWrapper%withTheme(Memo) = withTheme(memo(function))
      register index.jsx:default$memo = function
      register index.jsx:default%memo = memo(function)
    `);
    for (const backend of ["cli", "api"] as const) {
      itBundled(`jsx/FastRefreshWrapperCalls.${backend}`, {
        files: { ...registered, ...runtime },
        backend,
        reactFastRefresh: true,
        external,
        run: { stdout: registeredStdout },
      });
    }
    itBundled("jsx/FastRefreshWrapperCallsMinified", {
      files: { ...registered, ...runtime },
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      reactFastRefresh: true,
      external,
      run: { stdout: registeredStdout },
    });

    // A wrapper such as mobx's observer() calls the function inside its own component. The
    // value of each call gets the hook signature of the function, so that the runtime mounts
    // the wrapper again when the hooks change.
    itBundled("jsx/FastRefreshWrapperCallsAreSigned", {
      files: {
        "/index.jsx": /* js */ `
          import { memo, forwardRef, useState } from "react";
          function useCustom() { return useState(0); }

          export const Hooked = memo(forwardRef((props, ref) => { const [s] = useState(0); return <div>{s}</div>; }));
          export const Custom = memo(() => { const [s] = useCustom(); return <div>{s}</div>; });
          function Declared() { const [s] = useState(0); return <div>{s}</div>; }
          export const OfDeclared = memo(Declared);
          export const First = () => { const [s] = useState(1); return s; }, Second = () => { const [s] = useState(2); return s; };
          export const OfSecond = memo(Second);
        `,
        ...runtime,
      },
      reactFastRefresh: true,
      external,
      run: {
        stdout: lines(`
          sign function
          sign function
          sign forwardRef(function)
          sign memo(forwardRef(function))
          register index.jsx:Hooked$memo$forwardRef = function
          register index.jsx:Hooked$memo%forwardRef = forwardRef(function)
          register index.jsx:Hooked%memo$forwardRef = memo(forwardRef(function))
          sign function with 1 custom
          sign memo(function) with 1 custom
          register index.jsx:Custom$memo = function
          register index.jsx:Custom%memo = memo(function)
          sign function
          register index.jsx:Declared = function
          sign memo(function)
          register index.jsx:OfDeclared%memo(Declared) = memo(function)
          sign function
          register index.jsx:First = function
          sign function
          register index.jsx:Second = function
          sign memo(function)
          register index.jsx:OfSecond%memo(Second) = memo(function)
        `),
      },
    });

    itBundled("jsx/FastRefreshNotAWrapperCall", {
      files: {
        "/index.jsx": /* js */ `
          import { memo, createContext } from "react";
          import { withTheme, Imported, requireComponent } from "./other.js";

          export const Plain = () => <div />;
          const lowercase = memo(() => <div />);
          export const Context = createContext(null);
          export const Element = <Plain />;
          export const Configured = withTheme({ dark: true });
          export const Curried = withTheme("dark")(() => <div />);
          export const Optional = memo?.(() => <div />);
          export const OfImported = memo(Imported);
          export const OfLowercase = memo(lowercase);
          export const Loaded = requireComponent(Plain);
          export function nested() {
            const Inner = memo(() => <div />);
            return Inner;
          }
          console.log(typeof lowercase, typeof nested());
        `,
        "/other.js": /* js */ `
          export const withTheme = () => () => ({});
          export const Imported = () => null;
          export const requireComponent = component => component;
        `,
        ...runtime,
      },
      reactFastRefresh: true,
      external,
      // `Imported` is a component of other.js. index.jsx does not know what it holds.
      run: { stdout: "register other.js:Imported = function\nregister index.jsx:Plain = function\nobject object" },
    });

    // Each of these modules declares a variable for its default export.
    itBundled("jsx/FastRefreshDefaultExportsInOneChunk", {
      files: {
        "/index.jsx": /* js */ `
          import a from "./a.jsx";
          import b from "./b.jsx";
          import c from "./c.jsx";
          import d from "./d.jsx";
          console.log(typeof a, typeof b, c.kind, d.kind);
        `,
        "/a.jsx": `export default () => <div />;`,
        "/b.jsx": `export default (function () { return <div />; });`,
        "/c.jsx": `import { memo } from "react"; export default memo(() => <div />);`,
        "/d.jsx": `import { memo } from "react"; export default memo(() => <div />);`,
        ...runtime,
      },
      reactFastRefresh: true,
      external,
      run: {
        stdout: lines(`
          register a.jsx:default = function
          register b.jsx:default = function
          register c.jsx:default$memo = function
          register c.jsx:default%memo = memo(function)
          register d.jsx:default$memo = function
          register d.jsx:default%memo = memo(function)
          function function memo memo
        `),
      },
    });
  });
});
