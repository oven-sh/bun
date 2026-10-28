import { parse } from "acorn";
import type { BuildOutput } from "bun";
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import path from "path";
import { type BundlerTestInput, expectBundled, largestCheckedOutput } from "./expectBundled";
import { findUndeclaredGeneratedNames } from "./outputCheck";

describe("findUndeclaredGeneratedNames", () => {
  const undeclared = (code: string, sourceType: "module" | "script" = "script") => [
    ...findUndeclaredGeneratedNames(code, sourceType).keys(),
  ];

  test("reports every generated shape once, with the offset of its first use", () => {
    const code =
      "exports_a; export_b; module_c; require_d;\ninit_e; import_f; $g; __h; i_default; j_default2; exports_a;";
    expect([...findUndeclaredGeneratedNames(code, "script")]).toEqual([
      ["exports_a", 0],
      ["export_b", 11],
      ["module_c", 21],
      ["require_d", 31],
      ["init_e", 42],
      ["import_f", 50],
      ["$g", 60],
      ["__h", 64],
      ["i_default", 69],
      ["j_default2", 80],
    ]);
  });

  test("ignores a name of another shape", () => {
    expect(
      undeclared("exports; module; require; init; importFoo; exportsFoo; $; _; _a; a_defaults; a_default_b;"),
    ).toEqual([]);
  });

  test.each([
    ["a var in a nested block", "{ var exports_lib; } exports_lib;"],
    ["a function", "function init_lib() {} init_lib();"],
    ["a function in a block of sloppy-mode code", "{ function init_lib() {} } init_lib();"],
    ["a class", "class $lib {} new $lib();"],
    [
      "an import",
      `import import_a, * as import_b from "a"; import { c as import_c } from "c"; import_a, import_b, import_c;`,
    ],
    [
      "a parameter",
      "function f(exports_lib, { a: module_lib }, [init_lib = 1], ...$rest) { exports_lib, module_lib, init_lib, $rest; }",
    ],
    ["an arrow parameter", "(exports_lib => exports_lib)();"],
    ["a catch parameter", "try {} catch (exports_lib) { exports_lib; }"],
    ["a pattern", "var { a: exports_lib, ...module_lib } = {}, [init_lib] = []; exports_lib, module_lib, init_lib;"],
    ["the name of a function expression", "(function init_lib() { init_lib; });"],
    ["a loop binding", "for (const exports_lib of []) exports_lib;"],
    [
      "an exported declaration",
      "export var exports_lib = 1; export function init_lib() {} export default class $lib {} exports_lib, init_lib, $lib;",
    ],
    ["an outer scope", "var exports_lib; function f() { return () => { { exports_lib; } }; }"],
  ])("%s declares the name", (_, code) => {
    expect(undeclared(code)).toEqual([]);
  });

  // The check does not follow the order in which statements run. Both of these throw a TypeError.
  test.each([
    ["a var", "exports_lib.x = 1; var exports_lib = {};"],
    ["a let", "exports_lib.x = 1; let exports_lib = {};"],
  ])("%s after the use still declares the name", (_, code) => {
    expect(undeclared(code)).toEqual([]);
  });

  test.each([
    ["a let in a block", "{ let exports_lib; } exports_lib;"],
    ["a var in a function", "function f() { var exports_lib; } exports_lib;"],
    ["a var in a static block", "class A { static { var exports_lib; } } exports_lib;"],
    ["the name of a function expression", "(function exports_lib() {}); exports_lib;"],
    ["the name of a class expression", "(class exports_lib {}); exports_lib;"],
    ["a catch parameter", "try {} catch (exports_lib) {} exports_lib;"],
    ["a loop binding", "for (let exports_lib of []); exports_lib;"],
    ["the imported name of a specifier", `import { exports_lib as lib } from "lib"; exports_lib;`],
  ])("%s does not declare the name outside", (_, code) => {
    expect(undeclared(code)).toEqual(["exports_lib"]);
  });

  test.each([
    ["a read", "exports_lib.x;"],
    ["a write", "exports_lib = 1;"],
    ["typeof", "typeof exports_lib;"],
    ["a shorthand property", "({ exports_lib });"],
    ["a computed member", "x[exports_lib];"],
    ["a computed key", "({ [exports_lib]: 1 });"],
    ["a template literal", "`${exports_lib}`;"],
    ["a spread", "f(...exports_lib);"],
    ["a default value", "function f(a = exports_lib) {}"],
    ["a class field", "class A { x = exports_lib; }"],
    ["a superclass", "class A extends exports_lib {}"],
    ["a default export", "export default exports_lib;"],
  ])("%s is a use", (_, code) => {
    expect(undeclared(code)).toEqual(["exports_lib"]);
  });

  test.each([
    ["a member name", "x.exports_lib; x?.module_lib;"],
    ["a property key", "({ exports_lib: 1, module_lib() {}, get init_lib() { return 1; } });"],
    ["a class member name", "class A { exports_lib = 1; static module_lib() {} }"],
    ["a string, a template or a regular expression", "'exports_lib'; `module_lib`; /init_lib/;"],
    ["a comment", "// exports_lib\n/* module_lib */"],
    ["a label", "exports_lib: for (;;) break exports_lib;"],
    ["the exported name of a specifier", "var x; export { x as exports_lib };"],
    ["a re-export", `export * as exports_lib from "lib"; export { module_lib } from "lib";`],
    ["a meta property", "import.meta.exports_lib;"],
    ["a name in the body of a with statement", "with (x) exports_lib;"],
  ])("%s is not a use", (_, code) => {
    expect(undeclared(code)).toEqual([]);
  });

  test.each([
    ["a script: sloppy-mode code", "script", "var arguments; delete x; with (x) {} exports_lib;"],
    ["a script: a hashbang", "script", "#!/usr/bin/env bun\nexports_lib;"],
    ["a script: a return at the top level, as in a CommonJS file", "script", "if (x) return; exports_lib;"],
    ["a script: the module syntax of a file that is not bundled", "script", "import.meta.url; export {}; exports_lib;"],
    ["a module: an await at the top level", "module", "await exports_lib;"],
    ["a module: import defer, which is stage 3", "module", `import defer * as ns from "x"; ns; exports_lib;`],
    ["a module: import defer without spaces", "module", `import defer*as ns from"x";exports_lib;`],
    ["a module: a default import with the name defer", "module", `import defer, * as ns from "x"; defer; exports_lib;`],
  ] as const)("parses %s", (_, sourceType, code) => {
    expect(undeclared(code, sourceType)).toEqual(["exports_lib"]);
  });

  test.each([
    ["text that is not JavaScript", "script", ".exports_lib { color: red }", "Unexpected token (1:0)", 0],
    ["a name that is declared twice", "script", "var a; let a;", "Identifier 'a' has already been declared (1:11)", 11],
    ["an await at the top level of a script", "script", "await x;", "Unexpected token (1:6)", 6],
    ["sloppy-mode code in a module", "module", "with (x) {}", "'with' in strict mode (1:0)", 0],
    ["a return at the top level of a module", "module", "if (x) return;", "'return' outside of function (1:7)", 7],
    [
      "an export in a block of a module",
      "module",
      "var x; { export { x }; }",
      "'import' and 'export' may only appear at the top level (1:9)",
      9,
    ],
    [
      "a module that exports a name nothing declares",
      "module",
      "export { exports_lib };",
      "Export 'exports_lib' is not defined (1:9)",
      9,
    ],
  ] as const)("throws a SyntaxError with a position for %s", (_, sourceType, code, message, pos) => {
    let error: any;
    try {
      findUndeclaredGeneratedNames(code, sourceType);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SyntaxError);
    expect({ message: error.message, pos: error.pos }).toEqual({ message, pos });
  });
});

