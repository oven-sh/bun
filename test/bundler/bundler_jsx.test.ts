import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { SourceMapConsumer } from "source-map";
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
  describe("jsx preserve", () => {
    test("Bun.Transpiler scanImports uses the effective JSX runtime", () => {
      const transpiler = new Bun.Transpiler({
        loader: "tsx",
        tsconfig: JSON.stringify({ compilerOptions: { jsx: "preserve" } }),
      });

      expect(transpiler.scanImports("export default <></>;")).toEqual([]);
      expect(transpiler.scanImports("/* @jsxRuntime automatic */ export default <></>;")).toEqual([
        { kind: "require-call", path: "react/jsx-dev-runtime" },
        { kind: "require-call", path: "react" },
      ]);
      expect(transpiler.scanImports("/* @jsxRuntime react-jsx */ export default <></>;")).toEqual([
        { kind: "require-call", path: "react/jsx-runtime" },
        { kind: "require-call", path: "react" },
      ]);

      const automaticTranspiler = new Bun.Transpiler({ loader: "tsx" });
      expect(automaticTranspiler.scanImports("/* @jsxRuntime preserve */ export default <></>;")).toEqual([]);

      const solidTranspiler = new Bun.Transpiler({
        loader: "tsx",
        tsconfig: JSON.stringify({ compilerOptions: { jsx: "solid" } }),
      });
      expect(solidTranspiler.scanImports("export default <></>;")).toEqual([]);
    });

    itBundled("jsx/PreserveCliRuntimeFlag", {
      files: {
        "/in.tsx": `console.log(<span>Hello</span>);`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      jsx: {
        runtime: "preserve",
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("<span>Hello</span>");
        expect(out).not.toContain("React.createElement");
        expect(out).not.toContain("jsx-runtime");
      },
    });

    itBundled("jsx/PreserveApiRuntimeOption", {
      files: {
        "/in.tsx": `export const element = <section data-kind="api">API</section>;`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "api",
      jsx: {
        runtime: "preserve",
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain('<section data-kind="api">API</section>');
        expect(out).not.toContain("jsx-runtime");
      },
    });

    itBundled("jsx/PreserveTsconfigBeatsImportSource", {
      files: {
        "/in.tsx": `export const element = <><SolidLike /></>;`,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","jsxImportSource":"solid-js","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("<><SolidLike/></>");
        expect(out).not.toContain("solid-js");
        expect(out).not.toContain("jsx-runtime");
        expect(out).not.toContain("Fragment");
      },
    });

    itBundled("jsx/PreserveBunfigRuntime", {
      files: {
        "/in.tsx": `export const element = <article data-source="bunfig">Bunfig</article>;`,
        "/bunfig.toml": `jsx = "preserve"`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain('<article data-source="bunfig">Bunfig</article>');
        expect(out).not.toContain("React.createElement");
        expect(out).not.toContain("jsx-runtime");
      },
    });

    itBundled("jsx/PreserveAttributeQuotingEdgeCases", {
      files: {
        "/in.tsx": `
          export const a = <div title='"' />;
          export const b = <div title="'" />;
          export const c = <div title={"'"} />;
          export const d = <div title={'"'} />;
          export const e = <div title="\`" />;
          export const f = <div title={"'\\""} />;
          export const g = <div title="&amp;" />;
          export const h = <div title="&#55296;">&#55296;</div>;
          export const i = <div title="&#x2028;">&#x2028;</div>;
        `,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`title='"'`);
        expect(out).toContain(`title="'"`);
        expect(out).toContain('title="`"');
        expect(out).toContain(`title={"'\\""}`);
        expect(out).toContain(`title={"&"}`);
        expect(out).toContain(`title={"\\uD800"}>{"\\uD800"}</div>`);
        expect(out).toContain(`title={"\\u2028"}>{"\\u2028"}</div>`);
      },
    });

    itBundled("jsx/PreserveCommaExpressions", {
      files: {
        "/in.tsx": `
          declare function first(): Record<string, unknown>;
          declare function second(): Record<string, unknown>;
          export const element = <Component {...(first(), second())} value={(first(), second())}>{(first(), second())}</Component>;
        `,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("{...(first(), second())}");
        expect(out).toContain("value={(first(), second())}");
        expect(out).toContain(">{(first(), second())}</Component>");
      },
    });

    itBundled("jsx/PreserveMultilineChildren", {
      files: {
        "/in.tsx": `
          export const a = <div>&amp;</div>;
          export const b = <div>&lt;</div>;
          export const c = <div>&gt;</div>;
          export const d = <div>&#123;</div>;
          export const e = <div>&#125;</div>;
          export const f =
            <div>
              Line 1
              Line "2"
              Line '3'
              Line \`4\`
            </div>;
          export const adjacent = <div>{"a"}{"b"}</div>;
          export const mixed = <div>b<span />d</div>;
          export const fragment = <>x<span />z</>;
          export const emptyExpression = <div>{""}</div>;
          export const explicitClose = <div></div>;
          export const selfClosing = <div />;
        `,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`<div>{"&"}</div>`);
        expect(out).toContain(`<div>{"<"}</div>`);
        expect(out).toContain(`<div>{">"}</div>`);
        expect(out).toContain(`<div>{"{"}</div>`);
        expect(out).toContain(`<div>{"}"}</div>`);
        expect(out).toContain("Line 1");
        expect(out).toContain('Line "2"');
        expect(out).toContain("Line '3'");
        expect(out).toContain("Line `4`");
        expect(out).toContain(`<div>\n  {"a"}\n  {"b"}\n</div>`);
        expect(out).toContain(`<div>\n  {"b"}\n  <span/>\n  {"d"}\n</div>`);
        expect(out).toContain(`<>\n  {"x"}\n  <span/>\n  {"z"}\n</>`);
        expect(out).toContain(`<div>{""}</div>`);
        expect(out).toContain(`<div></div>`);
        expect(out).toContain(`<div/>`);
      },
    });

    itBundled("jsx/PreserveMinifiedChildBoundaries", {
      files: {
        "/in.tsx": `
          export const adjacent = <div>{"a"}{"b"}</div>;
          export const mixed = <div>b<span />d</div>;
          export const empty = <div>{""}</div>;
        `,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      minifyWhitespace: true,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`<div>{"a"}{"b"}</div>`);
        expect(out).toContain(`<div>{"b"}<span/>{"d"}</div>`);
        expect(out).toContain(`<div>{""}</div>`);
      },
    });

    itBundled("jsx/PreserveSourcemapSimple", {
      files: {
        "/in.tsx": `export const A = <section id="x">hello</section>;
          export const B = <>{...items}</>;`,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outdir: "/out",
      sourceMap: "external",
      target: "bun",
      backend: "cli",
      async onAfterBundle(api) {
        const source = api.readFile("/in.tsx");
        const generated = api.readFile("/out/in.js");
        expect(generated).toContain(`<section id="x">hello</section>`);

        api.assertFileExists("/out/in.js.map");
        const map = JSON.parse(api.readFile("/out/in.js.map"));

        const lineColumn = (text: string, index: number) => {
          expect(index).not.toBe(-1);
          const before = text.slice(0, index);
          return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
        };
        const tokens = [
          {
            token: "opening tag",
            generatedIndex: generated.indexOf("<section") + 1,
            sourceIndex: source.indexOf("<section") + 1,
          },
          {
            token: "attribute key",
            generatedIndex: generated.indexOf("id="),
            sourceIndex: source.indexOf("id="),
          },
          {
            token: "attribute value",
            generatedIndex: generated.indexOf('"x"'),
            sourceIndex: source.indexOf('"x"'),
          },
          {
            token: "child text",
            generatedIndex: generated.indexOf("hello"),
            sourceIndex: source.indexOf("hello"),
          },
          {
            token: "spread child",
            generatedIndex: generated.indexOf("...items"),
            sourceIndex: source.indexOf("...items"),
          },
          {
            token: "closing tag",
            generatedIndex: generated.indexOf("</section>"),
            sourceIndex: source.indexOf("</section>"),
          },
        ];

        await SourceMapConsumer.with(map, null, consumer => {
          const positions = tokens.map(({ token, generatedIndex }) => {
            const mapped = consumer.originalPositionFor(lineColumn(generated, generatedIndex));
            return {
              token,
              source: mapped.source?.split(/[\\/]/).pop(),
              line: mapped.line,
              column: mapped.column,
            };
          });
          expect(positions).toEqual(
            tokens.map(({ token, sourceIndex }) => ({
              token,
              source: "in.tsx",
              ...lineColumn(source, sourceIndex),
            })),
          );
        });
      },
    });

    itBundled("jsx/PreserveMinifyIdentifiers", {
      files: {
        "/in.tsx": `
          import { ImportedComponent } from "./component";
          let greeting = "Hello";
          let spreadProps = { title: greeting };
          function VeryLongComponent() { return null; }
          console.log(<>
            <VeryLongComponent {...spreadProps} key="id" longAttributeName={greeting} data-long-name={greeting} />
            <ImportedComponent />
            <h3>{greeting}</h3>
          </>);
        `,
        "/component.tsx": `export function ImportedComponent() { return null; }`,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      minifyIdentifiers: true,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("<>");
        expect(out).toContain("{...");
        expect(out).toContain("<h3>{");
        expect(out).toContain("longAttributeName={");
        expect(out).toContain("data-long-name={");
        expect(out).toContain("</>");
        expect(out).toMatch(/<[A-Z][\w$]* \{\.\.\./);
        expect(out).toMatch(/<[A-Z][\w$]*\/>/);
        expect(out).not.toContain("VeryLongComponent");
        expect(out).not.toContain("ImportedComponent");
        expect(out).not.toContain("spreadProps");
        expect(out).not.toContain("jsx-runtime");
        expect(out).not.toContain("greeting");
        expect(out).not.toContain("createElement");
      },
    });

    itBundled("jsx/PreserveKeyAfterSpreadDoesNotLower", {
      files: {
        "/in.tsx": `
          /* @jsxRuntime preserve */
          const props = { title: "ok" };
          function Component() { return null; }
          export const element = <Component {...props} key="id" />;
          export const bareKey = <Component key />;
        `,
        "/tsconfig.json": `{"compilerOptions":{"jsx":"automatic","target":"ESNext"}}`,
      },
      outfile: "/out.js",
      target: "bun",
      backend: "cli",
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`<Component {...props} key="id"/>`);
        expect(out).toContain(`<Component key/>`);
        expect(out).not.toContain("createElement");
        expect(out).not.toContain("jsxDEV");
        expect(out).not.toContain("jsx-runtime");
      },
    });
  });

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
});
