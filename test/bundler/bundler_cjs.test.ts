import type { BuildOutput } from "bun";
import { describe, expect } from "bun:test";
import { basename } from "node:path";
import { itBundled } from "./expectBundled";

// Tests for CommonJS <> ESM interop, specifically the __toESM helper behavior.
//
// `__toESM(mod, isNodeMode)` builds the ESM view of a CommonJS module. The
// bundler picks `isNodeMode` from the module type of the *importing* file, the
// same way esbuild does. The syntax the importer uses does not matter.
//
// - `.mjs`, `.mts`, or a `.js`/`.ts` file under package.json `"type": "module"`:
//   isNodeMode=1. The default import is the whole `module.exports`, as in
//   Node. `__esModule` is ignored.
// - Every other importer (`.js`, `.ts`, no package.json `"type"`, or
//   `"type": "commonjs"`): isNodeMode=0. When `module.exports.__esModule` is
//   truthy and `module.exports` has its own `default` property, the default
//   import is `module.exports.default`. Otherwise it is the whole
//   `module.exports`. This matches `bun run`. esbuild matches it too, except
//   that it gives `undefined` when the `default` property is missing.
//
// A bare `require()` never goes through `__toESM`.

describe("bundler", () => {
  // ============================================================================
  // Tests with a `.js` importer and no package.json "type"
  // These use isNodeMode=0, which honors __esModule
  // ============================================================================

  // Test 1: import with __esModule marker - honored
  itBundled("cjs/__toESM_import_syntax_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: 'default export' };
        exports.named = 'named export';
      `,
    },
    run: {
      // The importer is a `.js` file with no package.json "type", so
      // isNodeMode=0 and the default import is `exports.default`
      stdout: '{"value":"default export"}',
    },
  });

  // Test 2: import WITHOUT __esModule marker
  itBundled("cjs/__toESM_import_syntax_without_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // Same behavior - entire module wrapped as default
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // Test 3: import with module.exports = function
  itBundled("cjs/__toESM_import_syntax_function", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(lib.name + ':' + lib());
      `,
      "/lib.cjs": /* js */ `
        module.exports = function myFunc() { return 'result'; };
      `,
    },
    run: {
      stdout: "myFunc:result",
    },
  });

  // Test 4: import with module.exports = primitive
  itBundled("cjs/__toESM_import_syntax_primitive", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(lib);
      `,
      "/lib.cjs": /* js */ `
        module.exports = 42;
      `,
    },
    run: {
      stdout: "42",
    },
  });

  // Test 5: import with named + default
  itBundled("cjs/__toESM_import_syntax_named_and_default", {
    files: {
      "/entry.js": /* js */ `
        import lib, { foo } from './lib.cjs';
        console.log(JSON.stringify({ default: lib, named: foo }));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo value';
        exports.bar = 'bar value';
      `,
    },
    run: {
      stdout: '{"default":{"foo":"foo value","bar":"bar value"},"named":"foo value"}',
    },
  });

  // Test 6: Namespace import (import *)
  itBundled("cjs/__toESM_import_syntax_namespace", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // Namespace import only gets the CJS exports as-is, no default wrapper.
      // The lifted module keeps the order of its `exports.x = ...` assignments,
      // like `module.exports` would.
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // ============================================================================
  // Tests with different targets
  // Target doesn't affect isNodeMode - it's based on the importer's module type.
  // The fixture assigns `module.exports` so the module keeps its CommonJS
  // wrapper and the default import goes through __toESM.
  // ============================================================================

  // Test 7: target=node
  itBundled("cjs/__toESM_target_node", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // Test 8: target=browser
  itBundled("cjs/__toESM_target_browser", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // Test 9: target=bun
  itBundled("cjs/__toESM_target_bun", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // ============================================================================
  // Tests with different output formats
  // Output format doesn't affect isNodeMode either
  // ============================================================================

  // Test 10: format=esm
  itBundled("cjs/__toESM_format_esm", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'the default';
        exports.other = 'other';
      `,
    },
    format: "esm",
    run: {
      // __esModule honored: the `.js` importer has no package.json "type"
      stdout: '"the default"',
    },
  });

  // Test 11: format=cjs with import syntax
  itBundled("cjs/__toESM_format_cjs_with_import", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'the default';
        exports.other = 'other';
      `,
    },
    format: "cjs",
    run: {
      // Output format does not change isNodeMode either
      stdout: '"the default"',
    },
  });

  // ============================================================================
  // Tests for .mjs files re-exporting from .cjs
  // ============================================================================

  // Test 12: .mjs re-exporting default from CJS
  itBundled("cjs/__toESM_mjs_reexport", {
    files: {
      "/entry.js": /* js */ `
        import lib from './wrapper.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/wrapper.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // Test 13: .mjs re-exporting with __esModule (ignored: the importer is .mjs)
  itBundled("cjs/__toESM_mjs_reexport_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './wrapper.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/wrapper.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: 'from cjs' };
        exports.other = 'other';
      `,
    },
    run: {
      // The file that imports lib.cjs is wrapper.mjs, so isNodeMode=1 and the
      // entire module is the default, as in Node
      stdout: '{"__esModule":true,"default":{"value":"from cjs"},"other":"other"}',
    },
  });

  // Test 14: Deep re-export chain
  itBundled("cjs/__toESM_deep_reexport_chain", {
    files: {
      "/entry.js": /* js */ `
        import lib from './layer1.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/layer1.mjs": /* js */ `
        export { default } from './layer2.mjs';
      `,
      "/layer2.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.deep = 'value';
      `,
    },
    run: {
      stdout: '{"deep":"value"}',
    },
  });

  // Test 15: Re-export with rename
  itBundled("cjs/__toESM_reexport_with_rename", {
    files: {
      "/entry.js": /* js */ `
        import { myDefault } from './wrapper.mjs';
        console.log(JSON.stringify(myDefault));
      `,
      "/wrapper.mjs": /* js */ `
        export { default as myDefault } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.x = 1;
      `,
    },
    run: {
      stdout: '{"x":1}',
    },
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  // Test 16: CJS with a property named "default" but no __esModule
  itBundled("cjs/__toESM_default_prop_no_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.default = 'I am a prop named default';
        exports.other = 'other';
      `,
    },
    run: {
      // Entire module wrapped, including the .default property
      stdout: '{"default":"I am a prop named default","other":"other"}',
    },
  });

  // Test 17: Mixed import styles
  itBundled("cjs/__toESM_mixed_import_styles", {
    files: {
      "/entry.js": /* js */ `
        import defaultExport from './lib.cjs';
        import { foo } from './lib.cjs';
        import * as namespace from './lib.cjs';
        console.log(JSON.stringify({
          default: defaultExport,
          named: foo,
          namespace: namespace
        }));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // The default import is held as a value, so the module keeps its
      // CommonJS wrapper and the namespace goes through __toESM, as in Node.
      stdout:
        '{"default":{"foo":"foo","bar":"bar"},"named":"foo","namespace":{"default":{"foo":"foo","bar":"bar"},"foo":"foo","bar":"bar"}}',
    },
  });

  // Test 18: __esModule with non-true value
  itBundled("cjs/__toESM_esModule_non_true", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = 'truthy';
        exports.default = { value: 'default' };
        exports.other = 'other';
      `,
    },
    run: {
      // __toESM tests __esModule for truthiness, like esbuild
      stdout: '{"value":"default"}',
    },
  });

  // Test 19: __esModule = false
  itBundled("cjs/__toESM_esModule_false", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = false;
        exports.default = { value: 'ignored' };
        exports.foo = 'foo';
      `,
    },
    run: {
      // A falsy __esModule means the entire module is the default
      stdout: '{"__esModule":false,"default":{"value":"ignored"},"foo":"foo"}',
    },
  });

  // Test 20: module.exports with __esModule
  itBundled("cjs/__toESM_module_exports_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = {
          __esModule: true,
          default: { value: 'nested' },
          other: 'prop'
        };
      `,
    },
    run: {
      // __esModule on a replaced module.exports is honored too
      stdout: '{"value":"nested"}',
    },
  });

  // Test 21: Input=ESM, output=CJS, importing CJS with __esModule and named imports
  // This test covers printing __toESM when output format is CJS and the input
  // uses ESM syntax to import both default and named exports from CJS with __esModule
  itBundled("cjs/__toESM_input_esm_output_cjs_wrapper_print", {
    files: {
      "/entry.js": /* js */ `
        import lib, { named } from "./lib.cjs";
        console.log(JSON.stringify({ default: lib, named }));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: "default" };
        exports.named = "named export";
      `,
    },
    format: "cjs",
    run: {
      // default gets `exports.default`, named gets the named property
      stdout: '{"default":{"value":"default"},"named":"named export"}',
    },
  });

  // Test 22: Star import with __esModule
  itBundled("cjs/__toESM_star_import_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'default';
        exports.named = 'named';
      `,
    },
    run: {
      // Star import gets the exports as-is, no wrapper
      stdout: '{"__esModule":true,"default":"default","named":"named"}',
    },
  });

  // Test 23: Practical example - importing lodash-like library
  itBundled("cjs/__toESM_practical_lodash_style", {
    files: {
      "/entry.js": /* js */ `
        import _ from './lodash.cjs';
        import { map } from './lodash.cjs';
        console.log(JSON.stringify({
          hasMap: typeof _.map === 'function',
          same: _.map === map
        }));
      `,
      "/lodash.cjs": /* js */ `
        exports.map = function(arr, fn) { return arr.map(fn); };
        exports.filter = function(arr, fn) { return arr.filter(fn); };
      `,
    },
    run: {
      // Default gets entire module, named import gets specific function
      // Both reference the same function
      stdout: '{"hasMap":true,"same":true}',
    },
  });

  // ============================================================================
  // Nullish module.exports: __toESM must not pass null/undefined to
  // Object.getOwnPropertyNames or the bundle throws at import time.
  // ============================================================================

  // Test 24: module.exports = null, format=esm
  itBundled("cjs/__toESM_module_exports_null", {
    files: {
      "/entry.js": /* js */ `
        import z from "./z.cjs";
        console.log("z is", z);
      `,
      "/z.cjs": /* js */ `
        module.exports = null;
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "z is null",
    },
  });

  // Test 25: module.exports = null, format=cjs
  itBundled("cjs/__toESM_module_exports_null_format_cjs", {
    files: {
      "/entry.js": /* js */ `
        import z from "./z.cjs";
        console.log("z is", z);
      `,
      "/z.cjs": /* js */ `
        module.exports = null;
      `,
    },
    target: "node",
    format: "cjs",
    run: {
      stdout: "z is null",
    },
  });

  // Test 26: module.exports = undefined
  itBundled("cjs/__toESM_module_exports_undefined", {
    files: {
      "/entry.js": /* js */ `
        import u from "./u.cjs";
        console.log("u is", u);
      `,
      "/u.cjs": /* js */ `
        module.exports = undefined;
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "u is undefined",
    },
  });

  // ============================================================================
  // The __commonJS wrapper must be a regular function (not an arrow) so a
  // top-level `arguments` reference in a CJS body has a binding in ESM output.
  // ============================================================================

  // Test 27: top-level `arguments` inside a CJS module
  itBundled("cjs/__commonJS_top_level_arguments", {
    files: {
      "/entry.js": /* js */ `
        import tag from "./args.cjs";
        console.log(tag);
      `,
      "/args.cjs": /* js */ `
        module.exports = Object.prototype.toString.call(arguments);
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "[object Arguments]",
    },
  });

  // Test 28: export * from an external package whose module.exports is null.
  // CJS output emits __reExport(exports, require("ext"), module.exports) with
  // the raw require() result, so __reExport itself must tolerate null.
  itBundled("cjs/__reExport_external_null_module_exports", {
    files: {
      "/entry.js": /* js */ `
        export * from "ext";
        console.log("loaded ok");
      `,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": /* js */ `module.exports = null;`,
    },
    external: ["ext"],
    target: "node",
    format: "cjs",
    run: {
      stdout: "loaded ok",
    },
  });

  // ============================================================================
  // An import of a module with top-level await in a file that is printed
  // inside a `__commonJS` wrapper
  //
  // The `import` becomes a call inside the wrapper, which is not an async
  // function: it cannot wait for the module. The import is a build error.
  // ============================================================================

  const tlaFile = `await 0;\nexport const t = 1;`;
  const importsTLAFile = `import { t } from "./tla.js";\nmodule.exports = { t };`;
  const logDefaultT = `import c from "./c.js";\nconsole.log(c.t);`;
  // Tree shaking removes this package when nothing reads its exports.
  const shakeableTLAPackage = {
    "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "sideEffects": false }`,
    "/node_modules/pkg/index.js": tlaFile,
  };

  const tlaImportError = (importer: string, imported: string) =>
    `This import is not allowed because "${importer}" is bundled as CommonJS and the imported file "${imported}" contains a top-level await`;
  const tlaImportHint = (imported: string) =>
    `CommonJS code runs synchronously and cannot wait for a top-level await. Load "${imported}" with import() inside a function instead`;
  const directEvalHint = (importer: string) =>
    `A direct eval makes a file without an "export" CommonJS. Add an "export" to "${importer}", or call eval as (0, eval)(code)`;
  // `file:line:column` of a log or of a note
  const logPosition = (position: { file: string; line: number; column: number } | null) =>
    position && `${basename(position.file)}:${position.line}:${position.column}`;
  const logsOf = (build: BuildOutput) =>
    build.logs.map((log: any) => ({
      level: log.level,
      message: log.message,
      at: logPosition(log.position),
      notes: log.notes.map((note: any) => ({ message: note.message, at: logPosition(note.position) })),
    }));
  // The error for an import of "tla.js" at `line:column` of `importer`
  const tlaImportLog = (importer: string, at: string, tla = "tla.js") => ({
    level: "error",
    message: tlaImportError(importer, tla),
    at: `${importer}:${at}`,
    notes: [
      { message: `The top-level await in ${tla} is here:`, at: `${tla}:1:1` },
      { message: tlaImportHint(tla), at: null },
    ],
  });

  itBundled("cjs/tla_import_module_exports", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [
        'This import is not allowed because "c.js" is bundled as CommonJS and the imported file "tla.js" contains a top-level await',
      ],
    },
    onAfterApiBundle(build) {
      expect(build.success).toBe(false);
      expect(logsOf(build)).toEqual([
        {
          level: "error",
          message:
            'This import is not allowed because "c.js" is bundled as CommonJS and the imported file "tla.js" contains a top-level await',
          at: "c.js:1:19",
          notes: [
            { message: "The top-level await in tla.js is here:", at: "tla.js:1:1" },
            {
              message:
                'CommonJS code runs synchronously and cannot wait for a top-level await. Load "tla.js" with import() inside a function instead',
              at: null,
            },
          ],
        },
      ]);
    },
  });

  // `bun build`, with the source map tasks that a failed link has to wait for
  itBundled("cjs/tla_import_module_exports_cli", {
    backend: "cli",
    sourceMap: "inline",
    files: {
      "/entry.js": logDefaultT,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
  });

  itBundled("cjs/tla_import_module_exports_compile", {
    compile: true,
    files: {
      "/entry.js": logDefaultT,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
  });

  // The build fails as a whole: the file of `b.js` would not parse.
  itBundled("cjs/tla_import_one_of_two_entry_points", {
    files: {
      "/a.js": `console.log("a");`,
      "/b.js": logDefaultT,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(build.outputs).toEqual([]);
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19")]);
    },
  });

  // `exports.t = t` alone is lifted to `export { t }`. A default import that
  // is held as a value brings the wrapper back.
  itBundled("cjs/tla_import_exports_with_held_default_import", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": `import { t } from "./tla.js";\nexports.t = t;`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19")]);
    },
  });

  itBundled("cjs/tla_import_entry_point", {
    files: {
      "/entry.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/entry.js": [tlaImportError("entry.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("entry.js", "1:19")]);
    },
  });

  for (const splitting of [false, true]) {
    itBundled(`cjs/tla_import_file_loaded_with_import_call${splitting ? "_splitting" : ""}`, {
      files: {
        "/entry.js": `const c = await import("./c.js");\nconsole.log(c.default.t);`,
        "/c.js": importsTLAFile,
        "/tla.js": tlaFile,
      },
      splitting,
      outdir: "/out",
      bundleErrors: {
        "/c.js": [tlaImportError("c.js", "tla.js")],
      },
      onAfterApiBundle(build) {
        expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19")]);
      },
    });
  }

  // One note for each `import` on the way to the `await`. An `import()` is not
  // on the way: the chain of `mid.js` goes through `mid2.js`, not `near.js`.
  itBundled("cjs/tla_import_transitive", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": `import { t } from "./mid.js";\nmodule.exports = { t };`,
      "/mid.js": `export { t } from "./mid2.js";\nexport const near = () => import("./near.js");`,
      "/mid2.js": `export { t } from "./tla.js";`,
      "/near.js": `await 0;\nexport const n = 1;`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [
        'This import is not allowed because "c.js" is bundled as CommonJS and the transitive dependency "tla.js" contains a top-level await',
      ],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([
        {
          level: "error",
          message:
            'This import is not allowed because "c.js" is bundled as CommonJS and the transitive dependency "tla.js" contains a top-level await',
          at: "c.js:1:19",
          notes: [
            { message: "The file mid.js imports the file mid2.js here:", at: "mid.js:1:19" },
            { message: "The file mid2.js imports the file tla.js here:", at: "mid2.js:1:19" },
            { message: "The top-level await in tla.js is here:", at: "tla.js:1:1" },
            { message: tlaImportHint("mid.js"), at: null },
          ],
        },
      ]);
    },
  });

  // Of two imports at the same distance from an `await`, the notes take the first.
  itBundled("cjs/tla_import_transitive_two_awaits", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": `import { t } from "./mid.js";\nmodule.exports = { t };`,
      "/mid.js": `export { t } from "./tla.js";\nimport "./tla2.js";`,
      "/tla.js": tlaFile,
      "/tla2.js": `await 0;`,
    },
    bundleErrors: {
      "/c.js": [
        'This import is not allowed because "c.js" is bundled as CommonJS and the transitive dependency "tla.js" contains a top-level await',
      ],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)[0].notes).toEqual([
        { message: "The file mid.js imports the file tla.js here:", at: "mid.js:1:19" },
        { message: "The top-level await in tla.js is here:", at: "tla.js:1:1" },
        { message: tlaImportHint("mid.js"), at: null },
      ]);
    },
  });

  itBundled("cjs/tla_import_bare", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": `import "./tla.js";\nmodule.exports = { t: 2 };`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:8")]);
    },
  });

  itBundled("cjs/tla_import_cjs_extension", {
    files: {
      "/entry.js": `import c from "./c.cjs";\nconsole.log(c.t);`,
      "/c.cjs": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.cjs": [tlaImportError("c.cjs", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.cjs", "1:19")]);
    },
  });

  // The CommonJS file still runs when nothing reads its exports.
  itBundled("cjs/tla_import_unused_default_import", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log("entry");`,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19")]);
    },
  });

  // One error for each import of a module with top-level await, and none for `plain.js`.
  itBundled("cjs/tla_import_two_modules", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log(c.t, c.u, c.p);`,
      "/c.js": `import { t } from "./tla.js";\nimport { p } from "./plain.js";\nimport { u } from "./tla2.js";\nmodule.exports = { t, u, p };`,
      "/plain.js": `console.log("plain");\nexport const p = 3;`,
      "/tla.js": tlaFile,
      "/tla2.js": `await 0;\nexport const u = 2;`,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js"), tlaImportError("c.js", "tla2.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19"), tlaImportLog("c.js", "3:19", "tla2.js")]);
    },
  });

  // `Object.keys(exports)` keeps these two files CommonJS with their `export`:
  // the bundler drops the `export` and keeps the import of the file.
  itBundled("cjs/tla_import_export_from", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log(c.a);`,
      "/c.js": `export { t } from "./tla.js";\nexports.a = 1;\nObject.keys(exports);`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:19")]);
    },
  });

  itBundled("cjs/tla_import_export_star_as", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log(c.a);`,
      "/c.js": `export * as ns from "./tla.js";\nexports.a = 1;\nObject.keys(exports);`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.js", "1:21")]);
    },
  });

  // `require("react")` is unwrapped to an `import` of the package.
  itBundled("cjs/tla_import_unwrapped_require", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log(c.v);`,
      "/c.js": `const React = require("react");\nmodule.exports = { v: React.version };`,
      "/node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "main": "index.js", "type": "module" }`,
      "/node_modules/react/index.js": `await 0;\nexport const version = "19";`,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "node_modules/react/index.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([
        {
          level: "error",
          message: tlaImportError("c.js", "node_modules/react/index.js"),
          at: "c.js:1:23",
          notes: [
            { message: "The top-level await in node_modules/react/index.js is here:", at: "index.js:1:1" },
            { message: tlaImportHint("node_modules/react/index.js"), at: null },
          ],
        },
      ]);
    },
  });

  // Files that are CommonJS for the bundler without `module.exports` or `exports.x`

  // A direct eval can read `module` and `exports`.
  for (const importer of ["c.js", "entry.js"]) {
    itBundled(`cjs/tla_import_direct_eval${importer === "entry.js" ? "_entry_point" : ""}`, {
      files: {
        "/entry.js": `import "./c.js";`,
        [`/${importer}`]: `import { t } from "./tla.js";\nconsole.log(eval("t"));`,
        "/tla.js": tlaFile,
      },
      bundleErrors: {
        [`/${importer}`]: [tlaImportError(importer, "tla.js")],
      },
      onAfterApiBundle(build) {
        expect(logsOf(build)).toEqual([
          {
            level: "error",
            message: tlaImportError(importer, "tla.js"),
            at: `${importer}:1:19`,
            notes: [
              { message: "The top-level await in tla.js is here:", at: "tla.js:1:1" },
              { message: tlaImportHint("tla.js"), at: null },
              { message: directEvalHint(importer), at: null },
            ],
          },
        ]);
      },
    });
  }

  // The two ways out that the note of the direct eval names
  itBundled("cjs/tla_import_direct_eval_with_export", {
    files: {
      "/entry.js": `import "./c.js";`,
      "/c.js": `import { t } from "./tla.js";\nconsole.log(eval("1 + 1"), t);\nexport {};`,
      "/tla.js": tlaFile,
    },
    run: {
      stdout: "2 1",
    },
  });

  itBundled("cjs/tla_import_indirect_eval", {
    files: {
      "/entry.js": `import "./c.js";`,
      "/c.js": `import { t } from "./tla.js";\nconsole.log((0, eval)("1 + 1"), t);`,
      "/tla.js": tlaFile,
    },
    run: {
      stdout: "2 1",
    },
  });

  // A reference to `module` is enough, also in a `.mjs` file.
  itBundled("cjs/tla_import_typeof_module_in_mjs", {
    files: {
      "/entry.mjs": `import { t } from "./tla.js";\nconsole.log(t, typeof module);`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/entry.mjs": [tlaImportError("entry.mjs", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("entry.mjs", "1:19")]);
    },
  });

  itBundled("cjs/tla_import_module_hot", {
    files: {
      "/entry.js": `import { t } from "./tla.js";\nif (module.hot) module.hot.accept();\nconsole.log(t);`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/entry.js": [tlaImportError("entry.js", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("entry.js", "1:19")]);
    },
  });

  itBundled("cjs/tla_import_ts_export_equals", {
    files: {
      "/entry.js": `import c from "./c.ts";\nconsole.log(c.t);`,
      "/c.ts": `import { t } from "./tla.js";\nexport = { t };`,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/c.ts": [tlaImportError("c.ts", "tla.js")],
    },
    onAfterApiBundle(build) {
      expect(logsOf(build)).toEqual([tlaImportLog("c.ts", "1:19")]);
    },
  });

  // Tree shaking decides whether the import is in the bundle.

  // The package stays in the bundle when its export is read.
  itBundled("cjs/tla_import_used_export_of_shakeable_package", {
    files: {
      "/entry.js": logDefaultT,
      "/c.js": `import { t } from "pkg";\nmodule.exports = { t };`,
      ...shakeableTLAPackage,
    },
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "node_modules/pkg/index.js")],
    },
  });

  // The export is not read: the import is not in the bundle. `plain.js` is, and runs.
  const unusedExportOfShakeablePackage = {
    "/entry.js": logDefaultT,
    "/c.js": `import { t } from "pkg";\nimport "./plain.js";\nmodule.exports = { t: 5 };`,
    "/plain.js": `console.log("plain");`,
    ...shakeableTLAPackage,
  };
  itBundled("cjs/tla_import_unused_export_of_shakeable_package", {
    files: unusedExportOfShakeablePackage,
    run: {
      stdout: "plain\n5",
    },
  });

  // The two options that keep the package in the bundle
  itBundled("cjs/tla_import_unused_export_of_shakeable_package_ignore_dce_annotations", {
    files: unusedExportOfShakeablePackage,
    ignoreDCEAnnotations: true,
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "node_modules/pkg/index.js")],
    },
  });

  itBundled("cjs/tla_import_unused_export_of_shakeable_package_no_tree_shaking", {
    files: unusedExportOfShakeablePackage,
    backend: "api",
    treeShaking: false,
    bundleErrors: {
      "/c.js": [tlaImportError("c.js", "node_modules/pkg/index.js")],
    },
  });

  // The package is in the bundle for `entry.js`. The import in `c.js` is still unused.
  itBundled("cjs/tla_import_unused_export_of_package_used_elsewhere", {
    files: {
      "/entry.js": `import c from "./c.js";\nimport { t } from "pkg";\nconsole.log(c.v, t);`,
      "/c.js": `import { t } from "pkg";\nmodule.exports = { v: 5 };`,
      ...shakeableTLAPackage,
    },
    run: {
      stdout: "5 1",
    },
  });

  // `tla.ts` is in the bundle for `entry.js`. The import in `c.ts` names a type only.
  itBundled("cjs/tla_import_type_only", {
    files: {
      "/entry.js": `import c from "./c.ts";\nimport { t } from "./tla.ts";\nconsole.log(c.t, t);`,
      "/c.ts": `import { T } from "./tla.ts";\nconst x: T = 5;\nmodule.exports = { t: x };`,
      "/tla.ts": `await 0;\nexport const t = 1;\nexport type T = number;`,
    },
    run: {
      stdout: "5 1",
    },
  });

  // The CommonJS file is not in the bundle: nothing reads `c`.
  const unusedFileOfShakeablePackage = {
    "/entry.js": `import { a } from "pkg";\nconsole.log(a);`,
    "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "sideEffects": false }`,
    "/node_modules/pkg/index.js": `export const a = "a";\nexport { default as c } from "./c.js";`,
    "/node_modules/pkg/c.js": importsTLAFile,
    "/node_modules/pkg/tla.js": tlaFile,
  };
  itBundled("cjs/tla_import_in_unused_file_of_shakeable_package", {
    files: unusedFileOfShakeablePackage,
    run: {
      stdout: "a",
    },
  });

  itBundled("cjs/tla_import_in_unused_file_of_shakeable_package_ignore_dce_annotations", {
    files: unusedFileOfShakeablePackage,
    ignoreDCEAnnotations: true,
    bundleErrors: {
      "/node_modules/pkg/c.js": [tlaImportError("node_modules/pkg/c.js", "node_modules/pkg/tla.js")],
    },
  });

  // The next tests build: no `await` is inside a `__commonJS` wrapper.

  // Every importer reads `exports.t` by name: the file stays lifted to an ES module.
  itBundled("cjs/tla_import_lifted_exports_file", {
    files: {
      "/entry.js": `import { t } from "./c.js";\nconsole.log(t);`,
      "/c.js": `import { t } from "./tla.js";\nexports.t = t;`,
      "/tla.js": tlaFile,
    },
    run: {
      stdout: "1",
    },
  });

  itBundled("cjs/tla_import_lifted_exports_file_splitting", {
    files: {
      "/entry.js": `const c = await import("./c.js");\nconsole.log(c.t);`,
      "/c.js": `import { t } from "./tla.js";\nexports.t = t;`,
      "/tla.js": tlaFile,
    },
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/entry.js",
      stdout: "1",
    },
  });

  // `export *` without an alias calls the wrapper of "tla.js" and does not wait for it.
  // When it waits, it needs the same error.
  itBundled("cjs/tla_import_export_star", {
    files: {
      "/entry.js": `import c from "./c.js";\nconsole.log(c.a);`,
      "/c.js": `export * from "./tla.js";\nexports.a = 1;\nObject.keys(exports);`,
      "/tla.js": tlaFile,
    },
    run: {
      stdout: "1",
    },
  });

  itBundled("cjs/tla_import_of_sync_file_beside_tla_file", {
    files: {
      "/entry.js": `import { t } from "./tla.js";\nimport c from "./c.js";\nconsole.log(t, c.p);`,
      "/c.js": `import { p } from "./plain.js";\nmodule.exports = { p };`,
      "/plain.js": `export const p = 2;`,
      "/tla.js": tlaFile,
    },
    run: {
      stdout: "1 2",
    },
  });

  // This format has no `__commonJS` wrapper.
  itBundled("cjs/tla_import_internal_bake_dev_format", {
    format: "internal_bake_dev",
    files: {
      "/entry.js": logDefaultT,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain('"c.js"(hmr, module, exports) {');
    },
  });

  // The `require()` error is reported first, and alone.
  itBundled("cjs/tla_import_file_loaded_with_require", {
    files: {
      "/entry.js": `const c = require("./c.js");\nconsole.log(c.t);`,
      "/c.js": importsTLAFile,
      "/tla.js": tlaFile,
    },
    bundleErrors: {
      "/entry.js": [
        'This require call is not allowed because the transitive dependency "tla.js" contains a top-level await',
      ],
    },
    onAfterApiBundle(build) {
      expect(build.logs.length).toBe(1);
    },
  });

  // ============================================================================
  // isNodeMode follows the importer's module type: the file extension first,
  // then the nearest package.json "type". One test per importer kind.
  //
  // `dep.cjs` sets the marker with Object.defineProperty, the way TypeScript
  // and Babel emit it. `typeof d` tells the two interops apart: "function" is
  // `exports.default`, "object" is the whole `module.exports`.
  // ============================================================================

  const esModuleDep = /* js */ `
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.named = 1;
    exports.default = function theDefault() {};
  `;
  const logDefaultAndNamed = /* js */ `
    import d, { named } from "./dep.cjs";
    console.log(typeof d, named);
  `;

  // Test 29: a `.ts` importer gets `exports.default`, the same as `bun run`
  itBundled("cjs/__toESM_ts_importer_honors_esModule", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep())");
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 30: a `.mjs` importer gets the whole `module.exports`, as in Node
  itBundled("cjs/__toESM_mjs_importer_node_mode", {
    files: {
      "/entry.mjs": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep(), 1)");
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 31: `.mts` behaves like `.mjs`
  itBundled("cjs/__toESM_mts_importer_node_mode", {
    files: {
      "/entry.mts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 32: package.json "type": "module" makes a `.ts` importer ESM.
  itBundled("cjs/__toESM_type_module_importer_node_mode", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "module" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 33: package.json "type": "commonjs" keeps the `__esModule` interop
  itBundled("cjs/__toESM_type_commonjs_importer_honors_esModule", {
    files: {
      "/entry.js": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 34: the `.mjs` extension wins over package.json "type": "commonjs"
  itBundled("cjs/__toESM_mjs_importer_overrides_type_commonjs", {
    files: {
      "/entry.mjs": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 35: the rule applies per file. A `.ts` entry and a `.mjs` file that
  // import the same CJS module each see their own interop.
  itBundled("cjs/__toESM_per_importer_module_type", {
    files: {
      "/entry.ts": /* ts */ `
        import d from "./dep.cjs";
        import { fromMjs } from "./other.mjs";
        console.log(typeof d, typeof fromMjs);
      `,
      "/other.mjs": /* js */ `
        import d from "./dep.cjs";
        export const fromMjs = d;
      `,
      "/dep.cjs": esModuleDep,
    },
    run: {
      stdout: "function object",
    },
  });

  const dynamicImportLog = /* js */ `
    const m = await import("./dep.cjs");
    console.log(typeof m.default, m.named);
  `;

  // Test 36: dynamic import of a bundled CJS module, `.ts` importer
  itBundled("cjs/__toESM_dynamic_import_ts_importer", {
    files: {
      "/entry.ts": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep())");
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 37: dynamic import of a bundled CJS module, `.mjs` importer
  itBundled("cjs/__toESM_dynamic_import_mjs_importer", {
    files: {
      "/entry.mjs": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep(), 1)");
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 38: with splitting, the CJS module lands in its own chunk and the
  // importer unwraps it with `.then((m) => __toESM(m.default))`
  itBundled("cjs/__toESM_splitting_dynamic_import_ts_importer", {
    files: {
      "/entry.ts": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(m.default))");
    },
    run: {
      file: "/out/entry.js",
      stdout: "function 1",
    },
  });

  // Test 39: the same with a `.mjs` importer
  itBundled("cjs/__toESM_splitting_dynamic_import_mjs_importer", {
    files: {
      "/entry.mjs": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    splitting: true,
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(m.default,1))");
    },
    run: {
      file: "/out/entry.js",
      stdout: "object 1",
    },
  });

  const externalImportLog = /* js */ `
    import d, { named } from "ext";
    console.log(typeof d, named);
  `;
  const externalRuntimeFiles = {
    "/node_modules/ext/package.json": `{ "name": "ext", "main": "index.js" }`,
    "/node_modules/ext/index.js": esModuleDep,
  };

  // Test 40: an external CJS dependency in CJS output, `.ts` importer
  itBundled("cjs/__toESM_external_require_ts_importer", {
    files: {
      "/entry.ts": externalImportLog,
    },
    runtimeFiles: externalRuntimeFiles,
    external: ["ext"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("ext"))');
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 41: an external CJS dependency in CJS output, `.mjs` importer
  itBundled("cjs/__toESM_external_require_mjs_importer", {
    files: {
      "/entry.mjs": externalImportLog,
    },
    runtimeFiles: externalRuntimeFiles,
    external: ["ext"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("ext"), 1)');
    },
    run: {
      stdout: "object 1",
    },
  });

  // ============================================================================
  // Files reached through a package.json "exports" map. The matched "import" or
  // "require" condition is not a module type. Only the extension and the
  // nearest package.json "type" are.
  // ============================================================================

  const cjsDepFiles = {
    "/node_modules/cjs-dep/package.json": `{ "name": "cjs-dep", "main": "index.js" }`,
    "/node_modules/cjs-dep/index.js": esModuleDep,
  };
  const reexportDefault = /* js */ `
    import d from "cjs-dep";
    export default d;
  `;
  const logTypeofDefault = /* ts */ `
    import x from "pkg";
    console.log(typeof x);
  `;

  // Test 42: "fake ESM" reached through the "import" condition of a package
  // without "type" honors __esModule, like esbuild and `bun run`
  itBundled("cjs/__toESM_exports_import_condition_without_type", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function",
    },
  });

  // Test 43: the same package with "type": "module" gets Node's interop
  itBundled("cjs/__toESM_exports_import_condition_type_module", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "type": "module",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // Test 44: a nested package.json with "type": "module" next to the resolved
  // file makes it ESM, whatever the package root says
  itBundled("cjs/__toESM_exports_nested_type_module", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // Test 45: a `.mjs` file is ESM even inside a "type": "commonjs" package
  itBundled("cjs/__toESM_exports_mjs_in_type_commonjs_package", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "type": "commonjs",
        "exports": { "import": "./index.mjs", "require": "./index.cjs" }
      }`,
      "/node_modules/pkg/index.mjs": reexportDefault,
      "/node_modules/pkg/index.cjs": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // ============================================================================
  // A module that sets `__esModule` and has no own `default` property.
  // TypeScript and Babel emit this shape for a file with only named exports
  // (rxjs, redis, mobx). `bun run` and Node give the whole `module.exports` as
  // the default import. The bundle gives the same, for every importer.
  // ============================================================================

  const namedOnlyFiles = {
    "/node_modules/named-only/package.json": `{ "name": "named-only", "main": "index.js" }`,
    "/node_modules/named-only/index.js": /* js */ `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.named = 1;
    `,
  };
  // `bun run` prints "object true true true 1" for this file.
  const logNamedOnly = /* js */ `
    import d, * as ns from "named-only";
    import { named } from "named-only";
    const m = await import("named-only");
    console.log(typeof d, d === require("named-only"), ns.default === d, m.default === d, named);
  `;

  // Test 46: a `.js` importer
  itBundled("cjs/__toESM_esModule_without_default_js_importer", {
    files: {
      "/entry.js": logNamedOnly,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 47: a `.ts` importer with target=node
  itBundled("cjs/__toESM_esModule_without_default_ts_importer_target_node", {
    files: {
      "/entry.ts": logNamedOnly,
      ...namedOnlyFiles,
    },
    target: "node",
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 48: a `.mjs` importer uses Node's interop and gets the same value
  itBundled("cjs/__toESM_esModule_without_default_mjs_importer", {
    files: {
      "/entry.mjs": logNamedOnly,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 49: an external dependency in CJS output, `.ts` importer
  itBundled("cjs/__toESM_esModule_without_default_external_require", {
    files: {
      "/entry.ts": /* ts */ `
        import d, { named } from "named-only";
        console.log(typeof d, d === require("named-only"), named);
      `,
    },
    runtimeFiles: namedOnlyFiles,
    external: ["named-only"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("named-only"))');
    },
    run: {
      stdout: "object true 1",
    },
  });

  // Test 50: a `.js` importer under package.json "type": "commonjs"
  itBundled("cjs/__toESM_esModule_without_default_type_commonjs_importer", {
    files: {
      "/entry.js": logNamedOnly,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 51: a dynamic import with no static import of the module
  itBundled("cjs/__toESM_esModule_without_default_dynamic_import_only", {
    files: {
      "/entry.ts": /* ts */ `
        const m = await import("named-only");
        console.log(typeof m.default, m.default?.named, m.named);
      `,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object 1 1",
    },
  });

  // Test 52: an own `default` property is the default export even when its
  // value is falsy. `bun run` prints "undefined 0" too.
  itBundled("cjs/__toESM_esModule_with_falsy_default", {
    files: {
      "/entry.js": /* js */ `
        import a from "./a.cjs";
        import b from "./b.cjs";
        console.log(a, b);
      `,
      "/a.cjs": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.default = undefined;
        exports.named = 1;
      `,
      "/b.cjs": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.default = 0;
        exports.named = 1;
      `,
    },
    run: {
      stdout: "undefined 0",
    },
  });

  // ============================================================================
  // The nearest package.json decides "type", with or without a "name". A dual
  // package marks its ESM build with a nameless `dist/esm/package.json` that
  // holds only `{ "type": "module" }`. Node and esbuild read that file whatever
  // the path that reached it.
  //
  // `seen` tells the interops apart: Node's gives the whole `module.exports`
  // ("object/function"), the other gives `exports.default` ("function/undefined").
  // ============================================================================

  const seenFromCjsDep = /* js */ `
    import d from "cjs-dep";
    export const seen = typeof d + "/" + typeof d.default;
  `;
  const logSeen = /* ts */ `
    import { seen } from "pkg";
    console.log(seen);
  `;

  // Test 53: the nested marker is reached through "main"
  itBundled("cjs/__toESM_nested_nameless_type_module_via_main", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_cjs_dep(), 1)");
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 54: a nested package.json with a "name" counts the same way
  itBundled("cjs/__toESM_nested_named_type_module_via_main", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "name": "pkg-esm", "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 55: the nameless marker, reached through "module"
  itBundled("cjs/__toESM_nested_nameless_type_module_via_module_field", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "main": "./dist/cjs/index.js",
        "module": "./dist/esm/index.js"
      }`,
      "/node_modules/pkg/dist/cjs/index.js": /* js */ `exports.seen = "cjs build";`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 56: the nameless marker, reached through a relative path
  itBundled("cjs/__toESM_nested_nameless_type_module_via_relative_path", {
    files: {
      "/entry.ts": /* ts */ `
        import { seen } from "./lib/esm/index.js";
        console.log(seen);
      `,
      "/package.json": `{ "name": "app" }`,
      "/lib/esm/package.json": `{ "type": "module" }`,
      "/lib/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 57: the marker applies to every file below it, not only to the
  // directory that holds it
  itBundled("cjs/__toESM_nested_nameless_type_module_in_subdirectory", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": /* js */ `export { seen } from "./inner/seen.js";`,
      "/node_modules/pkg/dist/esm/inner/seen.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 58: a project package.json with "type" and no "name" counts too
  itBundled("cjs/__toESM_nameless_project_type_module", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "type": "module" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 59: the nearest package.json wins. A nameless "type": "commonjs"
  // marker below a "type": "module" package keeps the __esModule interop.
  itBundled("cjs/__toESM_nested_nameless_type_commonjs_under_type_module", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "./dist/cjs/index.js" }`,
      "/node_modules/pkg/dist/cjs/package.json": `{ "type": "commonjs" }`,
      "/node_modules/pkg/dist/cjs/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });

  // Test 60: the nearest package.json is the scope even when it has no "type".
  // The lookup does not continue to the "type": "module" package root.
  itBundled("cjs/__toESM_nearest_package_json_without_type_is_the_scope", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "./dist/index.js" }`,
      "/node_modules/pkg/dist/package.json": `{ "sideEffects": false }`,
      "/node_modules/pkg/dist/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });

  // Test 61: the lookup does not stop at a node_modules directory. A package
  // without a package.json of its own takes the "type" of the one above it.
  itBundled("cjs/__toESM_nameless_type_module_above_node_modules", {
    files: {
      "/entry.ts": logSeen,
      "/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 62: only the file in the bundle decides. With the default target,
  // "module" wins and "main" is the fallback for require(). The fallback's
  // package.json does not give the "module" file its "type".
  itBundled("cjs/__toESM_type_from_module_field_not_main_fallback", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "main": "./lib/index.js",
        "module": "./esm/index.js"
      }`,
      "/node_modules/pkg/lib/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/lib/index.js": /* js */ `export const seen = "main build";`,
      "/node_modules/pkg/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });
});