describe("the output check of expectBundled", () => {
  const failed = 'Output check failed, see "Output check" in test/bundler/expectBundled.md:\n';
  const files = { "/a.js": `console.log("a_exports_lib", "exports_library");`, "/b.js": `console.log("b");` };
  const bundle = (id: string, options: BundlerTestInput) => expectBundled(id, options, false, true);
  // Stands in for a bundler with a bug: puts `code` in place of an output, after the build and before the check.
  const write = (file: string, code: string) => (build: BuildOutput) => {
    writeFileSync(build.outputs.find(output => output.path.endsWith(file))!.path, code);
  };
  const fault = "var a;\nexports_lib.x = typeof __lib;\n";
  const names = (file: string) =>
    `  ${file}:2:1: nothing declares the generated name \`exports_lib\`\n    exports_lib.x = typeof __lib;\n` +
    `  ${file}:2:24: nothing declares the generated name \`__lib\`\n    exports_lib.x = typeof __lib;`;

  test("fails an output that uses a generated name nothing declares", async () => {
    const options = { files, onAfterApiBundle: write("out.js", fault) };
    await expect(bundle("outputCheck/UndeclaredNames", options)).rejects.toThrow(failed + names("/out.js"));
  });

  test.each(["/out.mjs", "/out.cjs"])("reads an outfile named %s", async outfile => {
    const options = { files, outfile, onAfterApiBundle: write(outfile.slice(1), fault) };
    await expect(bundle(`outputCheck/Outfile${outfile.slice(-3)}`, options)).rejects.toThrow(failed + names(outfile));
  });

  test("reads every JS file of an outdir, and no directory with such a name", async () => {
    const options = {
      files: { ...files, "/vendor/chart.js/index.js": `console.log("chart");` },
      entryPoints: ["/a.js", "/b.js", "/vendor/chart.js/index.js"],
      outputPaths: ["/out/a.js", "/out/b.js", "/out/vendor/chart.js/index.js"],
      onAfterApiBundle(build: BuildOutput) {
        write("b.js", fault)(build);
        write(path.join("chart.js", "index.js"), fault)(build);
      },
    };
    await expect(bundle("outputCheck/Outdir", options)).rejects.toThrow(
      failed + names("/out/b.js") + "\n" + names("/out/vendor/chart.js/index.js"),
    );
  });

  test("reads an output of the largest size that it reads, and no larger one", async () => {
    const sized = (length: number) => `${fault}/*${Buffer.alloc(length - fault.length - 4, "*").toString()}*/`;
    const largest = { files, onAfterApiBundle: write("out.js", sized(largestCheckedOutput)) };
    await expect(bundle("outputCheck/LargestOutput", largest)).rejects.toThrow(failed + names("/out.js"));
    // An entry can be for the output that was not read, so it does not count as one that excuses nothing.
    const tooLarge = {
      files,
      allowUndeclaredGeneratedNames: ["init_lib"],
      onAfterApiBundle: write("out.js", sized(largestCheckedOutput + 1)),
    };
    expect(await bundle("outputCheck/TooLargeOutput", tooLarge)).toMatchObject({ id: "outputCheck/TooLargeOutput" });
  });

  test("reads an output that takes the place of an input file, and no input file that the build left alone", async () => {
    const inputs = { "/entry.js": `console.log("entry");`, "/notes.js": "These are notes, not JavaScript." };
    const inPlace = (id: string, code: string) =>
      bundle(id, { files: inputs, outdir: "/", onAfterApiBundle: write("entry.js", code) });
    expect(await inPlace("outputCheck/InputInOutdir", "var a;\n")).toMatchObject({ id: "outputCheck/InputInOutdir" });
    await expect(inPlace("outputCheck/OutputOverInput", fault)).rejects.toThrow(failed + names("/entry.js"));
  });

  test("does not read the packages of the fixture when the outdir holds them", async () => {
    const options = {
      files: {
        "/entry.js": `console.log("entry");`,
        "/node_modules/pkg/index.js": Buffer.from("A package, not JavaScript."),
      },
      outdir: "/",
    };
    expect(await bundle("outputCheck/PackagesInOutdir", options)).toMatchObject({ id: "outputCheck/PackagesInOutdir" });
  });

  test("allowUndeclaredGeneratedNames excuses the names it lists, and fails on an entry that excuses nothing", async () => {
    const allow = (id: string, allowUndeclaredGeneratedNames: string[], backend?: "cli") =>
      bundle(id, { files, backend, allowUndeclaredGeneratedNames, onAfterApiBundle: write("out.js", fault) });
    const stale = (name: string) =>
      `  allowUndeclaredGeneratedNames: no output uses \`${name}\` without a declaration. Remove the entry and its comment.`;

    await expect(allow("outputCheck/AllowOne", ["exports_lib"])).rejects.toThrow(
      failed + "  /out.js:2:24: nothing declares the generated name `__lib`\n    exports_lib.x = typeof __lib;",
    );
    expect(await allow("outputCheck/AllowBoth", ["exports_lib", "__lib"])).toMatchObject({
      id: "outputCheck/AllowBoth",
    });
    await expect(allow("outputCheck/AllowStale", ["exports_lib", "init_lib", "__lib"])).rejects.toThrow(
      failed + stale("init_lib"),
    );
    // The cli backend has no hook between the build and the check, so its output is the bundler's own.
    await expect(allow("outputCheck/AllowStaleCli", ["exports_lib"], "cli")).rejects.toThrow(
      failed + stale("exports_lib"),
    );
  });

  test.each([
    ["a file", { files: { "/entry.js": `console.log(typeof exports_lib);` } }],
    [
      "a file that is a typed array",
      { files: { "/entry.js": new Uint8ClampedArray(Buffer.from(`console.log(typeof exports_lib);`)) } },
    ],
    [
      "the source of a plugin",
      {
        files: { "/entry.js": `import "virtual";` },
        plugins(builder) {
          builder.onResolve({ filter: /^virtual$/ }, () => ({ path: "virtual", namespace: "virtual" }));
          builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: `console.log(typeof exports_lib);`,
          }));
        },
      },
    ],
    ["the banner", { files: { "/entry.js": `console.log("entry");` }, banner: "var banner = typeof exports_lib;" }],
    ["the footer", { files: { "/entry.js": `console.log("entry");` }, footer: "var footer = typeof exports_lib;" }],
    ["a define", { files: { "/entry.js": `console.log(typeof DEFINED);` }, define: { DEFINED: "exports_lib" } }],
    [
      "the JSX factory",
      { files: { "/entry.jsx": `console.log(<a />);` }, jsx: { runtime: "classic", factory: "exports_lib" } },
    ],
  ] as [string, BundlerTestInput][])(
    "leaves alone a name that %s of the fixture spells out",
    async (channel, options) => {
      const id = `outputCheck/OwnText/${channel.split(" ").at(-1)}`;
      let output = "";
      expect(
        await bundle(id, { ...options, onAfterBundle: api => void (output = api.readFile("/out.js")) }),
      ).toMatchObject({ id });
      expect(findUndeclaredGeneratedNames(output, "module")).toEqual(
        new Map([["exports_lib", output.indexOf("exports_lib")]]),
      );
    },
  );

  test("fails an output that does not parse, unless allowOutputSyntaxError is set", async () => {
    const broken = (id: string, code: string, allowOutputSyntaxError?: true) =>
      bundle(id, { files, allowOutputSyntaxError, onAfterApiBundle: write("out.js", code) });

    await expect(broken("outputCheck/SyntaxError", "var a;\n  var b = ;\n")).rejects.toThrow(
      failed + "  /out.js:2:11: SyntaxError: Unexpected token\n    var b = ;",
    );
    expect(await broken("outputCheck/AllowSyntaxError", "var a;\n  var b = ;\n", true)).toMatchObject({
      id: "outputCheck/AllowSyntaxError",
    });
    await expect(broken("outputCheck/AllowSyntaxErrorStale", "var a;\n", true)).rejects.toThrow(
      failed + "  allowOutputSyntaxError: every JS output parses. Remove the option.",
    );
  });

  test("reads an esm output as a module, and any other format as a script", async () => {
    const returns = (format: "esm" | "cjs" | "iife") =>
      bundle(`outputCheck/Return/${format}`, {
        files,
        format,
        onAfterApiBundle: write("out.js", "if (a) return;\nvar a;\n"),
      });

    await expect(returns("esm")).rejects.toThrow(
      failed + "  /out.js:1:8: SyntaxError: 'return' outside of function\n    if (a) return;",
    );
    expect(await returns("cjs")).toMatchObject({ id: "outputCheck/Return/cjs" });
    expect(await returns("iife")).toMatchObject({ id: "outputCheck/Return/iife" });
  });

  test("reads the import defer that Bun prints for an external module", async () => {
    const options: BundlerTestInput = {
      files: { "/entry.js": `import defer * as ns from "external"; console.log(ns);` },
      external: ["external"],
      onAfterBundle: api => api.expectFile("/out.js").toContain(`import defer * as ns from "external";`),
    };
    expect(await bundle("outputCheck/ImportDefer", options)).toMatchObject({ id: "outputCheck/ImportDefer" });
    const faulty = { ...options, onAfterApiBundle: write("out.js", `import defer * as ns from "external";\n${fault}`) };
    await expect(bundle("outputCheck/ImportDeferFault", faulty)).rejects.toThrow(
      failed +
        "  /out.js:3:1: nothing declares the generated name `exports_lib`\n    exports_lib.x = typeof __lib;\n" +
        "  /out.js:3:24: nothing declares the generated name `__lib`\n    exports_lib.x = typeof __lib;",
    );
  });

  test("does not read the output of an entry point that is a stylesheet", async () => {
    const options: BundlerTestInput = {
      files: { "/entry.css": `.exports_lib { color: red }` },
      onAfterBundle: api => api.expectFile("/out.js").toContain(".exports_lib {"),
    };
    expect(await bundle("outputCheck/Stylesheet", options)).toMatchObject({ id: "outputCheck/Stylesheet" });
  });

  // Ties the shapes that the check knows to the names that the bundler prints.
  test("knows every name that the bundler declares for a symbol of its own", async () => {
    const project = {
      "/entry.js": `
        import one from "./lib.js";
        import two from "./sub/lib.js";
        import * as ns from "./ns.js";
        import { x } from "./unwrapped.js";
        import { y } from "./wrapped.js";
        const cjs = require("./cjs.js");
        const lazy = () => require("./esm.js");
        const dynamic = () => import("./dynamic.js");
        console.log(one, two, ns, x, y, cjs, lazy, dynamic);
        export { foo } from "./reexported.js";
      `,
      "/lib.js": `export default 1;`,
      "/sub/lib.js": `export default 2;`,
      "/ns.js": `export const a = 1;`,
      "/unwrapped.js": `exports.x = 1;`,
      "/wrapped.js": `exports.y = 1; eval("1");`,
      "/cjs.js": `module.exports = { c: 1 }; if (Math.random() > 2) module.exports = 3;`,
      "/esm.js": `export const z = 1;`,
      "/dynamic.js": `export const w = 1; console.log("dynamic");`,
      "/reexported.js": `module.exports = { foo: 1 }; if (Math.random() > 2) module.exports = 3;`,
    };
    let output = "";
    await bundle("outputCheck/GeneratedNames", {
      files: project,
      onAfterBundle: api => void (output = api.readFile("/out.js")),
    });

    const declared = parse(output, { ecmaVersion: "latest", sourceType: "module" }).body.flatMap(statement =>
      statement.type === "VariableDeclaration"
        ? statement.declarations.map(declarator => (declarator.id.type === "Identifier" ? declarator.id.name : ""))
        : statement.type === "FunctionDeclaration"
          ? [statement.id.name]
          : [],
    );
    const inputs = Object.values(project).join("\n");
    const generated = declared.filter(name => name && !inputs.split(/[^\w$]+/).includes(name));
    expect(generated.filter(name => findUndeclaredGeneratedNames(`${name};`, "script").size === 0)).toEqual([]);
    // Each shape that has a declaration is in this bundle. Nothing ever declares a `module_<file>`.
    const shape = /^(?:exports?_|require_|init_|import_|\$|__)|_default(?=\d*$)/;
    expect([...new Set(generated.map(name => shape.exec(name)?.[0]))].sort()).toEqual([
      "$",
      "__",
      "_default",
      "export_",
      "exports_",
      "import_",
      "init_",
      "require_",
    ]);
    expect(generated).toContain("lib_default2");
  });
});
