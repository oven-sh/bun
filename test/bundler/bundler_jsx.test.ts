import { describe, expect } from "bun:test";
import { normalizeBunSnapshot } from "harness";
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
  const { devStdout, prodStdout, ...rest } = opts;
  itBundled(id + "Dev", {
    ...rest,
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
});
