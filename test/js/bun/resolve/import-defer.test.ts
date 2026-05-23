// TC39 proposal-defer-import-eval (Stage 3) — static `import defer * as ns from "..."`
// https://tc39.es/proposal-defer-import-eval/

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(files: Record<string, string>, entry = "main.js") {
  using dir = tempDir("import-defer", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("import defer", () => {
  test("defers module evaluation until a property is accessed", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as ns from "./dep.js";
        console.log("before access");
        console.log("value:", ns.value);
        console.log("after access");
        console.log("add:", ns.add(1, 2));
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 42;
        export function add(a, b) { return a + b; }
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "before access",
      "dep evaluated",
      "value: 42",
      "after access",
      "add: 3",
    ]);
    expect(exitCode).toBe(0);
  });

  test("does not re-evaluate on subsequent access", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as ns from "./dep.js";
        console.log(ns.x);
        console.log(ns.x);
        console.log(ns.y);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const x = 1;
        export const y = 2;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["dep evaluated", "1", "1", "2"]);
    expect(exitCode).toBe(0);
  });

  test("reading Symbol.toStringTag does not trigger evaluation", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as ns from "./dep.js";
        console.log(ns[Symbol.toStringTag]);
        console.log("---");
        console.log(ns.value);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 7;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["Deferred Module", "---", "dep evaluated", "7"]);
    expect(exitCode).toBe(0);
  });

  test("evaluation is triggered by 'in' and Object.keys", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as a from "./a.js";
        import defer * as b from "./b.js";
        console.log("before");
        console.log("has:", "value" in a);
        console.log("keys:", Object.keys(b).sort().join(","));
      `,
      "a.js": `console.log("a evaluated"); export const value = 1;`,
      "b.js": `console.log("b evaluated"); export const x = 1; export const y = 2;`,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "before",
      "a evaluated",
      "has: true",
      "b evaluated",
      "keys: x,y",
    ]);
    expect(exitCode).toBe(0);
  });

  test("throwing module re-throws on each access", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as ns from "./throws.js";
        for (let i = 0; i < 2; i++) {
          try {
            void ns.value;
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", e.message);
          }
        }
      `,
      "throws.js": `
        throw new Error("boom");
        export const value = 1;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: boom", "caught: boom"]);
    expect(exitCode).toBe(0);
  });

  test("same module imported at both evaluation and defer phase", async () => {
    // The eager import runs the module before main; the deferred namespace
    // shares the already-evaluated module.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import * as eager from "./dep.js";
        import defer * as lazy from "./dep.js";
        console.log("main start");
        console.log("eager:", eager.value);
        console.log("lazy:", lazy.value);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 1;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["dep evaluated", "main start", "eager: 1", "lazy: 1"]);
    expect(exitCode).toBe(0);
  });

  test("deferred module with an async transitive dependency evaluates the async dep eagerly", async () => {
    // Per spec, GatherAsynchronousTransitiveDependencies: modules reachable
    // from a defer-phase request that contain top-level await are evaluated
    // up-front so the deferred namespace can be satisfied synchronously.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as ns from "./dep.js";
        console.log("main start");
        console.log("value:", ns.value);
      `,
      "dep.js": `
        import { ready } from "./tla.js";
        console.log("dep evaluated");
        export const value = ready;
      `,
      "tla.js": `
        console.log("tla start");
        await Promise.resolve();
        console.log("tla done");
        export const ready = "ok";
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "tla start",
      "tla done",
      "main start",
      "dep evaluated",
      "value: ok",
    ]);
    expect(exitCode).toBe(0);
  });

  test("re-export of a deferred namespace is a local export", async () => {
    // `import defer * as ns; export { ns }` exports the *deferred* namespace
    // object as a local binding — it does not turn into a namespace re-export,
    // so the target stays unevaluated until touched.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import { ns } from "./middle.js";
        console.log("main start");
        console.log("value:", ns.value);
      `,
      "middle.js": `
        import defer * as ns from "./dep.js";
        console.log("middle evaluated");
        export { ns };
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 5;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["middle evaluated", "main start", "dep evaluated", "value: 5"]);
    expect(exitCode).toBe(0);
  });

  test("import defer with import attributes", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as data from "./data.json" with { type: "json" };
        console.log("before");
        console.log(data.default.hello);
      `,
      "data.json": JSON.stringify({ hello: "world" }),
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before", "world"]);
    expect(exitCode).toBe(0);
  });

  test("works in .ts files", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import defer * as ns from "./dep.ts";
          console.log("before");
          console.log(ns.value);
        `,
        "dep.ts": `
          console.log("dep evaluated");
          export const value: number = 9;
        `,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before", "dep evaluated", "9"]);
    expect(exitCode).toBe(0);
  });

  test("namespace only referenced in dead code keeps the deferred binding", async () => {
    // TS unused-import trimming would normally strip the `* as ns` binding
    // when the namespace is only referenced in a dead branch, leaving a bare
    // side-effect import. For `import defer` that is (a) syntactically
    // invalid (`import defer"./x"`) and (b) semantically wrong — it would
    // eagerly evaluate a module the user asked to defer. The binding must be
    // preserved; since nothing touches it at runtime, the module is linked
    // but never evaluated.
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import defer * as ns from "./dep.ts";
          if (false) { console.log(ns.value); }
          console.log("main");
        `,
        "dep.ts": `
          console.log("dep evaluated");
          export const value = 1;
        `,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["main"]);
    expect(exitCode).toBe(0);
  });

  describe("'defer' remains a valid identifier", () => {
    test("import defer from '...' (default binding)", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import defer from "./dep.js";
          console.log(defer);
        `,
        "dep.js": `
          console.log("dep evaluated");
          export default "hello";
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["dep evaluated", "hello"]);
      expect(exitCode).toBe(0);
    });

    test("import defer, { x } from '...'", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import defer, { x } from "./dep.js";
          console.log(defer, x);
        `,
        "dep.js": `
          console.log("dep evaluated");
          export default "D";
          export const x = "X";
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["dep evaluated", "D X"]);
      expect(exitCode).toBe(0);
    });

    test("import { defer } from '...'", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import { defer } from "./dep.js";
          console.log(defer);
        `,
        "dep.js": `export const defer = 123;`,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["123"]);
      expect(exitCode).toBe(0);
    });
  });

  test("transpiler preserves 'import defer' in output", async () => {
    const out = new Bun.Transpiler({ loader: "js" }).transformSync(`import defer * as ns from "./x";\nns.a;\n`);
    expect(out).toContain("import defer");
    expect(out).toContain("* as ns");
  });

  describe("syntax errors", () => {
    test("import defer { x } from '...' is a syntax error", async () => {
      const { exitCode, stderr } = await run({
        "main.js": `import defer { x } from "./dep.js";`,
        "dep.js": `export const x = 1;`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("import defer x from '...' is a syntax error", async () => {
      const { exitCode, stderr } = await run({
        "main.js": `import defer x from "./dep.js";`,
        "dep.js": `export default 1;`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("'defer' with an escape sequence is not the phase keyword", async () => {
      // `import def\u0065r *` must not be treated as `import defer *`; since
      // `import <DefaultBinding> *` is not valid grammar either, it is a
      // syntax error.
      const { exitCode, stderr } = await run({
        "main.js": `import def\\u0065r * as ns from "./dep.js"; console.log(ns);`,
        "dep.js": `export const x = 1;`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("import defer inside a TypeScript namespace is a syntax error", async () => {
      // ESM import declarations are only valid at module scope; a TypeScript
      // `namespace` block only permits `import x = ...`.
      const { exitCode, stderr } = await run(
        {
          "main.ts": `namespace X { import defer * as ns from "./dep.js"; }`,
          "dep.js": `export const x = 1;`,
        },
        "main.ts",
      );
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("'export import defer * as ns' is a syntax error", async () => {
      // `export import` in TypeScript is the import-equals form
      // (`export import X = ...`); `export import defer * as` matches no
      // grammar production in either language.
      const { exitCode, stderr } = await run(
        {
          "main.ts": `export import defer * as ns from "./dep.js"; console.log(ns);`,
          "dep.js": `export const x = 1;`,
        },
        "main.ts",
      );
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });
  });
});

// TC39 proposal-defer-import-eval (Stage 3) — dynamic `import.defer(...)`
// https://tc39.es/proposal-defer-import-eval/#sec-import-call-runtime-semantics-evaluation
describe.concurrent("dynamic import.defer()", () => {
  test("defers module evaluation until a property is accessed", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./dep.js");
        console.log("before access");
        console.log("value:", ns.value);
        console.log("add:", ns.add(1, 2));
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 42;
        export function add(a, b) { return a + b; }
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before access", "dep evaluated", "value: 42", "add: 3"]);
    expect(exitCode).toBe(0);
  });

  test("module is never evaluated if the namespace is never accessed", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        await import.defer("./dep.js");
        console.log("done");
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 1;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["done"]);
    expect(exitCode).toBe(0);
  });

  test("resolves to a 'Deferred Module' namespace", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./dep.js");
        console.log(ns[Symbol.toStringTag]);
        console.log("---");
        console.log(ns.value);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 7;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["Deferred Module", "---", "dep evaluated", "7"]);
    expect(exitCode).toBe(0);
  });

  test("returns the same namespace object as a static 'import defer'", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import defer * as stat from "./dep.js";
        const dyn = await import.defer("./dep.js");
        console.log("same:", dyn === stat);
        console.log("value:", dyn.value);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 3;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["same: true", "dep evaluated", "value: 3"]);
    expect(exitCode).toBe(0);
  });

  test("evaluation error surfaces at property access, not at import time", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./throws.js");
        console.log("imported ok");
        for (let i = 0; i < 2; i++) {
          try {
            void ns.value;
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", e.message);
          }
        }
      `,
      "throws.js": `
        throw new Error("boom");
        export const value = 1;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["imported ok", "caught: boom", "caught: boom"]);
    expect(exitCode).toBe(0);
  });

  test("rejects when the module cannot be resolved", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import.defer("./does-not-exist.js").then(
          () => console.log("unreachable"),
          () => console.log("rejected"),
        );
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["rejected"]);
    expect(exitCode).toBe(0);
  });

  test("evaluates async transitive dependencies eagerly, defers the rest", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./dep.js");
        console.log("main after import");
        console.log("value:", ns.value);
      `,
      "dep.js": `
        import { ready } from "./tla.js";
        console.log("dep evaluated");
        export const value = ready;
      `,
      "tla.js": `
        console.log("tla start");
        await Promise.resolve();
        console.log("tla done");
        export const ready = "ok";
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "tla start",
      "tla done",
      "main after import",
      "dep evaluated",
      "value: ok",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a deferred module that itself uses top-level await is evaluated during the import", async () => {
    // GatherAsynchronousTransitiveDependencies includes the root module when
    // it has top-level await, so it can never be left for (impossible)
    // synchronous evaluation later.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./tla.js");
        console.log("main after import");
        console.log("value:", ns.ready);
      `,
      "tla.js": `
        console.log("tla start");
        await Promise.resolve();
        console.log("tla done");
        export const ready = "ok";
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["tla start", "tla done", "main after import", "value: ok"]);
    expect(exitCode).toBe(0);
  });

  test("works with a runtime-computed specifier", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const parts = ["./dep", ".js"];
        const ns = await import.defer(parts.join(""));
        console.log("before access");
        console.log("value:", ns.value);
      `,
      "dep.js": `
        console.log("dep evaluated");
        export const value = 42;
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before access", "dep evaluated", "value: 42"]);
    expect(exitCode).toBe(0);
  });

  test("works from a CommonJS module", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          module.exports.loaded = true;
          (async () => {
            const ns = await import.defer("./dep.js");
            console.log("before access");
            console.log("value:", ns.value);
          })();
        `,
        "dep.js": `
          console.log("dep evaluated");
          export const value = 42;
        `,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before access", "dep evaluated", "value: 42"]);
    expect(exitCode).toBe(0);
  });

  test("importing a CommonJS module evaluates it at import time (host-defined)", async () => {
    // CommonJS modules are executed by the host while building their ESM
    // wrapper record, so there is nothing left to defer — the namespace is
    // usable but the module body has already run by the time the promise
    // resolves. Deferral only applies to ES module evaluation.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./dep.cjs");
        console.log("after import");
        console.log("value:", ns.default.value);
      `,
      "dep.cjs": `
        console.log("cjs evaluated");
        module.exports = { value: 7 };
      `,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["cjs evaluated", "after import", "value: 7"]);
    expect(exitCode).toBe(0);
  });

  test("import.defer() with import attributes", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const ns = await import.defer("./data.json", { with: { type: "json" } });
        console.log("loaded");
        console.log(ns.default.hello);
      `,
      "data.json": JSON.stringify({ hello: "world" }),
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["loaded", "world"]);
    expect(exitCode).toBe(0);
  });

  test("works in .ts files", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          const ns = await import.defer("./dep.ts");
          console.log("before access");
          console.log(ns.value);
        `,
        "dep.ts": `
          console.log("dep evaluated");
          export const value: number = 9;
        `,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["before access", "dep evaluated", "9"]);
    expect(exitCode).toBe(0);
  });

  test("Bun.Transpiler preserves import.defer() in output", () => {
    const out = new Bun.Transpiler({ loader: "js" }).transformSync(`const p = import.defer("./x");\n`);
    expect(out).toContain(`import.defer("./x")`);
  });

  test("Bun.Transpiler preserves import.defer() with a non-literal specifier", () => {
    const out = new Bun.Transpiler({ loader: "js" }).transformSync(
      `export function load(name) { return import.defer(name); }\n`,
    );
    expect(out).toContain("import.defer(name)");
  });

  test("Bun.Transpiler.scanImports reports import.defer() as a dynamic import", () => {
    const scanned = new Bun.Transpiler({ loader: "js" }).scanImports(`import.defer("./x");`);
    expect(scanned).toEqual([{ kind: "dynamic-import", path: "./x" }]);
  });

  describe("syntax errors", () => {
    test("'import.defer' without a call is a syntax error", async () => {
      const { exitCode, stderr } = await run({
        "main.js": `const x = import.defer; console.log(x);`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("'defer' with an escape sequence is not the phase keyword", async () => {
      const { exitCode, stderr } = await run({
        "main.js": `import.def\\u0065r("./dep.js");`,
        "dep.js": `export const x = 1;`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });

    test("other identifiers after 'import.' are still rejected", async () => {
      const { exitCode, stderr } = await run({
        "main.js": `import.source("./dep.js");`,
        "dep.js": `export const x = 1;`,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("error");
    });
  });
});
