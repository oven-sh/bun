import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for CommonJS <> ESM interop, specifically the __toESM helper behavior.
//
// The key insight from the code change:
// - `input_module_type` is set based on the AST's exports_kind (whether the importing
//   file uses ESM syntax like import/export or CJS syntax like require/module.exports)
// - When a file uses ESM syntax (import/export), isNodeMode = 1
// - When a file uses CJS syntax (require), __toESM is not used at all
//
// This means:
// - Any file using `import` will always get isNodeMode=1, which IGNORES __esModule
//   and always wraps the CJS module as the default export
// - This matches Node.js ESM behavior where importing CJS from .mjs always wraps
//   the entire exports object as the default
//
// The __esModule marker is only respected in non-bundled scenarios or when using
// actual CommonJS require() syntax.

describe("bundler", () => {
  // ============================================================================
  // Tests with ESM syntax (import statements)
  // These all use isNodeMode=1, which IGNORES __esModule
  // ============================================================================

  // Test 1: import with __esModule marker - IGNORED
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
      // With import syntax, isNodeMode=1, so __esModule is IGNORED
      // The entire CJS exports object is wrapped as default
      stdout: '{"__esModule":true,"default":{"value":"default export"},"named":"named export"}',
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
      // Namespace import only gets the CJS exports as-is, no default wrapper
      stdout: '{"bar":"bar","foo":"foo"}',
    },
  });

  // ============================================================================
  // Tests with different targets
  // Target doesn't affect isNodeMode - it's based on syntax
  // ============================================================================

  // Test 7: target=node
  itBundled("cjs/__toESM_target_node", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "node",
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
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "browser",
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
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "bun",
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
      // __esModule ignored because we're using import syntax
      stdout: '{"__esModule":true,"default":"the default","other":"other"}',
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
      // Still ignores __esModule because entry uses import syntax
      stdout: '{"__esModule":true,"default":"the default","other":"other"}',
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

  // Test 13: .mjs re-exporting with __esModule (still ignored)
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
      // __esModule ignored - entire module wrapped as default
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
      // Even if __esModule were respected, only `true` would work
      // But it's ignored anyway due to import syntax
      stdout: '{"__esModule":"truthy","default":{"value":"default"},"other":"other"}',
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
      // Entire module wrapped as default (since we use import syntax)
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
      // __esModule is in the object but ignored due to import syntax
      stdout: '{"__esModule":true,"default":{"value":"nested"},"other":"prop"}',
    },
  });

  // Test 21: Input=ESM, output=CJS, importing CJS with __esModule and named imports
  // This test covers the specific fix for printing __toESM when output format is CJS
  // and input uses ESM syntax to import both default and named exports from CJS with __esModule
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
      // With the fix: ignores __esModule, wraps entire module as default
      // So default gets the whole exports object, named gets the named property
      stdout:
        '{"default":{"__esModule":true,"default":{"value":"default"},"named":"named export"},"named":"named export"}',
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
  // A file with `export` (or top-level await) is an ECMAScript module, even if
  // it also assigns to `module.exports` or `exports.foo`. In such a file `module`
  // and `exports` are plain globals, not the CommonJS wrapper bindings, so the
  // ESM exports stay and the bundler warns about the CommonJS assignment.
  // ============================================================================

  const mixedLib = /* js */ `
    export const a = 1;
    export function fa() { return a }
    export default 9;
    if (typeof module !== "undefined") module.exports.b = 2;
  `;
  const mixedEntry = /* js */ `
    import def, { a, fa } from './lib.js';
    import * as ns from './lib.js';
    console.log(JSON.stringify({ a, fa: typeof fa, def, keys: Object.keys(ns) }));
  `;
  const mixedStdout = '{"a":1,"fa":"function","def":9,"keys":["a","default","fa"]}';
  const moduleIsGlobalWarning =
    'The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected';

  for (const format of ["esm", "cjs", "iife"] as const) {
    itBundled(`cjs/MixedExportAndModuleExportsIsESM_${format}`, {
      files: {
        "/entry.js": mixedEntry,
        "/lib.js": mixedLib,
      },
      format,
      bundleWarnings: {
        "/lib.js": [moduleIsGlobalWarning],
      },
      onAfterBundle(api) {
        // lib.js is not wrapped as CommonJS and `module` is printed as the global
        api.expectFile("/out.js").not.toContain("__commonJS");
        api.expectFile("/out.js").not.toContain("module_lib");
        api.expectFile("/out.js").toContain("module.exports.b = 2");
      },
      run: { stdout: mixedStdout },
    });
  }

  itBundled("cjs/MixedExportAndModuleExportsNamedImportOfCommonJSProperty", {
    files: {
      "/entry.js": /* js */ `
        import { a, b } from './lib.js';
        console.log(a, b);
      `,
      "/lib.js": mixedLib,
    },
    bundleWarnings: {
      "/lib.js": [moduleIsGlobalWarning],
    },
    bundleErrors: {
      "/entry.js": ['No matching export in "lib.js" for import "b"'],
    },
  });

  itBundled("cjs/MixedExportAndExportsAssignment", {
    files: {
      "/entry.js": /* js */ `
        import { a } from './lib.js';
        console.log(a);
      `,
      "/lib.js": /* js */ `
        export const a = 1;
        if (typeof exports !== "undefined") exports.b = 2;
        if (typeof module !== "undefined") module.exports = { c: 3 };
      `,
    },
    bundleWarnings: {
      "/lib.js": [
        'The CommonJS "exports" variable is treated as a global variable in an ECMAScript module and may not work as expected',
        moduleIsGlobalWarning,
      ],
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__commonJS");
      api.expectFile("/out.js").toContain("exports.b = 2");
      api.expectFile("/out.js").toContain("module.exports = { c: 3 }");
    },
    run: { stdout: "1" },
  });

  itBundled("cjs/TopLevelAwaitWithModuleExports", {
    files: {
      "/entry.js": /* js */ `
        await Promise.resolve();
        module.exports = { a: 1 };
        console.log("done");
      `,
    },
    bundleWarnings: {
      "/entry.js": [moduleIsGlobalWarning],
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("module_entry");
      api.expectFile("/out.js").toContain("module.exports = { a: 1 }");
    },
    run: { error: "ReferenceError: module is not defined" },
  });

  itBundled("cjs/TypeofModuleAndExportsInESM", {
    files: {
      "/entry.js": /* js */ `
        export const x = 1;
        console.log(typeof module, typeof exports);
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("module_entry");
      api.expectFile("/out.js").toContain("typeof module, typeof exports");
    },
    run: { stdout: "undefined undefined" },
  });

  itBundled("cjs/RequireMainEqualsModuleInESM", {
    files: {
      "/entry.js": /* js */ `
        export const x = 1;
        console.log(require.main === module, require.main !== module);
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("module_entry");
      api.expectFile("/out.js").toContain("import.meta.main");
    },
    run: { stdout: "true false" },
  });

  // Reads of `module.id`, `module.require()` and `exports.foo` in an ESM file
  // are printed as written. The CommonJS folds (`module.id` inlined,
  // `module.require(x)` rewritten to `require(x)`) do not apply to globals.
  itBundled("cjs/ModuleMembersInESMStayVerbatim", {
    files: {
      "/entry.ts": /* ts */ `
        import { describeEnv } from './lib';
        export const env = describeEnv();
        console.log(env);
      `,
      "/lib.ts": /* ts */ `
        globalThis['ca' + 'pture'] = x => x;
        declare const module: any;
        declare const exports: any;

        export function describeEnv() {
          return [
            typeof module === 'undefined' ? 'no module' : capture(module.id),
            typeof module === 'undefined' ? 'no require' : capture(module.require('node:fs')),
            typeof exports === 'undefined' ? 'no exports' : capture(exports.foo),
          ].join(', ');
        }
      `,
    },
    capture: ["module.id", 'module.require("node:fs")', "exports.foo"],
    run: { stdout: "no module, no require, no exports" },
  });

  // The renamer must not take the names `module` and `exports` for minified
  // identifiers in a file where they are globals.
  itBundled("cjs/TypeofModuleAndExportsInESMMinified", {
    files: {
      "/entry.ts": /* ts */ `
        globalThis['ca' + 'pture'] = x => x;
        await Promise.resolve();
        console.log(capture(typeof module), capture(typeof exports));
      `,
    },
    minifyIdentifiers: true,
    capture: ["typeof module", "typeof exports"],
    run: { stdout: "undefined undefined" },
  });

  // With the CommonJS output format the globals refer to the output file's own
  // `module` and `exports`, under bun and under node.
  itBundled("cjs/ModuleAndExportsInESMWithFormatCJS", {
    files: {
      "/entry.ts": /* ts */ `
        import { install } from './install';
        install();
      `,
      "/install.ts": /* ts */ `
        declare const module: any;
        declare const exports: any;

        export function install() {
          console.log(typeof module, typeof exports, module.exports === exports);
        }
      `,
    },
    format: "cjs",
    target: "node",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toMatch(/\b(?:module|exports)_install\b/);
    },
    run: [{ stdout: "object object true" }, { runtime: "node", stdout: "object object true" }],
  });

  // `define` only replaces free identifiers, so it applies to `module` in a file
  // with ESM exports and not in a CommonJS file, where `module` is the wrapper's
  // argument.
  itBundled("cjs/DefineModuleAppliesOnlyInESMFile", {
    files: {
      "/entry.js": /* js */ `
        import { esm } from './esm.js';
        const cjs = require('./cjs.js');
        console.log(esm, cjs.value);
      `,
      "/esm.js": /* js */ `
        export const esm = module;
      `,
      "/cjs.js": /* js */ `
        module.exports = { value: typeof module };
      `,
    },
    define: { module: '"defined"' },
    run: { stdout: "defined object" },
  });

  // Bun keeps its content-based rule: a file with only CommonJS syntax is
  // CommonJS, whatever its extension or the package "type" says.
  itBundled("cjs/ModuleExportsInMJSStaysCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.mjs": /* js */ `
        module.exports = { a: 1 };
      `,
      "/package.json": `{ "type": "module" }`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__commonJS");
    },
    run: { stdout: '{"a":1}' },
  });

  // ============================================================================
  // Top-level `return` is only legal inside the CommonJS function wrapper, so
  // its presence makes the file CommonJS when no ESM export syntax is present.
  // ============================================================================

  for (const target of ["browser", "bun", "node"] as const) {
    itBundled(`cjs/TopLevelReturnEntry_${target}`, {
      files: {
        "/entry.js": /* js */ `
          console.log("before");
          if (globalThis.foo === undefined) return;
          console.log("after");
        `,
      },
      target,
      onAfterBundle(api) {
        api.expectFile("/out.js").toContain("__commonJS");
      },
      run: { stdout: "before" },
    });
  }

  // With the IIFE format the `return` must stay inside the wrapper; a bare
  // `return` at the IIFE's top level would exit the whole bundle.
  itBundled("cjs/TopLevelReturnIIFE", {
    files: {
      "/entry.js": /* js */ `
        console.log("before");
        if (globalThis.foo === undefined) return;
        console.log("after");
      `,
    },
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/__commonJS\(function\(\) \{[^]*\breturn;[^]*\}\);/);
    },
  });

  itBundled("cjs/TopLevelReturnImported", {
    files: {
      "/entry.js": /* js */ `
        import "./lib.js";
        console.log("entry");
      `,
      "/lib.js": /* js */ `
        console.log("lib: before");
        if (1) return;
        console.log("lib: after");
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__commonJS");
    },
    run: { stdout: "lib: before\nentry" },
  });

  itBundled("cjs/TopLevelReturnNestedBlock", {
    files: {
      "/entry.js": /* js */ `
        console.log("A");
        {
          if (1) return;
        }
        console.log("B");
      `,
    },
    run: { stdout: "A" },
  });

  itBundled("cjs/ReturnInsideFunctionIsNotTopLevel", {
    files: {
      "/entry.js": /* js */ `
        function f() { return 1; }
        const g = () => { return 2; };
        console.log(f() + g());
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__commonJS");
    },
    run: { stdout: "3" },
  });

  // `exports.foo = ...` is normally unwrapped to an ESM export. A top-level
  // return needs the CommonJS wrapper, so the unwrapping must be undone.
  itBundled("cjs/TopLevelReturnKeepsExportsAssignments", {
    files: {
      "/entry.js": /* js */ `
        const lib = require('./lib.js');
        console.log(JSON.stringify(lib));
      `,
      "/lib.js": /* js */ `
        exports.foo = 1;
        if (globalThis.skip) return;
        exports.bar = 2;
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__commonJS");
    },
    run: { stdout: '{"foo":1,"bar":2}' },
  });

  itBundled("cjs/TopLevelReturnWithExportIsAnError", {
    files: {
      "/entry.js": /* js */ `
        export const a = 1;
        return;
      `,
    },
    bundleErrors: {
      "/entry.js": ["Top-level return cannot be used inside an ECMAScript module"],
    },
  });
});
