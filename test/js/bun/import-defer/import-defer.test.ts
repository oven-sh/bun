// Tests for the TC39 Stage 3 "import defer" proposal.
// https://github.com/tc39/proposal-defer-import-eval
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(files: Record<string, string>, entry = "main.mjs") {
  using dir = tempDir("import-defer", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// The runtime semantics live in JavaScriptCore. Until the oven-sh/WebKit
// revision that adds ModulePhase (oven-sh/WebKit#206) is picked up by the
// prebuilt WebKit used in CI, probe for it by running a minimal deferred
// import and skip the runtime suites if it doesn't parse. The
// transpiler-only tests below are unconditional.
const runtimeSupported = await (async () => {
  const { exitCode } = await run({
    "main.mjs": `import defer * as x from "./empty.mjs"; void x;`,
    "empty.mjs": `export {};`,
  });
  return exitCode === 0;
})();
const describeRuntime = runtimeSupported ? describe : describe.skip;

describeRuntime("import defer (static)", () => {
  test("module is not evaluated until a property is accessed", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        globalThis.order = [];
        import defer * as ns from "./dep.mjs";
        order.push("main");
        console.log(order.join(","));
        // trigger evaluation
        void ns.value;
        console.log(order.join(","));
        // second access does not re-evaluate
        void ns.value;
        console.log(order.join(","));
      `,
      "dep.mjs": `
        globalThis.order.push("dep");
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["main", "main,dep", "main,dep"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("transitive sync dependencies are also deferred", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        globalThis.order = [];
        import defer * as ns from "./a.mjs";
        order.push("main");
        console.log(order.join(","));
        void ns.value;
        console.log(order.join(","));
      `,
      "a.mjs": `
        import "./b.mjs";
        globalThis.order.push("a");
        export const value = 1;
      `,
      "b.mjs": `
        globalThis.order.push("b");
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["main", "main,b,a"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("module already evaluated via another import is not re-evaluated", async () => {
    const { stdout, stderr, exitCode } = await run({
      "setup.mjs": `globalThis.order = [];`,
      "main.mjs": `
        import "./setup.mjs";
        import "./dep.mjs";
        import defer * as ns from "./dep.mjs";
        order.push("main");
        void ns.value;
        console.log(order.join(","));
      `,
      "dep.mjs": `
        globalThis.order.push("dep");
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("dep,main");
    expect(exitCode).toBe(0);
  });

  test("same specifier deferred twice produces a single requested-module entry", async () => {
    // ModuleInfo must dedup defer-phase requests per specifier to match
    // JSC's ModuleAnalyzer; in debug builds a mismatch fails the
    // fallbackParse() diff in BunAnalyzeTranspiledModule.cpp.
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        globalThis.order = [];
        import defer * as a from "./dep.mjs";
        import defer * as b from "./dep.mjs";
        order.push("main");
        console.log(a === b);
        console.log(order.join(","));
        void a.value;
        console.log(order.join(","));
      `,
      "dep.mjs": `
        globalThis.order.push("dep");
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["true", "main", "main,dep"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("deferred namespace has @@toStringTag 'Deferred Module' and hides 'then'", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        import defer * as ns from "./dep.mjs";
        console.log(ns[Symbol.toStringTag]);
        console.log(Object.prototype.toString.call(ns));
        console.log(typeof ns.then);
        console.log(Object.keys(ns).includes("then"));
      `,
      "dep.mjs": `
        export const value = 1;
        export function then(resolve) { resolve("bad"); }
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["Deferred Module", "[object Deferred Module]", "undefined", "false"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("deferred namespace is distinct from regular namespace", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        import defer * as deferred from "./dep.mjs";
        import * as regular from "./dep.mjs";
        console.log(deferred === regular);
        console.log(regular[Symbol.toStringTag]);
        console.log(deferred[Symbol.toStringTag]);
      `,
      "dep.mjs": `
        export const value = 1;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["false", "Module", "Deferred Module"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("throwing module rethrows on every access", async () => {
    const { stdout, exitCode } = await run({
      "main.mjs": `
        import defer * as ns from "./dep.mjs";
        for (let i = 0; i < 2; i++) {
          try {
            void ns.value;
            console.log("no throw");
          } catch (e) {
            console.log("caught", e.message);
          }
        }
      `,
      "dep.mjs": `
        throw new Error("boom");
        export const value = 1;
      `,
    });
    expect(stdout).toBe(["caught boom", "caught boom"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("async transitive dependency is eagerly evaluated", async () => {
    // Per spec: TLA modules in a deferred subgraph are evaluated eagerly
    // (so that property-access evaluation can be synchronous).
    const { stdout, stderr, exitCode } = await run({
      "setup.mjs": `globalThis.order = [];`,
      "main.mjs": `
        import "./setup.mjs";
        import defer * as ns from "./a.mjs";
        order.push("main");
        console.log(order.join(","));
        void ns.value;
        console.log(order.join(","));
      `,
      "a.mjs": `
        import "./b.mjs";
        globalThis.order.push("a");
        export const value = 1;
      `,
      "b.mjs": `
        await 0;
        globalThis.order.push("b");
      `,
    });
    expect(stderr).toBe("");
    // b has TLA so it is eagerly evaluated; a is deferred.
    expect(stdout).toBe(["b,main", "b,main,a"].join("\n"));
    expect(exitCode).toBe(0);
  });

  test("'import defer from' is a default import named 'defer' (back-compat)", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        import defer from "./dep.mjs";
        console.log(defer);
      `,
      "dep.mjs": `
        export default "hello";
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("'import defer {x}' is a syntax error", async () => {
    const { exitCode, stderr } = await run({
      "main.mjs": `
        import defer { x } from "./dep.mjs";
      `,
      "dep.mjs": `export const x = 1;`,
    });
    expect(stderr).toContain("error");
    expect(exitCode).not.toBe(0);
  });
});

describe("import.defer() (dynamic)", () => {
  test("transpiler preserves import.defer()", async () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });
    const out = await transpiler.transform(`const ns = import.defer("./x.js");`);
    expect(out).toContain("import.defer(");
  });

  test.skipIf(!runtimeSupported)("returns a deferred namespace object", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        const ns = await import.defer("./dep.mjs");
        console.log(ns[Symbol.toStringTag]);
        console.log(Object.prototype.toString.call(ns));
        console.log(typeof ns.then);
        console.log(ns.value);
      `,
      "dep.mjs": `
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["Deferred Module", "[object Deferred Module]", "undefined", "42"].join("\n"));
    expect(exitCode).toBe(0);
  });

  // The dynamic form currently evaluates the module body eagerly; per spec
  // only async transitive dependencies should run during the import.defer()
  // call. Full lazy evaluation requires threading ModulePhase through
  // ContinueDynamicImport and the moduleLoaderImportModule embedder hook.
  test.todo("module is not evaluated until a property is accessed (dynamic)", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.mjs": `
        globalThis.order = [];
        const ns = await import.defer("./dep.mjs");
        order.push("main");
        console.log(order.join(","));
        void ns.value;
        console.log(order.join(","));
      `,
      "dep.mjs": `
        globalThis.order.push("dep");
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(["main", "main,dep"].join("\n"));
    expect(exitCode).toBe(0);
  });
});

describe("transpiler", () => {
  test("static import defer round-trips", async () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });
    const out = await transpiler.transform(`import defer * as ns from "./x.js"; console.log(ns.value);`);
    expect(out).toContain("import defer");
    expect(out).toContain("* as ns");
  });

  test("import.source round-trips", async () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });
    const out = await transpiler.transform(`const m = import.source("./x.wasm");`);
    expect(out).toContain("import.source(");
  });
});
