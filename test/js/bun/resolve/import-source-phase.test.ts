// TC39 proposal-source-phase-imports — static `import source x from "..."`
// and dynamic `import.source(...)`, which evaluate to the compiled
// `WebAssembly.Module` of a WebAssembly file without instantiating it.
// https://tc39.es/proposal-source-phase-imports/

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, type DirectoryTree } from "harness";

// (module
//   (func (export "add") (param i32 i32) (result i32)
//     local.get 0
//     local.get 1
//     i32.add))
const ADD_WASM = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, 0x03, 0x02,
  0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20,
  0x01, 0x6a, 0x0b,
]);

async function run(files: DirectoryTree, entry = "main.js", args: string[] = []) {
  using dir = tempDir("import-source-phase", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("import source (source phase imports)", () => {
  test("static import source evaluates to a WebAssembly.Module", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source addModule from "./add.wasm";
        console.log("instanceof:", addModule instanceof WebAssembly.Module);
        console.log("exports:", WebAssembly.Module.exports(addModule).map(e => e.name + ":" + e.kind).join(","));
        const instance = new WebAssembly.Instance(addModule);
        console.log("add:", instance.exports.add(2, 3));
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["instanceof: true", "exports: add:function", "add: 5"]);
    expect(exitCode).toBe(0);
  });

  test("dynamic import.source() resolves to a WebAssembly.Module", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const mod = await import.source("./add.wasm");
        console.log("instanceof:", mod instanceof WebAssembly.Module);
        console.log("add:", new WebAssembly.Instance(mod).exports.add(20, 22));
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["instanceof: true", "add: 42"]);
    expect(exitCode).toBe(0);
  });

  test("import.source() in a CommonJS file does not force ESM or strict mode", async () => {
    // Like plain `import()`, `import.source()` belongs to the ImportCall
    // production and is valid with the Script goal; only `import.meta`
    // requires Module. A CJS file using it must keep sloppy-mode semantics
    // (octal literals parse, top-level `this` is `module.exports`).
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          console.log("octal:", 010);
          console.log("this:", this === module.exports);
          module.exports.load = () => import.source("./add.wasm");
          module.exports.load().then(mod => {
            console.log("instanceof:", mod instanceof WebAssembly.Module);
          });
        `,
        "add.wasm": ADD_WASM,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["octal: 8", "this: true", "instanceof: true"]);
    expect(exitCode).toBe(0);
  });

  test("static and dynamic source imports of the same specifier are the same object", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source a from "./add.wasm";
        const b = await import.source("./add.wasm");
        console.log("same:", Object.is(a, b));
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["same: true"]);
    expect(exitCode).toBe(0);
  });

  test("source imports from different modules share one compiled module", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source a from "./add.wasm";
        import { mod as b } from "./other.js";
        console.log("same:", Object.is(a, b));
      `,
      "other.js": `
        import source mod from "./add.wasm";
        export { mod };
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["same: true"]);
    expect(exitCode).toBe(0);
  });

  test("source phase and evaluation phase of the same specifier coexist across files", async () => {
    // Bun's evaluation-phase `.wasm` import is the file loader (the default
    // export is the resolved path string); the source phase gets its own
    // module-map entry rather than reusing that one.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source mod from "./add.wasm";
        import { path } from "./other.js";
        console.log("source:", mod instanceof WebAssembly.Module);
        console.log("eval:", typeof path, path.endsWith("add.wasm"));
      `,
      "other.js": `
        import path from "./add.wasm";
        export { path };
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["source: true", "eval: string true"]);
    expect(exitCode).toBe(0);
  });

  test("static source phase import and dynamic evaluation-phase import() coexist in one file", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source mod from "./add.wasm";
        const ns = await import("./add.wasm");
        console.log("source:", mod instanceof WebAssembly.Module);
        console.log("eval:", typeof ns.default, ns.default.endsWith("add.wasm"));
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["source: true", "eval: string true"]);
    expect(exitCode).toBe(0);
  });

  // JSC dedups a module's requested modules by (specifier, phase) and
  // ignores import attributes, which the source phase lowering rides on —
  // whichever static statement came first would win and the other binding
  // would silently get the wrong value. Bun reports the conflict instead,
  // in either order, for imports as well as `export ... from` re-exports.
  test.each([
    [
      "import source then import",
      `import source mod from "./add.wasm";\nimport path from "./add.wasm";\nconsole.log(mod, path);`,
    ],
    [
      "import then import source",
      `import path from "./add.wasm";\nimport source mod from "./add.wasm";\nconsole.log(mod, path);`,
    ],
    [
      "import source then export from",
      `import source mod from "./add.wasm";\nexport { default as path } from "./add.wasm";\nconsole.log(mod);`,
    ],
    [
      "export from then import source",
      `export { default as path } from "./add.wasm";\nimport source mod from "./add.wasm";\nconsole.log(mod);`,
    ],
    [
      "import source then export star",
      `import source mod from "./add.wasm";\nexport * from "./add.wasm";\nconsole.log(mod);`,
    ],
    [
      "export star then import source",
      `export * from "./add.wasm";\nimport source mod from "./add.wasm";\nconsole.log(mod);`,
    ],
  ])("source and evaluation phase of one specifier in the same file is a parse error (%s)", async (_label, code) => {
    const { stderr, exitCode } = await run({
      "main.js": code,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toContain("at both source phase and evaluation phase");
    expect(exitCode).not.toBe(0);
  });

  test("import.source() with a non-literal specifier", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        const name = "./add" + ".wasm";
        const mod = await import.source(name);
        console.log("dyn:", mod instanceof WebAssembly.Module);
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["dyn: true"]);
    expect(exitCode).toBe(0);
  });

  test("import.source() of a blob: URL", async () => {
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import { readFileSync } from "node:fs";
        const bytes = readFileSync(new URL("./add.wasm", import.meta.url));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
        const mod = await import.source(url);
        console.log("blob:", mod instanceof WebAssembly.Module, new WebAssembly.Instance(mod).exports.add(1, 1));
      `,
      "add.wasm": ADD_WASM,
    });
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["blob: true 2"]);
    expect(exitCode).toBe(0);
  });

  test("works in TypeScript files", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import source addModule from "./add.wasm";
          const instance = new WebAssembly.Instance(addModule);
          console.log("ts:", (instance.exports.add as (a: number, b: number) => number)(40, 2));
        `,
        "add.wasm": ADD_WASM,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["ts: 42"]);
    expect(exitCode).toBe(0);
  });

  test("binding only referenced in dead code keeps the source phase", async () => {
    // TS unused-import trimming must not strip the binding from an
    // `import source` statement — the grammar requires exactly one binding,
    // and dropping it would downgrade the statement to a bare
    // evaluation-phase import (the file loader), silently losing the phase.
    //
    // Use a file that is not valid WebAssembly to make the phase observable:
    // the module source is still requested even though the binding is never
    // read, so loading must fail. If the binding were stripped, the file
    // loader would accept the file and print "main".
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import source mod from "./fake.wasm";
          if (false) { console.log(mod); }
          console.log("main");
        `,
        "fake.wasm": `not wasm at all`,
      },
      "main.ts",
    );
    expect(stdout).not.toContain("main");
    expect(stderr).toContain("only WebAssembly modules have a module source");
    expect(exitCode).not.toBe(0);
  });

  test("unused source phase binding still loads and compiles valid wasm", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import source mod from "./add.wasm";
          if (false) { console.log(mod); }
          console.log("main");
        `,
        "add.wasm": ADD_WASM,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["main"]);
    expect(exitCode).toBe(0);
  });

  test("a completely unreferenced binding keeps the source phase in JavaScript", async () => {
    // JavaScript imports always execute; even with zero references to the
    // binding the module source is still requested, so an invalid file
    // fails to load.
    const { stdout, stderr, exitCode } = await run({
      "main.js": `
        import source mod from "./fake.wasm";
        console.log("main");
      `,
      "fake.wasm": `not wasm at all`,
    });
    expect(stdout).not.toContain("main");
    expect(stderr).toContain("only WebAssembly modules have a module source");
    expect(exitCode).not.toBe(0);
  });

  test("a completely unreferenced binding is elided in TypeScript, like tsc", async () => {
    // TypeScript treats an import whose bindings have no syntactic
    // references as type-only and elides the whole statement — the same
    // behavior tsc and esbuild apply to plain imports, and the same
    // behavior Bun applies to `import defer`. The wasm is never fetched,
    // so even an invalid file loads fine. `verbatimModuleSyntax` preserves
    // such imports.
    const { stdout, stderr, exitCode } = await run(
      {
        "main.ts": `
          import source mod from "./fake.wasm";
          console.log("main");
        `,
        "fake.wasm": `not wasm at all`,
      },
      "main.ts",
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean)).toEqual(["main"]);
    expect(exitCode).toBe(0);
  });

  describe("errors", () => {
    test("source phase import of a JavaScript module is an error", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source dep from "./dep.js";
          console.log("unreachable", dep);
        `,
        "dep.js": `export default 1;`,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain("only WebAssembly modules have a module source");
      expect(exitCode).not.toBe(0);
    });

    test("dynamic import.source() of a JavaScript module rejects", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          try {
            await import.source("./dep.js");
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", String(e.message).includes("only WebAssembly modules have a module source"));
          }
        `,
        "dep.js": `export default 1;`,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: true"]);
      expect(exitCode).toBe(0);
    });

    test.each(["bun", "node:fs", "bun:sqlite"])(
      "static source phase import of the builtin %j is an error",
      async spec => {
        // The printer's `Tag::Bun` fast path rewrites `import x from "bun"`
        // to `var x = globalThis.Bun` and never touches the module loader;
        // it must not fire for a source-phase request.
        const { stdout, stderr, exitCode } = await run({
          "main.js": `
            import source mod from "${spec}";
            console.log("unreachable", typeof mod);
          `,
        });
        expect(stdout).not.toContain("unreachable");
        expect(stderr).toContain("only WebAssembly modules have a module source");
        expect(stderr).toContain(JSON.stringify(spec));
        expect(exitCode).not.toBe(0);
      },
    );

    test.each([
      ["literal", `import.source("bun")`],
      ["non-literal", `import.source(["bun"].join(""))`],
      ["node builtin", `import.source("node:fs")`],
    ])("dynamic import.source() of a builtin (%s) rejects", async (_name, expr) => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          try {
            await ${expr};
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", String(e.message).includes("only WebAssembly modules have a module source"));
          }
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: true"]);
      expect(exitCode).toBe(0);
    });

    test("source phase import of a Bun.plugin build.module() virtual module is an error", async () => {
      // The runVirtualModule path in fetchESMSourceCode returns via
      // handleVirtualModuleResult, whose loader whitelist cannot produce
      // wasm bytes, so it must reject rather than silently bind the
      // mock's default export. Evaluation-phase import of the same
      // specifier must keep working.
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import { plugin } from "bun";
          await plugin({
            name: "virt",
            setup(build) {
              build.module("virtual-wasm", () => ({ loader: "object", exports: { default: 99 } }));
            },
          });
          try {
            await import.source("virtual-wasm");
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", String(e.message).includes("only WebAssembly modules have a module source"));
          }
          console.log("eval:", (await import("virtual-wasm")).default);
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: true", "eval: 99"]);
      expect(exitCode).toBe(0);
    });

    test("source phase import of a mock.module() registration is an error", async () => {
      // The isBunTest branch of fetchESMSourceCode runs virtual modules
      // before the builtin check; it must also reject source-phase
      // requests instead of binding the mock's default export.
      const { stdout, stderr, exitCode } = await run(
        {
          "mock.test.js": `
            import { test, expect, mock } from "bun:test";
            import path from "node:path";
            test("rejects", async () => {
              const spec = path.join(import.meta.dir, "fake.wasm");
              mock.module(spec, () => ({ default: 42 }));
              let err;
              try {
                await import.source(spec);
              } catch (e) {
                err = e;
              }
              expect(String(err?.message ?? "")).toContain("only WebAssembly modules have a module source");
              // Evaluation-phase import of the mocked specifier keeps working.
              expect((await import(spec)).default).toBe(42);
            });
          `,
        },
        "mock.test.js",
        ["test"],
      );
      expect({ stdout, stderr }).toEqual({
        stdout: expect.not.stringContaining("(fail)"),
        stderr: expect.stringContaining(" 1 pass"),
      });
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });

    test("a file without the wasm magic is rejected even with a .wasm extension", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source mod from "./fake.wasm";
          console.log("unreachable", mod);
        `,
        "fake.wasm": `not wasm at all`,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain("only WebAssembly modules have a module source");
      expect(exitCode).not.toBe(0);
    });

    test("invalid wasm rejects with WebAssembly.CompileError", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          try {
            await import.source("./corrupt.wasm");
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", e instanceof WebAssembly.CompileError);
          }
        `,
        // Valid magic + version, truncated garbage section.
        "corrupt.wasm": Buffer.concat([
          Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
          Buffer.from("garbage"),
        ]),
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: true"]);
      expect(exitCode).toBe(0);
    });

    test("import.source() of a missing file rejects", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          try {
            await import.source("./missing.wasm");
            console.log("unreachable");
          } catch (e) {
            console.log("caught:", e.code ?? e.constructor.name);
          }
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["caught: ERR_MODULE_NOT_FOUND"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("'source' remains a valid identifier", () => {
    test("import source from '...' (default binding named source)", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source from "./dep.js";
          console.log(source);
        `,
        "dep.js": `export default "default-export";`,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["default-export"]);
      expect(exitCode).toBe(0);
    });

    test("import source from from '...' (source phase binding named from)", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source from from "./add.wasm";
          console.log("from:", from instanceof WebAssembly.Module);
        `,
        "add.wasm": ADD_WASM,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["from: true"]);
      expect(exitCode).toBe(0);
    });

    test("import source, { x } from '...'", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source, { x } from "./dep.js";
          console.log(source, x);
        `,
        "dep.js": `
          export default "D";
          export const x = "X";
        `,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["D X"]);
      expect(exitCode).toBe(0);
    });

    test("import { source } from '...' and import * as source from '...'", async () => {
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import { source } from "./dep.js";
          import * as source2 from "./dep.js";
          console.log(source, source2.source);
        `,
        "dep.js": `export const source = 123;`,
      });
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(Boolean)).toEqual(["123 123"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("transpiler output", () => {
    test("preserves 'import source' and 'import.source' for non-Bun targets", async () => {
      const out = new Bun.Transpiler({ loader: "js" }).transformSync(
        `import source mod from "./x.wasm";\nmod;\nawait import.source("./y.wasm");\n`,
      );
      expect(out).toContain("import source mod from");
      expect(out).toContain("import.source(");
    });

    test("lowers the source phase onto import attributes for the Bun target", async () => {
      const out = new Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(
        `import source mod from "./x.wasm";\nmod;\nawait import.source("./y.wasm");\n`,
      );
      expect(out).toContain(`import mod from "./x.wasm" with { type: "webassembly" }`);
      expect(out).toContain(`import("./y.wasm",{with:{type:"webassembly"}}).then((m)=>m.default)`);
    });
  });

  describe("syntax errors", () => {
    test.each([
      ["import source { x } from './a.wasm'", `import source { x } from "./add.wasm";`],
      ["import source * as ns from './a.wasm'", `import source * as ns from "./add.wasm";`],
      ["import source x, { y } from './a.wasm'", `import source x, { y } from "./add.wasm";`],
      ["'source' with an escape sequence is not the phase keyword", `import sourc\\u0065 x from "./add.wasm";`],
      ["import.source without a call", `import.source;`],
      ["import.source with a second argument", `await import.source("./add.wasm", { with: { type: "webassembly" } });`],
      ["import.sourc\\u0065() is not the phase keyword", `await import.sourc\\u0065("./add.wasm");`],
    ])("%s is a syntax error", async (_label, code) => {
      const { exitCode, stderr } = await run({
        "main.js": code,
        "add.wasm": ADD_WASM,
      });
      expect(stderr.toLowerCase()).toContain("error");
      expect(exitCode).not.toBe(0);
    });

    test.each([
      ["with { type: 'macro' }", `import source mod from "./m.js" with { type: "macro" };`],
      ["macro: prefix", `import source mod from "macro:./m.js";`],
    ])("import source combined with a macro import (%s) is an error", async (_label, code) => {
      // The macro fast path in process_import_statement fires before the
      // phase is recorded, so without this guard the binding would be
      // registered as a macro ref and the source phase silently dropped.
      const { stdout, stderr, exitCode } = await run({
        "main.js": code + `\nconsole.log("unreachable", mod());`,
        "m.js": `export default () => "macro-output";`,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain('"import source" cannot be combined with a macro import');
      expect(exitCode).not.toBe(0);
    });

    test("import source from 'bun:bundle' is an error", async () => {
      // The `bun:bundle` fast path in process_import_statement drops the
      // statement to S::Empty before the phase is consulted; it must
      // reject rather than leave the source-phase binding undeclared.
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source mod from "bun:bundle";
          console.log("unreachable", mod);
        `,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain('"import source" cannot be used with "bun:bundle"');
      expect(exitCode).not.toBe(0);
    });

    test("import source of a specifier remapped via bunfig [macros] is an error", async () => {
      // The third macro trigger: bunfig `[macros]` per-specifier remapping
      // is read by process_import_statement after the `with { type:
      // "macro" }` / `macro:` prefix guard; it must also be rejected
      // instead of registering the default binding as a macro ref.
      const { stdout, stderr, exitCode } = await run({
        "bunfig.toml": `[macros]\n"some-pkg" = { "default" = "./macro-impl.ts" }\n`,
        "macro-impl.ts": `export default () => "remap-output";`,
        "node_modules/some-pkg/package.json": `{"name":"some-pkg","main":"index.js"}`,
        "node_modules/some-pkg/index.js": `module.exports.default = 1;`,
        "main.js": `
          import source mod from "some-pkg";
          console.log("unreachable", mod());
        `,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain('"import source" cannot be combined with a macro import');
      expect(exitCode).not.toBe(0);
    });

    test.each([
      ["macro-first", `import { fn } from "./m.js" with { type: "macro" };\nimport source mod from "./m.js";`],
      ["source-first", `import source mod from "./m.js";\nimport { fn } from "./m.js" with { type: "macro" };`],
    ])("a macro import of the same specifier (%s) is not a phase conflict with import source", async (_label, code) => {
      // Macro-import records are compile-time only (the statement becomes
      // S::Empty and the record is flagged IS_UNUSED / Macro::NAMESPACE),
      // so they never reach JSC's requested-modules list and cannot
      // collide with the source-phase request. check_source_phase_conflict
      // must skip them; the result is order-independent.
      const { stdout, stderr, exitCode } = await run({
        "main.js": code + `\nconsole.log("unreachable", fn(), typeof mod);`,
        "m.js": `export const fn = () => "macro-output"; export default 1;`,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).not.toContain("both source phase and evaluation phase");
      expect(stderr).toContain("only WebAssembly modules have a module source");
      expect(exitCode).not.toBe(0);
    });

    test.each([
      ["source-first", `import source mod from "pkg";\nimport { foo } from "pkg";`],
      ["named-first", `import { foo } from "pkg";\nimport source mod from "pkg";`],
    ])(
      "a fully bunfig-remapped named import of the same specifier (%s) is not a phase conflict",
      async (_label, code) => {
        // `import { foo } from "pkg"` with `[macros].pkg.foo` is fully
        // remapped: every item becomes a macro ref and the statement drops
        // to S::Empty (the record becomes Macro::NAMESPACE / IS_UNUSED),
        // so it never reaches JSC. check_source_phase_conflict runs only
        // after the remap early-return, so it doesn't match this record
        // against the source-phase request; both statement orders give
        // the same result.
        const { stdout, stderr, exitCode } = await run({
          "bunfig.toml": `[macros]\n"pkg" = { "foo" = "./macro-impl.ts" }\n`,
          "macro-impl.ts": `export const foo = () => "macro-output";`,
          "node_modules/pkg/package.json": `{"name":"pkg","main":"index.js"}`,
          "node_modules/pkg/index.js": `exports.foo = () => {};`,
          "main.js": code + `\nconsole.log("unreachable", mod, foo());`,
        });
        expect(stdout).not.toContain("unreachable");
        expect(stderr).not.toContain("both source phase and evaluation phase");
        expect(stderr).toContain("only WebAssembly modules have a module source");
        expect(exitCode).not.toBe(0);
      },
    );

    test("import source is not over-rejected by a bunfig [macros] remap lacking a default key", async () => {
      // A `[macros]` entry that only maps named exports doesn't touch the
      // default binding, so `import source` must proceed to the normal
      // source-phase path (which then rejects the resolved .js file with
      // the wasm error) rather than the macro-import error.
      const { stdout, stderr, exitCode } = await run({
        "bunfig.toml": `[macros]\n"pkg" = { "debounce" = "./macro-impl.ts" }\n`,
        "macro-impl.ts": `export default () => "x";`,
        "node_modules/pkg/package.json": `{"name":"pkg","main":"index.js"}`,
        "node_modules/pkg/index.js": `exports.debounce = () => {};`,
        "main.js": `
          import source mod from "pkg";
          console.log("unreachable", mod);
        `,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).not.toContain("cannot be combined with a macro import");
      expect(stderr).toContain("only WebAssembly modules have a module source");
      expect(exitCode).not.toBe(0);
    });

    test("import source with a non-macro type attribute still errors on non-wasm content", async () => {
      // Static `import source` with `with { type: "json" }` overrides the
      // user attribute with `type: "webassembly"` (the source-phase
      // lowering), so the module loader reads the file as wasm and
      // rejects it with the same error as any non-wasm file. Dynamic
      // `import.source(spec, opts)` rejects the second argument at parse
      // time instead; this pins the static form's behavior.
      const { stdout, stderr, exitCode } = await run({
        "main.js": `
          import source mod from "./data.json" with { type: "json" };
          console.log("unreachable", mod);
        `,
        "data.json": `{"a":1}`,
      });
      expect(stdout).not.toContain("unreachable");
      expect(stderr).toContain("only WebAssembly modules have a module source");
      expect(exitCode).not.toBe(0);
    });

    test("import source inside a TypeScript namespace is a syntax error", async () => {
      const { exitCode, stderr } = await run(
        {
          "main.ts": `namespace X { import source mod from "./add.wasm"; }`,
          "add.wasm": ADD_WASM,
        },
        "main.ts",
      );
      expect(stderr.toLowerCase()).toContain("error");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("bundler", () => {
    test("'bun build' rejects import source with a clear error", async () => {
      const { stderr, exitCode } = await run(
        {
          "main.js": `import source mod from "./add.wasm"; console.log(mod);`,
          "add.wasm": ADD_WASM,
        },
        "main.js",
        ["build"],
      );
      expect(stderr).toContain(`"import source" is not supported when bundling`);
      expect(exitCode).not.toBe(0);
    });

    test("'bun build' rejects import.source() with a clear error", async () => {
      const { stderr, exitCode } = await run(
        {
          "main.js": `const m = await import.source("./add.wasm");`,
          "add.wasm": ADD_WASM,
        },
        "main.js",
        ["build"],
      );
      expect(stderr).toContain(`"import.source" is not supported when bundling`);
      expect(exitCode).not.toBe(0);
    });
  });
});
