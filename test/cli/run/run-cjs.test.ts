import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

// A stand-in for react's JSX runtime so the auto-imported `react/jsx-dev-runtime`
// (or `react/jsx-runtime`) resolves without touching the network.
const fakeReact = {
  "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
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

async function runFile(dir: string, file: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    cwd: dir,
    env: bunEnv,
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
  // statements. A module that uses require()/module.exports is evaluated inside
  // the CommonJS function wrapper, where those bindings have to be require()
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

    const [stdout, stderr, exitCode] = await runFile(String(dir), "entry.js");
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

    const [stdout, stderr, exitCode] = await runFile(String(dir), "app.tsx");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      type: "fragment",
      props: { children: { type: "h1", props: { children: "string" } } },
    });
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./component.test.jsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
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

    const [stdout, stderr, exitCode] = await runFile(String(dir), "entry.js");
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

    const [stdout, stderr, exitCode] = await runFile(String(dir), "entry.js");
    expect(stderr).toBe("");
    expect(stdout).toBe("decorated.ts:Service\n");
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

    const [stdout, stderr, exitCode] = await runFile(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ type: "div", props: { title: "b.txt", children: "hi" } });
    expect(exitCode).toBe(0);
  });
});
