import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

// A stand-in for react so the JSX runtime bun auto-imports (`react/jsx-dev-runtime`,
// `react/jsx-runtime`, or `react` itself for createElement) resolves without the network.
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
    exports.jsx = (type, props) => ({ type, props });
    exports.jsxs = exports.jsx;
  `,
};

const requireAndJsx = `const { basename } = require("node:path"); console.log(JSON.stringify(<div title={basename("/a/b.txt")} />));`;

async function runBun(dir: string, args: string[], stdin?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: bunEnv,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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

  // The JSX runtime and the helpers from "bun:wrap" are bound with generated
  // statements. A module that bun treats as CommonJS is evaluated inside the
  // CommonJS function wrapper, where those bindings have to be require()
  // calls: an `import` statement there is a SyntaxError.
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt", children: "hi" } });
    expect(exitCode).toBe(0);
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["app.tsx"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      type: "fragment",
      props: { children: { type: "h1", props: { children: "string" } } },
    });
    expect(exitCode).toBe(0);
  });

  // `key` after a spread is the one JSX shape that is lowered to createElement
  // from the package itself rather than to the jsx runtime.
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt", key: "k" }, children: ["hi"] });
    expect(exitCode).toBe(0);
  });

  // "use strict" and __dirname also make a file CommonJS. The generated binding
  // is placed before the user's code, so the directive has to stay in effect.
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["component.jsx"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "string", strict: true } });
    expect(exitCode).toBe(0);
  });

  test("commonjs test file using JSX under bun test", async () => {
    using dir = tempDir("run-cjs-jsx-bun-test", {
      ...fakeReact,
      "component.test.jsx": `
        const { basename } = require("node:path");
        test("renders", () => {
          expect(<div title={basename("/a/b.txt")}>hi</div>).toEqual({
            type: "div",
            props: { title: "b.txt", children: "hi" },
          });
        });
      `,
    });

    const [, stderr, exitCode] = await runBun(String(dir), ["test", "./component.test.jsx"]);
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("decorated.ts\n");
    expect(exitCode).toBe(0);
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("decorated.ts:Service\n");
    expect(exitCode).toBe(0);
  });

  // A .cts file is CommonJS because of its extension, not because of anything in its body.
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
        exports.Service = Service;
      `,
      "entry.js": `console.log(require("./service.cts").Service.tag);`,
    });

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("cts:Service\n");
    expect(exitCode).toBe(0);
  });

  // Top-level classes that can be hoisted are moved to the front of the module
  // before the helper bindings are generated. Lowering `accessor` calls a
  // "bun:wrap" helper while the class is being defined, so the binding has to
  // end up ahead of the hoisted class.
  test("commonjs module with a hoisted class that needs a bun:wrap helper", async () => {
    using dir = tempDir("run-cjs-hoisted-class-helper", {
      "box.ts": `
        const { basename } = require("node:path");
        class Box {
          accessor value = basename("/a/b.txt");
        }
        module.exports = { Box };
      `,
      "entry.js": `
        const { Box } = require("./box.ts");
        console.log(new Box().value);
      `,
    });

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("b.txt\n");
    expect(exitCode).toBe(0);
  });

  // `bun -e`, `bun -p` and `bun run -` evaluate their source as CommonJS too,
  // but without the function wrapper.
  test("bun -e using require() and JSX", async () => {
    using dir = tempDir("run-cjs-eval-jsx", fakeReact);

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["-e", requireAndJsx]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt" } });
    expect(exitCode).toBe(0);
  });

  test("bun -p prints the value of JSX that follows a require()", async () => {
    using dir = tempDir("run-cjs-print-jsx", fakeReact);

    const [stdout, stderr, exitCode] = await runBun(String(dir), [
      "-p",
      `const { basename } = require("node:path"); JSON.stringify(<div title={basename("/a/b.txt")} />)`,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`{"type":"div","props":{"title":"b.txt"}}\n`);
    expect(exitCode).toBe(0);
  });

  test("stdin script using require() and JSX", async () => {
    using dir = tempDir("run-cjs-stdin-jsx", fakeReact);

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["run", "-"], requireAndJsx);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt" } });
    expect(exitCode).toBe(0);
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

    const [stdout, stderr, exitCode] = await runBun(String(dir), ["entry.ts"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt", children: "hi" } });
    expect(exitCode).toBe(0);
  });
});
