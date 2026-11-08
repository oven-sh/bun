import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
    const [unbundled] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(unbundled.trim()).toBe(stdout);
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

  // `--target=bun` keeps `using` as it is written. A module with a top-level
  // `using` that is not the last one of its chunk gets a block of its own, so
  // the resource is disposed when the module ends.
  const usingTopLevel = {
    "/entry.js": `
      import { log, render } from "./dep.js";
      log.push(render());
      console.log(log.join(" "));
    `,
    "/dep.js": `
      export const log = [];
      using res = ${disposable("module", "log.push")};
      export function render() { log.push("render"); return "module"; }
      log.push("module-end");
    `,
  };
  for (const [name, options] of Object.entries({
    "": {},
    "CLI": { backend: "cli" },
    "Cjs": { format: "cjs" },
    "Iife": { format: "iife" },
    "Minify": { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true },
    "Bytecode": { format: "cjs", bytecode: true, outdir: "/out" },
    "NoTreeShaking": { treeShaking: false, backend: "api" },
  } satisfies Record<string, Partial<BundlerTestInput>>)) {
    itBundled(`using/TopLevelDisposedAtModuleEnd${name}`, {
      files: usingTopLevel,
      target: "bun",
      ...options,
      run: { stdout: "module-end module-disposed render module" },
      onAfterBundle(api) {
        const out = api.readFile("outdir" in options ? "/out/entry.js" : "/out.js");
        expect(out).not.toContain("__using");
        expect(out).not.toContain("__callDispose");
        if (name === "") expect(out).toContain("var res;\n{\n  using res2 = res = {");
        return printsUnbundled("/entry.js", "module-end module-disposed render module")(api);
      },
    });
  }

  // The entry point is the last module of its chunk: the scope of the chunk
  // ends where the entry point ends, so it prints as it is written.
  itBundled("using/TopLevelAwaitUsing", {
    files: {
      "/entry.js": `
        import { log, render } from "./a.js";
        import { K, counter, bump } from "./b.js";
        bump();
        log.push(render(), "counter=" + counter, typeof K);
        using e = ${disposable("entry")};
        console.log(log.join(" "));
      `,
      "/a.js": `
        export const log = [];
        await using res = { async [Symbol.asyncDispose]() { log.push("a-disposed"); } };
        export function render() { log.push("render"); return "module"; }
        log.push("a-end");
      `,
      "/b.js": `
        import { log } from "./a.js";
        using res = ${disposable("b", "log.push")};
        export class K { static n = log.push("K-static"); }
        export let counter = 0;
        export function bump() { counter++; }
        log.push("b-end");
      `,
    },
    target: "bun",
    run: {
      stdout: "a-end a-disposed K-static b-end b-disposed render module counter=1 function\nentry-disposed",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("  await using res3 = res = {");
      expect(out).toContain("\nusing e = {");
      return printsUnbundled(
        "/entry.js",
        "a-end a-disposed K-static b-end b-disposed render module counter=1 function\nentry-disposed",
      )(api);
    },
  });

  // Each reader of the `using` binding prints at another place: in front of
  // the `using`, in front of the block, in the block, in another module.
  const usingTopLevelReaders = {
    "/entry.js": `
      import def, * as ns from "./dep.js";
      import { log, read, arrow, res, Reader } from "./dep.js";
      log.push(read(), arrow(), res.name, def.name, ns.res.name, new Reader().read(), typeof ns.read);
      console.log(log.join(" "));
    `,
    "/dep.js": `
      export const log = [];
      export const early = () => res.name;
      using res = ${disposable("res", "log.push")};
      export function read() { return res.name; }
      export const arrow = () => res.name;
      export class Reader { read() { return res.name; } }
      export { res };
      export default res;
      log.push("dep-end", early());
    `,
  };
  for (const [name, options] of Object.entries({
    "": {},
    "Minify": { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true },
    "NoTreeShaking": { treeShaking: false, backend: "api" },
  } satisfies Record<string, Partial<BundlerTestInput>>)) {
    itBundled(`using/TopLevelBindingReadOutsideItsBlock${name}`, {
      files: usingTopLevelReaders,
      target: "bun",
      ...options,
      run: { stdout: "dep-end res res-disposed res res res res res res function" },
      onAfterBundle: printsUnbundled("/entry.js", "dep-end res res-disposed res res res res res res function"),
    });
  }
  itBundled("using/TopLevelDirectEval", {
    files: {
      "/entry.js": `
        import { log, peek } from "./dep.js";
        log.push(peek());
        console.log(log.join(" "));
      `,
      "/dep.js": `
        export const log = [];
        using res = ${disposable("res", "log.push")};
        export function peek() { return eval("res.name"); }
        log.push("dep-end");
      `,
    },
    target: "bun",
    run: { stdout: "dep-end res-disposed res" },
    onAfterBundle: printsUnbundled("/entry.js", "dep-end res-disposed res"),
  });
  // The function that the React Compiler makes of the callback prints in front
  // of the block.
  itBundled("using/TopLevelReactCompiler", {
    files: {
      "/entry.jsx": `
        import { render } from "./react/render.js";
        import { Comp, log } from "./dep.jsx";
        log.push(render(Comp, { a: 1 }));
        console.log(log.join(" "));
      `,
      "/dep.jsx": `
        export const log = [];
        using res = ${disposable("res", "log.push")};
        export const Comp = ({ a }) => {
          const names = [1, 2].map(x => res.name + x);
          return <b>{names.join(",")}{a}</b>;
        };
        log.push("dep-end");
      `,
      ...reactStandIn,
    },
    target: "bun",
    reactCompiler: true,
    run: { stdout: "dep-end res-disposed <b>res1,res21</b>" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("function _temp(");
      return printsUnbundled("/entry.jsx", "dep-end res-disposed <b>res1,res21</b>")(api);
    },
  });

  // A class that runs no code where it is defined stays a declaration in
  // front of the block, so it has its value where "early" reads it, as in the
  // unbundled module. "Sub" runs code, and keeps its place in the block.
  itBundled("using/TopLevelClasses", {
    files: {
      "/entry.js": `
        import def, { log, make, Sub } from "./dep.js";
        log.push(typeof make(), new Sub().read(), def());
        console.log(log.join(" "));
      `,
      "/dep.js": `
        export const log = [];
        class Base {}
        using res = ${disposable("res", "log.push")};
        log.push("early:" + typeof make());
        export class K { read() { return res.name; } }
        export function make() { return K; }
        export class Sub extends Base { read() { return new K().read(); } }
        export default function () { return "default:" + res.name; }
        log.push("dep-end");
      `,
    },
    target: "bun",
    run: { stdout: "early:function dep-end res-disposed function res default:res" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("\nclass K {");
      expect(out).toContain("  var Sub = class Sub extends Base {");
      return printsUnbundled("/entry.js", "early:function dep-end res-disposed function res default:res")(api);
    },
  });

  // Functions of a module of an import cycle work before the module runs.
  itBundled("using/TopLevelImportCycle", {
    files: {
      "/entry.js": `
        import { log, K, counter, bump } from "./a.js";
        bump();
        log.push("counter=" + counter, K.tag);
        console.log(log.join(" | "));
      `,
      "/a.js": `
        import { fromB } from "./b.js";
        export const log = (globalThis.log ??= []);
        using res = ${disposable("res", "log.push")};
        export class K { static tag = "K"; }
        export let counter = 0;
        export function bump() { return ++counter; }
        log.push("a-end fromB=" + fromB() + " counter=" + counter);
      `,
      "/b.js": `
        import { bump } from "./a.js";
        (globalThis.log ??= []).push("b-start " + typeof bump);
        export function fromB() { return "B"; }
      `,
    },
    target: "bun",
    run: { stdout: "b-start function | a-end fromB=B counter=0 | res-disposed | counter=1 | K" },
    onAfterBundle: printsUnbundled(
      "/entry.js",
      "b-start function | a-end fromB=B counter=0 | res-disposed | counter=1 | K",
    ),
  });
  // Known difference: in the unbundled module a read of the binding before its
  // declaration throws a ReferenceError. In the block the binding is a `var` of
  // the chunk, as it is in a bundle for node.
  for (const target of ["bun", "node"] as const) {
    itBundled(`using/TopLevelReadBeforeItsModuleRuns-${target}`, {
      files: {
        "/entry.js": `
          import { log, peek } from "./a.js";
          log.push("entry:" + peek());
          console.log(log.join(" "));
        `,
        "/a.js": `
          import "./b.js";
          export const log = (globalThis.log ??= []);
          using res = ${disposable("res", "log.push")};
          export function peek() { try { return typeof res; } catch (e) { return e.constructor.name; } }
          log.push("a-end");
        `,
        "/b.js": `
          import { peek } from "./a.js";
          (globalThis.log ??= []).push("b:" + peek());
        `,
      },
      target,
      run: { stdout: "b:undefined a-end res-disposed entry:object" },
      onAfterBundle: printsUnbundled("/entry.js", "b:ReferenceError a-end res-disposed entry:object"),
    });
  }

  itBundled("using/TopLevelSeveralDeclarations", {
    files: {
      "/entry.js": `
        import { log, names, Before, After, make, ok } from "./dep.js";
        log.push(names(), new Before().tag, new After().tag, make().tag, typeof ok);
        console.log(log.join(" "));
      `,
      "/dep.js": `
        import { ok } from "node:assert";
        export const log = [];
        export class Before { tag = "before"; }
        export const make = () => new After();
        log.push("start");
        using a = ${disposable("a", "log.push")}, b = ${disposable("b", "log.push")};
        log.push("between");
        using c = ${disposable("c", "log.push")};
        export function names() { return a.name + c.name; }
        export class After { tag = "after"; static made = log.push("After-defined"); }
        export { ok } from "node:assert";
        log.push("dep-end", b.name, typeof ok);
      `,
    },
    target: "bun",
    run: {
      stdout:
        "start between After-defined dep-end b function c-disposed b-disposed a-disposed ac before after after function",
    },
    onAfterBundle: printsUnbundled(
      "/entry.js",
      "start between After-defined dep-end b function c-disposed b-disposed a-disposed ac before after after function",
    ),
  });
  // Without tree shaking the statements of a module are one part, in the order
  // of the source. An `import` and an `export * from` after the `using` are not
  // statements of a block.
  itBundled("using/TopLevelImportAfterUsingNoTreeShaking", {
    files: {
      "/a.js": `
        export const log = [];
        using res = ${disposable("res", "log.push")};
        import { sep } from "node:path";
        export * from "node:path";
        export function render() { return "render:" + res.name + typeof sep; }
        log.push("a-end");
      `,
      "/b.js": `
        import { log, render } from "./a.js";
        log.push(render());
        console.log(log.join(" "));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    target: "bun",
    treeShaking: false,
    backend: "api",
    run: [{ file: "/out/b.js", stdout: "a-end res-disposed render:resstring" }],
    onAfterBundle(api) {
      const out = api.readFile("/out/b.js");
      expect(out.indexOf('import { sep } from "path";')).toBeLessThan(out.indexOf("{\n  using res"));
      expect(out.indexOf('export * from "path";')).toBeLessThan(out.indexOf("{\n  using res"));
      return printsUnbundled("/b.js", "a-end res-disposed render:resstring")(api);
    },
  });

  // The next module does not run after a disposer that throws.
  itBundled("using/TopLevelDisposerThrows", {
    files: {
      "/entry.js": `
        import "./a.js";
        import "./b.js";
        console.log("entry");
      `,
      "/a.js": `
        using r = { [Symbol.dispose]() { console.log("a-disposed"); throw new Error("dispose failed"); } };
        console.log("a-end");
      `,
      "/b.js": `console.log("b ran");`,
    },
    target: "bun",
    run: {
      error: "error: dispose failed",
      stdout: "a-end\na-disposed",
    },
    onAfterBundle: printsUnbundled("/entry.js", "a-end\na-disposed"),
  });

  // A later module that ends the process does not skip the disposal.
  itBundled("using/TopLevelLaterModuleExits", {
    files: {
      "/entry.js": `
        import "./dep.js";
        import "./later.js";
        console.log("entry");
      `,
      "/dep.js": `
        using r = ${disposable("dep")};
        console.log("dep-end");
      `,
      "/later.js": `
        console.log("later");
        process.exit(0);
      `,
    },
    target: "bun",
    run: { stdout: "dep-end\ndep-disposed\nlater" },
    onAfterBundle: printsUnbundled("/entry.js", "dep-end\ndep-disposed\nlater"),
  });

  // The binding is exported to the entry point chunks from a chunk that two
  // entry points share.
  itBundled("using/TopLevelSplitting", {
    files: {
      "/e1.js": `
        import { log, res } from "./shared1.js";
        import { two } from "./shared2.js";
        log.push("e1:" + two, res.name);
        console.log(log.join(" "));
      `,
      "/e2.js": `
        import { log } from "./shared1.js";
        import { two } from "./shared2.js";
        log.push("e2:" + two);
        console.log(log.join(" "));
      `,
      "/shared1.js": `
        export const log = [];
        using res = ${disposable("shared1", "log.push")};
        export { res };
        log.push("shared1-end");
      `,
      "/shared2.js": `
        import { log } from "./shared1.js";
        export const two = 2;
        log.push("shared2-end");
      `,
    },
    entryPoints: ["/e1.js", "/e2.js"],
    outdir: "/out",
    target: "bun",
    splitting: true,
    run: [
      { file: "/out/e1.js", stdout: "shared1-end shared1-disposed shared2-end e1:2 shared1" },
      { file: "/out/e2.js", stdout: "shared1-end shared1-disposed shared2-end e2:2" },
    ],
    onAfterBundle: printsUnbundled("/e1.js", "shared1-end shared1-disposed shared2-end e1:2 shared1"),
  });

  // Without splitting, an entry point that another entry point imports is in
  // two chunks. It is the last module of its own chunk only.
  itBundled("using/TopLevelEntryImportedByEntry", {
    files: {
      "/a.js": `
        import { log } from "./b.js";
        log.push("a-end");
        console.log(log.join(" "));
      `,
      "/b.js": `
        export const log = [];
        using res = { [Symbol.dispose]() { log.push("b-disposed"); console.log(log.join(" ")); } };
        log.push("b-end");
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    target: "bun",
    run: [
      { file: "/out/a.js", stdout: "b-end b-disposed\nb-end b-disposed a-end" },
      { file: "/out/b.js", stdout: "b-end b-disposed" },
    ],
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toContain("{\n  using res2 = res = {");
      expect(api.readFile("/out/b.js")).toContain("\nusing res = {");
      return printsUnbundled("/a.js", "b-end b-disposed\nb-end b-disposed a-end")(api);
    },
  });

  itBundled("using/TopLevelLiftedCommonJS", {
    files: {
      "/entry.js": `
        import { render } from "./dep.cjs";
        log.push("entry:" + render());
        console.log(log.join(" "));
      `,
      "/dep.cjs": `
        globalThis.log = [];
        using res = ${disposable("cjs", "log.push")};
        exports.render = function () { return "cjs"; };
        log.push("cjs-end");
      `,
    },
    target: "bun",
    run: { stdout: "cjs-end cjs-disposed entry:cjs" },
    onAfterBundle: printsUnbundled("/entry.js", "cjs-end cjs-disposed entry:cjs"),
  });

  // "dep.js" prints in two places, around "config.js". The unused "none" is
  // dropped, so its first `using` is "res", in the second place.
  itBundled("using/TopLevelNotInTheFirstRangeOfItsModule", {
    files: {
      "/entry.js": `
        import { log, late, early } from "./dep.js";
        log.push(late(), early());
        console.log(log.join(" "));
      `,
      "/dep.js": `
        import { sep } from "node:path";
        import { config } from "./config.js";
        export const log = [];
        export const early = () => res.name;
        export const unused = () => "tree-shaken";
        using none = null;
        using res = { name: config.name, [Symbol.dispose]() { log.push("dep-disposed"); } };
        export function late() { return res.name + typeof sep; }
        log.push("dep-end", early());
      `,
      "/config.js": `export const config = { name: "res" };`,
    },
    target: "bun",
    run: { stdout: "dep-end res dep-disposed resstring res" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.split("// dep.js").length).toBe(3);
      expect(out.indexOf("// config.js")).toBeLessThan(out.indexOf("{\n  using res"));
      return printsUnbundled("/entry.js", "dep-end res dep-disposed resstring res")(api);
    },
  });

  // A module this large prints as several ranges of statements. The block
  // holds all of them.
  const usingTopLevelFiller = `n += "${Buffer.alloc(4096, "x").toString()}".length;\n`;
  itBundled("using/TopLevelLargeModule", {
    files: {
      "/entry.js": `
        import { log } from "./big.js";
        log.push("entry");
        console.log(log.join(" "));
      `,
      "/big.js":
        `export const log = [];\nusing res = ${disposable("big", "log.push")};\nlet n = 0;\n` +
        Buffer.alloc(40 * usingTopLevelFiller.length, usingTopLevelFiller).toString() +
        `log.push("big-end", n);\n`,
    },
    target: "bun",
    run: { stdout: `big-end ${40 * 4096} big-disposed entry` },
  });

  // Known limit: "b.js" prints inside "a.js", where `require.resolve()` names
  // it, so no block can hold the statements of "a.js". "a.js" prints as it did,
  // and its resource is disposed when the chunk ends. "c.js" has its block.
  itBundled("using/TopLevelWithAnotherFileInside", {
    files: {
      "/entry.js": `
        import { log } from "./c.js";
        import { x } from "./a.js";
        import { y } from "./b.js";
        log.push("entry", x, y);
        console.log(log.join(" "));
      `,
      "/c.js": `
        export const log = (globalThis.log = []);
        using rc = ${disposable("c", "log.push")};
        log.push("c-end");
      `,
      "/a.js": `
        log.push("a1");
        using ra = ${disposable("a")};
        const p = require.resolve("./b.js");
        log.push("a2", typeof p);
        export const x = 1;
      `,
      "/b.js": `
        export const y = 2;
        log.push("b");
      `,
    },
    target: "bun",
    run: { stdout: "c-end c-disposed a1 b a2 string entry 1 2\na-disposed" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("{\n  using rc2 = rc = {");
      expect(out).toContain("\nusing ra = {");
    },
  });

  // A library build writes the bundle once more with its types, from the
  // declarations as they are written. It prints as it did. The type check is
  // slow on a debug build with a cold page cache.
  test("a library build prints a module with a top-level using as it did", async () => {
    using dir = tempDir("using-top-level-dts", {
      "package.json": JSON.stringify({
        name: "lib",
        compilerOptions: { strict: true, lib: ["esnext", "esnext.disposable"] },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          lib: ["esnext", "esnext.disposable"],
          types: [],
        },
      }),
      "entry.ts": `
        import { log, render, Widget } from "./dep";
        export function go(w: Widget): string { log.push(render(w)); return log.join(" "); }
      `,
      "dep.ts": `
        export const log: string[] = [];
        using res = { [Symbol.dispose]() { log.push("module-disposed"); } };
        export class Widget { name: string = "w"; }
        export function render(w: Widget): string { return w.name; }
        log.push("module-end");
      `,
    });
    const root = String(dir);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.ts", "--target=bun", "--dts", "--outdir=out"],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({
      stderr,
      files: readdirSync(join(root, "out")).sort(),
      using: (await Bun.file(join(root, "out", "entry.js")).text()).match(/^ *using .*$/m)?.[0],
      exitCode,
    }).toEqual({
      stderr: "",
      files: ["dep.d.ts", "entry.aot.ts", "entry.d.ts", "entry.js"],
      using: "using res = { [Symbol.dispose]() {",
      exitCode: 0,
    });
  }, 60_000);
});
