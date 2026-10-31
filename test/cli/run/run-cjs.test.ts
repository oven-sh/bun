import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

// A stand-in for react, so that the JSX runtime bun imports on its own resolves
// without the network: `react/jsx-dev-runtime`, `react/jsx-runtime`, or `react`
// itself for createElement. The production runtime names the function that
// made each element, so the output tells it from the development runtime.
const fakeReact = {
  "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
  "node_modules/react/index.js": `
    exports.createElement = (type, props, ...children) => ({ type, props, children });
  `,
  "node_modules/react/jsx-dev-runtime.js": `
    exports.Fragment = "fragment";
    exports.jsxDEV = (type, props) => ({ type, props });
  `,
  "node_modules/react/jsx-runtime.js": `
    exports.Fragment = "fragment";
    exports.jsx = (type, props) => ({ jsx: type, props });
    exports.jsxs = (type, props) => ({ jsxs: type, props });
  `,
};

const requireAndJsx = `const { basename } = require("node:path"); console.log(JSON.stringify(<div title={basename("/a/b.txt")} />));`;

async function run(dir: string, args: string[], stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: bunEnv,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("a pre-bundled entry point still consults require.extensions", async () => {
    // `bun build --target=bun --format=cjs` emits this header, and the `// @bun`
    // pragma makes the parser hand the source straight to JSC without printing
    // it. That must not change how the modules this entry loads are resolved.
    using dir = tempDir("run-cjs-bundled-entry", {
      "entry.cjs": `// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
  require.extensions[".data"] = (module, filename) => {
    module.exports = "custom-loader";
  };
  console.log(require("./asset.data"));
})`,
      // If the custom loader is skipped, this is transpiled as JS/TS instead.
      "asset.data": `module.exports = "default-loader";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: "custom-loader\n", exitCode: 0 });
  });

  // The parser binds the JSX runtime and the helpers from "bun:wrap" with
  // statements it generates. A CommonJS module runs inside the CommonJS function
  // wrapper, where an `import` statement is a SyntaxError, so there the bindings
  // have to be require() calls.
  test("commonjs module using JSX", async () => {
    using dir = tempDir("run-cjs-jsx", {
      ...fakeReact,
      "component.jsx": `
        const { basename } = require("node:path");
        function App() {
          return <div title={basename("/a/b.txt")}>hi</div>;
        }
        module.exports = { App };
      `,
      "entry.js": `
        const { App } = require("./component.jsx");
        console.log(JSON.stringify(App()));
      `,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt","children":"hi"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // `require()` transpiles on the JS thread. `import` and `import()` transpile on the work pool.
  test.each([
    ["require()", "entry.cjs", `const App = require("./component.jsx"); const { Service } = require("./service.ts");`],
    [
      "import",
      "entry.mjs",
      `import App from "./component.jsx"; import service from "./service.ts"; const { Service } = service;`,
    ],
    [
      "import()",
      "entry.mjs",
      `const { default: App } = await import("./component.jsx"); const { Service } = (await import("./service.ts")).default;`,
    ],
  ])("commonjs modules using JSX and a decorator, loaded with %s", async (_, entry, load) => {
    using dir = tempDir("run-cjs-load-paths", {
      ...fakeReact,
      "component.jsx": `
        module.exports = function App() {
          return <div>hi</div>;
        };
      `,
      "service.ts": `
        function tag(value: string) {
          return (target: any) => {
            target.tag = value;
          };
        }
        @tag("decorated")
        class Service {}
        module.exports = { Service };
      `,
      [entry]: `${load} console.log(JSON.stringify(App()), Service.tag);`,
    });

    expect(await run(String(dir), [entry])).toEqual({
      stdout: `{"type":"div","props":{"children":"hi"}} decorated\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // An ES module imports the JSX runtime first, then the package that has createElement.
  // A CommonJS module gets the "require" files of a package, as from its own require().
  test("commonjs module requires its JSX bindings in the order in which an ES module imports them", async () => {
    const elements = `const props = {}; const elements = [<p />, <div {...props} key="k" />];`;
    const loaded = (name: string) => `(globalThis.loaded ??= []).push(${JSON.stringify(name)});`;
    const conditions = (file: string) => ({ import: `./${file}.mjs`, require: `./${file}.cjs` });
    using dir = tempDir("run-cjs-jsx-order", {
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "0.0.0",
        exports: {
          ".": conditions("index"),
          "./jsx-dev-runtime": conditions("runtime"),
          "./jsx-runtime": conditions("runtime"),
        },
      }),
      "node_modules/react/index.mjs": `${loaded("index.mjs")} export const createElement = () => null;`,
      "node_modules/react/index.cjs": `${loaded("index.cjs")} exports.createElement = () => null;`,
      "node_modules/react/runtime.mjs": `${loaded("runtime.mjs")} export const jsx = () => null; export const jsxDEV = jsx;`,
      "node_modules/react/runtime.cjs": `${loaded("runtime.cjs")} exports.jsx = exports.jsxDEV = () => null;`,
      "cjs.jsx": `${elements} module.exports = elements; console.log(globalThis.loaded.join());`,
      "esm.jsx": `${elements} export default elements; console.log(globalThis.loaded.join());`,
    });

    const [cjs, esm] = await Promise.all([run(String(dir), ["cjs.jsx"]), run(String(dir), ["esm.jsx"])]);
    expect({ cjs, esm }).toEqual({
      cjs: { stdout: "runtime.cjs,index.cjs\n", stderr: "", exitCode: 0 },
      esm: { stdout: "runtime.mjs,index.mjs\n", stderr: "", exitCode: 0 },
    });
  });

  test("commonjs module using JSX without a JSX runtime to resolve", async () => {
    using dir = tempDir("run-cjs-jsx-missing-runtime", {
      "component.jsx": `module.exports = <div />;`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), ["--no-install", "component.jsx"]);
    expect(stderr).toContain("error: Cannot find module 'react/jsx-dev-runtime' from ");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  // https://github.com/oven-sh/bun/issues/12812
  test("tsx entry point using `import x = require()` and JSX", async () => {
    using dir = tempDir("run-cjs-import-equals-jsx", {
      ...fakeReact,
      "app.tsx": `
        import process = require("node:process");
        function App() {
          return (
            <>
              <h1>{typeof process.platform}</h1>
            </>
          );
        }
        console.log(JSON.stringify(App()));
      `,
    });

    expect(await run(String(dir), ["app.tsx"])).toEqual({
      stdout: `{"type":"fragment","props":{"children":{"type":"h1","props":{"children":"string"}}}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // `key` after a spread is the one JSX shape that is lowered to createElement
  // from the package itself, not to the jsx runtime.
  test("commonjs module using JSX with a key after a spread", async () => {
    using dir = tempDir("run-cjs-jsx-create-element", {
      ...fakeReact,
      "component.jsx": `
        const { basename } = require("node:path");
        const props = { title: basename("/a/b.txt") };
        module.exports = <div {...props} key="k">hi</div>;
      `,
      "entry.js": `console.log(JSON.stringify(require("./component.jsx")));`,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt","key":"k"},"children":["hi"]}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // "jsx": "react-jsx" selects the production runtime, which has jsx and jsxs for jsxDEV.
  test("commonjs module using the production JSX runtime", async () => {
    using dir = tempDir("run-cjs-jsx-production", {
      ...fakeReact,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "component.jsx": `
        module.exports = (
          <>
            <p>one</p>
            <p>two</p>
          </>
        );
      `,
      "entry.js": `console.log(JSON.stringify(require("./component.jsx")));`,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: `{"jsxs":"fragment","props":{"children":[{"jsx":"p","props":{"children":"one"}},{"jsx":"p","props":{"children":"two"}}]}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // "use strict" and __dirname also make a file CommonJS. The generated binding
  // is placed before the code of the file, so the directive has to stay in effect.
  test('commonjs module detected via "use strict" and __dirname using JSX', async () => {
    using dir = tempDir("run-cjs-use-strict-jsx", {
      ...fakeReact,
      "component.jsx": `
        "use strict";
        function isStrict() {
          return this === undefined;
        }
        console.log(JSON.stringify(<div title={typeof __dirname} strict={isStrict()} />));
      `,
    });

    expect(await run(String(dir), ["component.jsx"])).toEqual({
      stdout: `{"type":"div","props":{"title":"string","strict":true}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // The globals of bun:test are a third generated binding, and `Counter` is hoisted.
  test("commonjs test file using JSX, a decorator and a hoisted class under bun test", async () => {
    using dir = tempDir("run-cjs-jsx-bun-test", {
      ...fakeReact,
      "component.test.jsx": `
        const { basename } = require("node:path");
        function tag(value) {
          return target => {
            target.tag = value;
          };
        }
        class Counter {
          static accessor count = 1;
        }
        @tag(basename("/a/b.txt"))
        class Tagged {}
        test("renders", () => {
          expect(<div title={Tagged.tag}>{Counter.count}</div>).toEqual({
            type: "div",
            props: { title: "b.txt", children: 1 },
          });
        });
      `,
    });

    const { stderr, exitCode } = await run(String(dir), ["test", "./component.test.jsx"]);
    expect(stderr).toContain(" 1 pass\n");
    expect(stderr).toContain(" 0 fail\n");
    expect(exitCode).toBe(0);
  });

  test("commonjs module using TypeScript experimental decorators", async () => {
    using dir = tempDir("run-cjs-legacy-decorators", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
      "service.ts": `
        const { basename } = require("node:path");
        function tag(value: string) {
          return (target: any) => {
            target.tag = value;
          };
        }
        @tag(basename("/x/decorated.ts"))
        class Service {}
        module.exports = { Service };
      `,
      "entry.js": `
        const { Service } = require("./service.ts");
        console.log(Service.tag);
      `,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: "decorated.ts\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("commonjs module using standard decorators", async () => {
    using dir = tempDir("run-cjs-standard-decorators", {
      "service.ts": `
        const { basename } = require("node:path");
        function tag(value: string) {
          return (target: any, context: ClassDecoratorContext) => {
            target.tag = value + ":" + String(context.name);
          };
        }
        @tag(basename("/x/decorated.ts"))
        class Service {}
        module.exports = { Service };
      `,
      "entry.js": `
        const { Service } = require("./service.ts");
        console.log(Service.tag);
      `,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: "decorated.ts:Service\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Nothing in the body of this file is CommonJS. Its extension alone is.
  test(".cts module using standard decorators", async () => {
    using dir = tempDir("run-cjs-cts-decorators", {
      "service.cts": `
        function tag(value: string) {
          return (target: any, context: ClassDecoratorContext) => {
            target.tag = value + ":" + String(context.name);
          };
        }
        @tag("cts")
        class Service {}
        console.log((Service as any).tag);
      `,
    });

    expect(await run(String(dir), ["service.cts"])).toEqual({
      stdout: "cts:Service\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Nothing in the body of these three files is CommonJS. The "type" of their package is.
  test('modules of a "type": "commonjs" package using JSX, a decorator and an accessor', async () => {
    using dir = tempDir("run-cjs-package-type", {
      ...fakeReact,
      "package.json": JSON.stringify({ name: "app", type: "commonjs" }),
      "element.js": `console.log(JSON.stringify(<div />));`,
      "decorated.ts": `
        function tag(target: any) {
          target.tag = "decorated";
        }
        @tag
        class Service {}
        console.log((Service as any).tag);
      `,
      "accessor.ts": `
        class Box {
          static accessor count = 1;
        }
        console.log(Box.count);
      `,
      "entry.js": `require("./element.js"); require("./decorated.ts"); require("./accessor.ts");`,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: `{"type":"div","props":{}}\ndecorated\n1\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // A top-level class that can be hoisted moves to the front of the module
  // before the bindings are generated. The static block that `static accessor`
  // is lowered to calls a "bun:wrap" helper while the class is defined, so the
  // binding has to be ahead of the hoisted class.
  test("commonjs module with a hoisted class that needs a bun:wrap helper", async () => {
    using dir = tempDir("run-cjs-hoisted-class-helper", {
      "box.ts": `
        const { basename } = require("node:path");
        class Box {
          static accessor count = 1;
          accessor value = basename("/a/b.txt");
        }
        module.exports = { Box };
      `,
      "entry.js": `
        const { Box } = require("./box.ts");
        console.log(Box.count, new Box().value);
      `,
    });

    expect(await run(String(dir), ["entry.js"])).toEqual({
      stdout: "1 b.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // `bun -e`, `bun -p` and `bun run -` evaluate their source as CommonJS too,
  // but without the function wrapper.
  test("bun -e using require() and JSX", async () => {
    using dir = tempDir("run-cjs-eval-jsx", fakeReact);

    expect(await run(String(dir), ["-e", requireAndJsx])).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun -p prints the value of JSX that follows a require()", async () => {
    using dir = tempDir("run-cjs-print-jsx", fakeReact);

    expect(
      await run(String(dir), [
        "-p",
        `const { basename } = require("node:path"); JSON.stringify(<div title={basename("/a/b.txt")} />)`,
      ]),
    ).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("stdin script using require() and JSX", async () => {
    using dir = tempDir("run-cjs-stdin-jsx", fakeReact);

    expect(await run(String(dir), ["run", "-"], requireAndJsx)).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("ES module using JSX works", async () => {
    using dir = tempDir("run-esm-jsx", {
      ...fakeReact,
      "component.tsx": `
        import { basename } from "node:path";
        export function App() {
          return <div title={basename("/a/b.txt")}>hi</div>;
        }
      `,
      "entry.ts": `
        import { App } from "./component.tsx";
        console.log(JSON.stringify(App()));
      `,
    });

    expect(await run(String(dir), ["entry.ts"])).toEqual({
      stdout: `{"type":"div","props":{"title":"b.txt","children":"hi"}}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
