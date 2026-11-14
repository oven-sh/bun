import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { type BundlerTestBundleAPI, type BundlerTestInput, itBundled } from "../../../bundler/expectBundled";

const source = `{
  using x = { [Symbol.dispose]() { console.log("sync disposed"); } };
  console.log("in scope");
}
async function f() {
  await using y = { [Symbol.asyncDispose]() { console.log("async disposed"); } };
  console.log("in async scope");
}
await f();
for (using z of [{ [Symbol.dispose]() { console.log("for-of disposed"); } }]) {
  console.log("for-of body");
}
using top = { [Symbol.dispose]() { console.log("top-level disposed"); } };
console.log("done");
`;

const expectedStdout =
  "in scope\n" +
  "sync disposed\n" +
  "in async scope\n" +
  "async disposed\n" +
  "for-of body\n" +
  "for-of disposed\n" +
  "done\n" +
  "top-level disposed\n";

describe("using / await using is not lowered when targeting bun", () => {
  test("single-use using declaration is not inlined away", () => {
    // When `using` was lowered, it was rewritten to `const` + try/finally before
    // the single-use-symbol inlining optimization ran. Now that `using` survives,
    // that optimization must not remove the declaration, since disposal is a side
    // effect that happens on scope exit.
    const t = new Bun.Transpiler({ target: "bun" });
    const out = t.transformSync(
      `function f() {
  using server = open();
  return server.url;
}
async function g() {
  await using conn = connect();
  return conn.id;
}
`,
      "js",
    );
    expect(out).toContain("using server = open()");
    expect(out).toContain("return server.url");
    expect(out).toContain("await using conn = connect()");
    expect(out).toContain("return conn.id");
    expect(out).not.toContain("return open().url");
    expect(out).not.toContain("return connect().id");
  });

  test("single-use using declaration disposes at runtime", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let disposed = false;
function open() {
  return {
    url: "http://example",
    [Symbol.dispose]() { disposed = true; },
  };
}
function f() {
  using server = open();
  return server.url;
}
const url = f();
console.log(url, disposed);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("http://example true\n");
    expect(exitCode).toBe(0);
  });

  test("Bun.Transpiler passes using / await using through for target=bun", () => {
    const bunTranspiler = new Bun.Transpiler({ target: "bun" });
    const out = bunTranspiler.transformSync(source, "js");

    expect(out).not.toContain("__using");
    expect(out).not.toContain("__callDispose");
    expect(out).toContain("using x =");
    expect(out).toContain("await using y =");
    expect(out).toContain("for (using z of ");
    expect(out).toContain("using top =");
  });

  test.each(["browser", "node"] as const)("Bun.Transpiler still lowers using / await using for target=%s", target => {
    const out = new Bun.Transpiler({ target }).transformSync(source, "js");

    expect(out).toContain("__using");
    expect(out).toContain("__callDispose");
    expect(out).not.toContain("using x =");
    expect(out).not.toContain("await using y =");
    expect(out).not.toContain("for (using z of ");
    expect(out).not.toContain("using top =");
  });

  test("bun build --target=bun passes using / await using through", async () => {
    using dir = tempDir("using-bun-target", {
      "entry.js": source,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).not.toContain("__using");
    expect(stdout).not.toContain("__callDispose");
    expect(stdout).toContain("using x =");
    expect(stdout).toContain("await using y =");
    expect(stdout).toContain("for (using z of ");
    expect(stdout).toContain("using top =");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=browser still lowers using / await using", async () => {
    using dir = tempDir("using-browser-target", {
      "entry.js": source,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=browser", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("__using");
    expect(stdout).toContain("__callDispose");
    expect(stdout).not.toContain("using x =");
    expect(stdout).not.toContain("await using y =");
    expect(stdout).not.toContain("for (using z of ");
    expect(stdout).not.toContain("using top =");
    expect(exitCode).toBe(0);
  });

  test("top-level using in a lazily-wrapped ESM module still disposes when bundled", async () => {
    // When bundling for bun, a module reached only via dynamic `import()` is
    // wrapped in `__esm(() => { ... })`. The linker hoists top-level locals out
    // of that closure as `var` + assignment; `using` must be exempt from that
    // hoist or disposal semantics are lost.
    using dir = tempDir("using-esm-wrap", {
      "entry.js": `const mod = await import("./lazy.js");
console.log("result:", mod.result);
`,
      "lazy.js": `using handle = { val: 42, [Symbol.dispose]() { console.log("disposed"); } };
export const result = handle.val;
`,
    });

    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--outfile=out.js", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([
      buildProc.stdout.text(),
      buildProc.stderr.text(),
      buildProc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    const out = await Bun.file(`${dir}/out.js`).text();
    expect(out).toContain("using handle =");

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

    expect(stdout).toBe("disposed\nresult: 42\n");
    expect(exitCode).toBe(0);
  });

  test("adjacent using declarations are not merged", () => {
    const t = new Bun.Transpiler({ target: "bun", minify: { syntax: true } } as Bun.TranspilerOptions);
    const out = t.transformSync(
      `function f() {
  using a = open();
  using b = open2();
  return [a.url, b.url];
}
`,
      "js",
    );
    // Match esbuild: keep separate `using` statements rather than merging
    // into `using a = open(), b = open2();`.
    expect(out).toContain("using a = open();");
    expect(out).toContain("using b = open2();");
  });

  test("bun build --target=bun output with using / await using runs correctly", async () => {
    using dir = tempDir("using-bun-target-run", {
      "entry.js": source,
    });

    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--outfile=out.js", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([
      buildProc.stdout.text(),
      buildProc.stderr.text(),
      buildProc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
  });

  test("runtime executes using / await using correctly without lowering", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
  });
});

describe("top-level using in a bundle for bun", () => {
  // `--target=bun` keeps `using` as it is written, inside the `__esm` wrapper of
  // a module that `import()` or `require()` reaches. A function declaration, a
  // value that runs no code and the namespace object print outside the wrapper.
  // What they read of the `using` binding is a variable of the chunk.
  const disposable = (name: string, log = "console.log") =>
    `{ name: "${name}", [Symbol.dispose]() { ${log}("${name}-disposed"); } }`;
  // The bundle has to print what the files print when bun runs them as they are.
  const printsUnbundled = (entry: string, stdout: string) => async (api: BundlerTestBundleAPI) => {
    await using proc = Bun.spawn({ cmd: [bunExe(), api.join(entry)], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [unbundled, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The report of a run that fails has its stderr.
    expect({ stdout: unbundled.trim(), exitCode, stderr: exitCode ? stderr : "" }).toEqual({
      stdout,
      exitCode: 0,
      stderr: "",
    });
  };
  const usingInEsmWrapper = {
    "/entry.js": `
      const m = await import("./dep.js");
      console.log(m.arrow(), m.fn(), new m.Reader().read(), m.default(), m.mixed(), m.other, m.f.name);
    `,
    // Each binding has one kind of reader, and only "f" is exported.
    "/dep.js": `
      using a = ${disposable("a")};
      using b = ${disposable("b")};
      using c = ${disposable("c")};
      using d = ${disposable("d")};
      using e = ${disposable("e")};
      using f = ${disposable("f")};
      export const arrow = () => a.name;
      export function fn() { return b.name; }
      export class Reader { read() { return c.name; } }
      export default () => d.name;
      export const mixed = () => e.name, other = [e.name].length;
      export { f };
      console.log("dep-end");
    `,
  };
  const usingInEsmWrapperStdout =
    "dep-end\nf-disposed\ne-disposed\nd-disposed\nc-disposed\nb-disposed\na-disposed\na b c d e 1 f";
  for (const [name, options] of Object.entries({
    "": {},
    "Minify": { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true },
    "NoTreeShaking": { treeShaking: false, backend: "api" },
    "CLI": { backend: "cli" },
  } satisfies Record<string, Partial<BundlerTestInput>>)) {
    itBundled(`using/InEsmWrapperReadOutsideIt${name}`, {
      files: usingInEsmWrapper,
      target: "bun",
      ...options,
      run: { stdout: usingInEsmWrapperStdout },
      onAfterBundle: printsUnbundled("/entry.js", usingInEsmWrapperStdout),
    });
  }
  for (const [name, options] of Object.entries({
    "esm": { format: "esm" },
    "cjs": { format: "cjs" },
    "bytecode": { format: "cjs", bytecode: true, outdir: "/out" },
  } satisfies Record<string, Partial<BundlerTestInput>>)) {
    itBundled(`using/InEsmWrapperReadOutsideItRequire-${name}`, {
      files: {
        "/entry.js": `
          const r = require("./req.js");
          console.log(r.fn(), r.default(), new r.Sub().read());
        `,
        // "Sub" runs code where it is defined, so it stays in the wrapper.
        "/req.js": `
          using a = ${disposable("a")};
          using b = ${disposable("b")};
          using c = ${disposable("c")};
          class Base {}
          export function fn() { return a.name; }
          export default function () { return b.name; }
          export class Sub extends Base { read() { return c.name; } }
          console.log("req-end");
        `,
      },
      target: "bun",
      ...options,
      run: { stdout: "req-end\nc-disposed\nb-disposed\na-disposed\na b c" },
      onAfterBundle(api) {
        expect(api.readFile("outdir" in options ? "/out/entry.js" : "/out.js")).toContain("using c = {");
        return printsUnbundled("/entry.js", "req-end\nc-disposed\nb-disposed\na-disposed\na b c")(api);
      },
    });
  }
  // The entry point has a wrapper because "other.js" requires it. Its
  // `export { res }` is a statement of the chunk.
  itBundled("using/InEsmWrapperExportedFromEntry", {
    files: {
      "/entry.js": `
        using res = ${disposable("res")};
        export { res };
        const other = require("./other.js");
        console.log("entry-end", other.peek());
      `,
      "/other.js": `exports.peek = () => typeof require("./entry.js").res;`,
    },
    target: "bun",
    run: { stdout: "entry-end object\nres-disposed" },
    onAfterBundle: printsUnbundled("/entry.js", "entry-end object\nres-disposed"),
  });
  // One entry point imports "dep.js" and the other requires it, so it is a
  // chunk of its own with a wrapper. The chunk exports the binding.
  itBundled("using/InEsmWrapperExportedFromChunk", {
    files: {
      "/entry.js": `
        const m = await import("./dep.js");
        console.log("entry", m.fn(), m.res.name);
      `,
      "/entry2.js": `
        const m = require("./dep.js");
        console.log("entry2", m.fn(), m.res.name);
      `,
      "/dep.js": `
        using res = ${disposable("res")};
        export function fn() { return res.name; }
        export { res };
        console.log("dep-end");
      `,
    },
    entryPoints: ["/entry.js", "/entry2.js"],
    outdir: "/out",
    target: "bun",
    splitting: true,
    run: [
      { file: "/out/entry.js", stdout: "dep-end\nres-disposed\nentry res res" },
      { file: "/out/entry2.js", stdout: "dep-end\nres-disposed\nentry2 res res" },
    ],
    onAfterBundle: printsUnbundled("/entry.js", "dep-end\nres-disposed\nentry res res"),
  });
  // `await using` makes the wrapper an async function. A function reads "a",
  // and the module exports "b". The disposer of "b" ends in a later task, so
  // the order holds only if the module waits for it.
  itBundled("using/InEsmWrapperAwaitUsing", {
    files: {
      "/entry.js": `
        const m = await import("./dep.js");
        console.log(m.fn(), m.b.name);
      `,
      "/dep.js": `
        await using a = { name: "a", async [Symbol.asyncDispose]() { console.log("a-disposed"); } };
        await using b = {
          name: "b",
          async [Symbol.asyncDispose]() {
            await new Promise(resolve => setImmediate(resolve));
            console.log("b-disposed");
          },
        };
        export function fn() { return a.name; }
        export { b };
        console.log("dep-end");
      `,
    },
    target: "bun",
    run: { stdout: "dep-end\nb-disposed\na-disposed\na b" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("await using a2 = a = {");
      return printsUnbundled("/entry.js", "dep-end\nb-disposed\na-disposed\na b")(api);
    },
  });
  itBundled("using/InEsmWrapperDirectEval", {
    files: {
      "/entry.js": `
        const m = await import("./dep.js");
        console.log(m.peek());
      `,
      "/dep.js": `
        using res = ${disposable("res")};
        export function peek() { return eval("res.name"); }
        console.log("dep-end");
      `,
    },
    target: "bun",
    run: { stdout: "dep-end\nres-disposed\nres" },
    onAfterBundle: printsUnbundled("/entry.js", "dep-end\nres-disposed\nres"),
  });
  // What a component that the React Compiler compiled needs of React.
  const reactStandIn = {
    "/tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        paths: {
          "react/jsx-runtime": ["./react/jsx-runtime.js"],
          "react/jsx-dev-runtime": ["./react/jsx-runtime.js"],
          "react/compiler-runtime": ["./react/render.js"],
        },
      },
    }),
    "/react/jsx-runtime.js": `
      export const jsx = (type, props) =>
        typeof type === "function" ? type(props) : "<" + type + ">" + props.children.join("") + "</" + type + ">";
      export const jsxs = jsx;
      export const jsxDEV = jsx;
    `,
    "/react/render.js": `
      const caches = new Map();
      let rendering;
      export function render(component, props) {
        rendering = component;
        return component(props);
      }
      export function c(size) {
        if (!caches.has(rendering)) caches.set(rendering, new Array(size).fill(Symbol.for("react.memo_cache_sentinel")));
        return caches.get(rendering);
      }
    `,
  };
  // The React Compiler moves the callback out of the component, into a
  // function declaration of the module.
  itBundled("using/InEsmWrapperReactCompiler", {
    files: {
      "/entry.jsx": `
        import { render } from "./react/render.js";
        const { Comp } = await import("./dep.jsx");
        console.log(render(Comp, { a: 1 }));
      `,
      "/dep.jsx": `
        using res = ${disposable("res")};
        export const Comp = ({ a }) => {
          const names = [1, 2].map(x => res.name + x);
          return <b>{names.join(",")}{a}</b>;
        };
        console.log("dep-end");
      `,
      ...reactStandIn,
    },
    target: "bun",
    reactCompiler: true,
    run: { stdout: "dep-end\nres-disposed\n<b>res1,res21</b>" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("function _temp(");
      return printsUnbundled("/entry.jsx", "dep-end\nres-disposed\n<b>res1,res21</b>")(api);
    },
  });
});
