import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { itBundled, type BundlerTestBundleAPI } from "./expectBundled";

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

  // ============================================================================
  // `require`, `__dirname` and `__filename` are parameters of Node's module
  // wrapper, as `exports` and `module` are. A module-level `var` of one of those
  // names in a CommonJS file is that parameter: it starts with its value.
  //
  // Each file exports what Node and `bun run` give for it.
  // ============================================================================

  const wrapperParameterCases: Record<string, [source: string, exported: string]> = {
    read_before_declaration: [
      `const path = require("node:path"); var require = require; module.exports = typeof path.join + " " + typeof require;`,
      "function function",
    ],
    declared_without_value: [
      `var require; module.exports = typeof require + " " + typeof require("node:path").join;`,
      "function function",
    ],
    typeof_only: [`var require; module.exports = typeof require;`, "function"],
    properties: [
      `var require; module.exports = typeof require.resolve + " " + typeof require.cache;`,
      "function object",
    ],
    declared_in_a_block: [
      `if (true) { var require = require; } module.exports = typeof require + " " + typeof require("node:path").join;`,
      "function function",
    ],
    own_value_after_a_read: [
      `var before = require; var require = function (id) { return "own:" + id; }; module.exports = typeof before + " " + require("id");`,
      "function own:id",
    ],
    own_value_first: [`var require = function (id) { return "own:" + id; }; module.exports = require("id");`, "own:id"],
    // The shape of requirejs `bin/r.js`.
    assigned_in_a_closure: [
      `var requirejs, require, define; (function () { var fs = require("fs"); var nodeRequire = require; require = undefined; requirejs = function (id) { return "rjs:" + id; }; if (!require) require = requirejs; module.exports = typeof fs.readFileSync + " " + typeof nodeRequire + " " + require("id"); })();`,
      "function function rjs:id",
    ],
    // A direct eval keeps the name `require` for the `var`.
    with_direct_eval: [
      `var require; var before = eval("typeof require"); require = undefined; module.exports = before + " " + eval("typeof require");`,
      "function undefined",
    ],
    read_only_by_direct_eval: [
      `var require, __dirname; module.exports = eval("typeof require + ' ' + typeof __dirname");`,
      "function string",
    ],
    function_then_var: [
      `function require(id) { return "fn:" + id; } var require; module.exports = require("id");`,
      "fn:id",
    ],
    var_then_function: [
      `var require; function require(id) { return "fn:" + id; } module.exports = require("id");`,
      "fn:id",
    ],
    strict_mode: [
      `"use strict"; var require; var __filename; module.exports = typeof require + " " + typeof __filename;`,
      "function string",
    ],
    all_five_names: [
      `var require, __dirname, __filename, module, exports; module.exports = [typeof require, typeof __dirname, typeof __filename, typeof module, typeof exports].join(" ");`,
      "function string string object object",
    ],
    dirname_and_filename: [
      `var path = require("node:path"); var __dirname = __dirname; var __filename = __filename; module.exports = typeof __dirname + " " + path.basename(__filename) + " " + (path.dirname(__filename) === __dirname);`,
      "string dirname_and_filename.cjs true",
    ],
    own_dirname: [
      `var __dirname = "own"; var __filename; module.exports = __dirname + " " + typeof __filename;`,
      "own string",
    ],
    function_named_dirname: [`function __dirname() {} var __dirname; module.exports = typeof __dirname;`, "function"],
    arguments_object: [
      `var require; module.exports = [arguments[0] === exports, arguments[1] === require, arguments[2] === module].join(" ");`,
      "true true true",
    ],
    // Each module has its own `require`: the second file is not affected by the first.
    one_module_writes: [
      `var require; var keep = require; require = undefined; module.exports = typeof keep + " " + typeof require;`,
      "function undefined",
    ],
    another_module_reads: [
      `var require; module.exports = typeof require + " " + typeof require("node:path").join;`,
      "function function",
    ],
  };
  const wrapperParameterFiles = {
    "/entry.cjs": Object.keys(wrapperParameterCases)
      .map(name => `console.log("${name}:", require("./${name}.cjs"));`)
      .join("\n"),
    ...Object.fromEntries(Object.entries(wrapperParameterCases).map(([name, [source]]) => [`/${name}.cjs`, source])),
  };
  const wrapperParameterStdout = Object.entries(wrapperParameterCases)
    .map(([name, [, exported]]) => `${name}: ${exported}`)
    .join("\n");
  const outfileFor = (format: "cjs" | "esm") => (format === "esm" ? "/out.mjs" : "/out.cjs");

  for (const target of ["node", "bun"] as const) {
    for (const format of ["cjs", "esm"] as const) {
      itBundled(`cjs/wrapper_parameter_var_${target}_${format}`, {
        files: wrapperParameterFiles,
        target,
        format,
        outfile: outfileFor(format),
        run: { stdout: wrapperParameterStdout },
      });
    }
  }

  for (const format of ["cjs", "esm"] as const) {
    itBundled(`cjs/wrapper_parameter_var_minified_${format}`, {
      files: wrapperParameterFiles,
      target: "node",
      format,
      outfile: outfileFor(format),
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      run: { stdout: wrapperParameterStdout },
    });
  }

  itBundled("cjs/wrapper_parameter_var_cli", {
    backend: "cli",
    files: wrapperParameterFiles,
    target: "node",
    format: "cjs",
    outfile: "/out.cjs",
    run: { stdout: wrapperParameterStdout },
  });

  itBundled("cjs/wrapper_parameter_var_compile_bytecode", {
    files: wrapperParameterFiles,
    compile: true,
    bytecode: true,
    format: "cjs",
    run: { stdout: wrapperParameterStdout },
  });

  // The file is the entry point. cjs output does not wrap it: it runs at the
  // top level of the output file, and its `var` is that file's `require`.
  for (const target of ["node", "bun"] as const) {
    for (const format of ["cjs", "esm"] as const) {
      itBundled(`cjs/wrapper_parameter_var_in_entry_point_${target}_${format}`, {
        files: {
          "/entry.cjs": /* js */ `
            var require, __dirname;
            console.log(typeof require, typeof require("node:path").join, typeof __dirname);
            import("./other.cjs").then(other => console.log(other.default));
          `,
          "/other.cjs": /* js */ `module.exports = typeof require("node:fs").readFileSync;`,
        },
        target,
        format,
        outfile: outfileFor(format),
        run: { stdout: "function function string\nfunction" },
      });
    }
  }

  // In cjs output every file reads the `require` of the output file. The entry
  // point that is not wrapped writes to it through its `var`.
  itBundled("cjs/wrapper_parameter_var_in_cjs_entry_point_is_the_output_files_require", {
    files: {
      "/entry.cjs": /* js */ `
        var require;
        const load = require;
        require = function (id) { return load(id === "an alias" ? "node:fs" : id); };
        import("./other.cjs").then(other => console.log(other.default));
      `,
      "/other.cjs": /* js */ `
        const id = "an alias";
        module.exports = typeof require(id).readFileSync;
      `,
    },
    target: "node",
    format: "cjs",
    outfile: "/out.cjs",
    run: { stdout: "function" },
  });

  // A `.js` file with no package.json "type". The `var` that it reads is its
  // only CommonJS feature.
  for (const format of ["cjs", "esm"] as const) {
    itBundled(`cjs/wrapper_parameter_var_is_the_only_commonjs_feature_${format}`, {
      files: {
        "/entry.js": /* js */ `
          import "./lib.js";
          console.log(globalThis.seen);
        `,
        "/lib.js": /* js */ `
          var require, __filename;
          globalThis.seen = typeof require + " " + typeof require("node:path").join + " " + typeof __filename;
        `,
      },
      target: "node",
      format,
      outfile: outfileFor(format),
      run: { stdout: "function function string" },
    });
  }

  // The `import` that the JSX transform adds does not make the file an ES module.
  // `bun run` cannot run this file as CommonJS and leaves the `var` undefined:
  // see test/cli/run/commonjs-no-export.test.ts.
  for (const format of ["cjs", "esm"] as const) {
    itBundled(`cjs/wrapper_parameter_var_in_file_with_jsx_${format}`, {
      files: {
        "/entry.jsx": /* js */ `
          var require, __filename;
          console.log(typeof require, typeof __filename, (<div />).type);
        `,
        "/node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
        "/node_modules/react/jsx-dev-runtime.js": /* js */ `
          export function jsxDEV(type) { return { type }; }
        `,
        "/node_modules/react/jsx-runtime.js": /* js */ `
          export function jsx(type) { return { type }; }
        `,
      },
      target: "node",
      format,
      outfile: outfileFor(format),
      run: { stdout: "function string div" },
    });
  }

  // esm output gives the exports of this file to its importer directly and does
  // not wrap the file. The `var` starts with the `require` of the output file.
  for (const target of ["node", "bun"] as const) {
    for (const format of ["cjs", "esm"] as const) {
      itBundled(`cjs/wrapper_parameter_var_in_file_with_named_exports_${target}_${format}`, {
        files: {
          "/entry.mjs": /* js */ `
            import { seen } from "./lib.js";
            console.log(seen);
          `,
          "/lib.js": /* js */ `
            var require, __dirname;
            exports.seen = [typeof require, typeof require("node:path").join, typeof __dirname].join(" ");
          `,
        },
        target,
        format,
        outfile: outfileFor(format),
        run: { stdout: "function function string" },
      });
    }
  }

  // A file this long is printed as two ranges of statements. The `var` gets its
  // value once, before the first of them.
  itBundled("cjs/wrapper_parameter_var_in_long_file_with_named_exports", {
    files: {
      "/entry.mjs": /* js */ `
        import { first, second } from "./lib.js";
        console.log(first, second);
      `,
      "/lib.js": Buffer.concat([
        Buffer.from(`var require;\nexports.first = typeof require("node:path").join;\n/*`),
        Buffer.alloc(130 * 1024, "-"),
        Buffer.from(`*/\nexports.second = typeof require("node:fs").readFileSync;\n`),
      ]),
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.mjs").match(/^var \w+ = __require;$/gm)).toHaveLength(1);
    },
    run: { stdout: "function function" },
  });

  // The only statement that reads the `var` is the value of an export that
  // nothing imports, so the output has neither of them and takes no `require`.
  itBundled("cjs/wrapper_parameter_var_read_only_by_unused_export", {
    files: {
      "/entry.mjs": /* js */ `
        import { used } from "./lib.js";
        console.log(used);
      `,
      "/lib.js": /* js */ `
        var require;
        exports.used = "used";
        exports.unused = typeof require;
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      api.expectFile("/out.mjs").not.toContain("require");
    },
    run: { stdout: "used" },
  });

  // With --splitting the file has its own chunk, which imports the runtime's
  // `__require` from the chunk that holds the runtime.
  itBundled("cjs/wrapper_parameter_var_splitting", {
    files: {
      "/entry.js": /* js */ `
        const { default: seen } = await import("./lib.cjs");
        console.log(seen);
      `,
      "/lib.cjs": /* js */ `
        var require;
        module.exports = typeof require + " " + typeof require("node:path").join;
      `,
    },
    target: "bun",
    splitting: true,
    outdir: "/out",
    run: { stdout: "function function" },
  });

  // A call through the `var` is not bundled: it is a call of the output file's
  // `require` at run time.
  for (const format of ["cjs", "esm"] as const) {
    itBundled(`cjs/wrapper_parameter_var_call_loads_at_run_time_${format}`, {
      files: {
        "/entry.js": /* js */ `
          import loaded from "./lib.cjs";
          console.log(loaded);
        `,
        "/lib.cjs": /* js */ `
          var require;
          module.exports = require("./at-run-time.cjs");
        `,
      },
      runtimeFiles: {
        "/at-run-time.cjs": /* js */ `module.exports = "loaded at run time";`,
      },
      target: "node",
      format,
      outfile: outfileFor(format),
      run: { stdout: "loaded at run time" },
    });
  }

  // An ES module has no wrapper, so the `var` is a new variable there. One
  // file is an ES module by its extension, the other by its syntax.
  itBundled("cjs/wrapper_parameter_var_in_es_module", {
    files: {
      "/entry.mjs": /* js */ `
        import "./by-extension.mjs";
        import { bySyntax } from "./by-syntax.js";
        console.log(globalThis.byExtension, bySyntax);
      `,
      "/by-extension.mjs": /* js */ `
        var require, __dirname, __filename;
        globalThis.byExtension = [typeof require, typeof __dirname, typeof __filename].join(" ");
      `,
      "/by-syntax.js": /* js */ `
        var require, __dirname, __filename;
        export const bySyntax = [typeof require, typeof __dirname, typeof __filename].join(" ");
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: { stdout: "undefined undefined undefined undefined undefined undefined" },
  });

  // No file reads a parameter: the first never reads its variables, the
  // others give them their own values first. A function that names the `var`
  // it is the value of reads it when it is called. The output takes nothing
  // for them.
  itBundled("cjs/wrapper_parameter_var_that_reads_no_parameter", {
    files: {
      "/entry.cjs": /* js */ `
        console.log(require("./never-read.cjs"), require("./own-values.cjs"), require("./own-function.cjs"));
      `,
      "/never-read.cjs": /* js */ `var require, __dirname, __filename; module.exports = "never read";`,
      "/own-values.cjs": /* js */ `
        var require = function (id) { return "own:" + id; }, __dirname = "own";
        module.exports = require("id") + " " + __dirname;
      `,
      "/own-function.cjs": /* js */ `
        var require = function (id) { return require.prefix + id; };
        require.prefix = "function:";
        module.exports = require("id");
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      const out = api.readFile("/out.mjs");
      expect(out).not.toContain("__require");
      expect(out).not.toContain("node:module");
      expect(out).not.toContain(api.root);
      expect(out).not.toMatch(/^\s*\(function\(/m);
    },
    run: { stdout: "never read own:id own function:id" },
  });

  // The output calls `require("node:fs")` for `module.require("node:fs")`. The
  // file's own `var require` does not take that name.
  itBundled("cjs/wrapper_parameter_var_leaves_the_name_require", {
    files: {
      "/entry.cjs": /* js */ `
        var require = function (id) { return "own:" + id; };
        console.log(typeof module.require("node:fs").readFileSync, require("id"));
      `,
    },
    target: "node",
    format: "cjs",
    outfile: "/out.cjs",
    run: { stdout: "function own:id" },
  });

  // Transpile-only output runs in a module wrapper that is not in the output,
  // so the `var` stays as written and gets no value.
  test("cjs/wrapper_parameter_var_transpile_only", () => {
    const source =
      "var require = require, __dirname = __dirname, __filename = __filename;\n" +
      "console.log(require, __dirname, __filename);\n";
    expect(new Bun.Transpiler({ loader: "js" }).transformSync(source)).toBe(source);
  });

  // A browser has no `require`, and a script made for one reads the `var` to
  // find that out.
  itBundled("cjs/wrapper_parameter_var_target_browser", {
    files: {
      "/entry.js": /* js */ `
        import seen from "./lib.cjs";
        console.log(seen);
      `,
      "/lib.cjs": /* js */ `var require; module.exports = typeof require;`,
    },
    target: "browser",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      api.expectFile("/out.mjs").not.toContain("__require");
    },
    run: { stdout: "undefined" },
  });

  // iife output has no `require` to give.
  itBundled("cjs/wrapper_parameter_var_format_iife", {
    files: {
      "/entry.js": /* js */ `
        import seen from "./lib.cjs";
        console.log(seen);
      `,
      "/lib.cjs": /* js */ `var require; module.exports = typeof require;`,
    },
    target: "node",
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__require");
    },
    run: { stdout: "undefined" },
  });

  // A server build bundles the scripts of an imported HTML file for the
  // browser. Only the server's copy of the file gets a `require`.
  const htmlImportFiles = {
    "/server.js": /* js */ `
      import page from "./index.html";
      import seen from "./lib.cjs";
      console.log(seen, typeof page.index);
    `,
    "/index.html": /* html */ `<!DOCTYPE html><html><head><script type="module" src="./client.js"></script></head></html>`,
    "/client.js": /* js */ `
      import seen from "./lib.cjs";
      console.log(seen);
    `,
    "/lib.cjs": /* js */ `var require; module.exports = typeof require;`,
  };
  const jsChunks = (api: BundlerTestBundleAPI) => readdirSync(api.outdir).filter(name => name.endsWith(".js"));
  const takesRequire = (api: BundlerTestBundleAPI, name: string) =>
    /^\s*\(function\(/m.test(api.readFile("/out/" + name));

  itBundled("cjs/wrapper_parameter_var_in_server_and_browser_chunk", {
    files: htmlImportFiles,
    entryPoints: ["/server.js"],
    outdir: "/out",
    target: "bun",
    onAfterBundle(api) {
      const chunks = jsChunks(api);
      expect(chunks).toHaveLength(2);
      expect(chunks.filter(name => takesRequire(api, name))).toEqual(["server.js"]);
    },
    run: { stdout: "function string" },
  });

  // Node's `__require` imports `node:module`, and each chunk prints every live
  // part of the runtime. The browser chunk must still load, so nothing changes.
  itBundled("cjs/wrapper_parameter_var_node_build_with_html_import", {
    files: htmlImportFiles,
    entryPoints: ["/server.js"],
    outdir: "/out",
    target: "node",
    format: "esm",
    onAfterBundle(api) {
      const chunks = jsChunks(api);
      expect(chunks).toHaveLength(2);
      for (const name of chunks) {
        expect(takesRequire(api, name)).toBe(false);
        api.expectFile("/out/" + name).not.toContain("node:module");
      }
    },
  });
});
