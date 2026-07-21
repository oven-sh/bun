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

    test("import defer is not over-rejected by a bunfig [macros] remap on the specifier", async () => {
      // bunfig `[macros]` remapping is only consumed for default and
      // named bindings, never star bindings, so `import defer * as ns`
      // of a package with a `[macros]` entry must keep working.
      const { stdout, stderr, exitCode } = await run({
        "bunfig.toml": `[macros]\n"pkg" = { "debounce" = "./macro-impl.ts" }\n`,
        "macro-impl.ts": `export default () => "x";`,
        "node_modules/pkg/package.json": `{"name":"pkg","main":"index.js"}`,
        "node_modules/pkg/index.js": `exports.a = 1;`,
        "main.js": `
          import defer * as ns from "pkg";
          console.log("a:", ns.a);
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["a: 1"]);
      expect(exitCode).toBe(0);
    });

    test.each([
      ["with { type: 'macro' }", `import defer * as ns from "./m.js" with { type: "macro" };`],
      ["macro: prefix", `import defer * as ns from "macro:./m.js";`],
    ])("import defer combined with a macro import (%s) is an error", async (_label, code) => {
      // A macro import is a compile-time binding; there is no module
      // evaluation to defer. Reject with a clear error instead of
      // silently registering a namespace macro ref.
      const { stderr, exitCode } = await run({
        "main.js": code + `\nconsole.log(ns);`,
        "m.js": `export const x = 1;`,
      });
      expect(stderr).toContain('"import defer" cannot be combined with a macro import');
      expect(exitCode).not.toBe(0);
    });

    test("import defer from 'bun:bundle' is an error", async () => {
      // The `bun:bundle` fast path drops the statement before the phase is
      // consulted; reject rather than leave the namespace binding
      // undeclared.
      const { stderr, exitCode } = await run({
        "main.js": `
          import defer * as ns from "bun:bundle";
          console.log(ns);
        `,
      });
      expect(stderr).toContain('"import defer" cannot be used with "bun:bundle"');
      expect(exitCode).not.toBe(0);
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
